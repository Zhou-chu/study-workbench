"""Disposable split-artifact fixture for the owned hosted U003 Chromium job."""

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = Path(__file__).resolve().parent
MODEL = "acceptance-chat:latest"
SURREAL_SHA256 = "bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7"


class SetupOnlyModelHandler(BaseHTTPRequestHandler):
    """Setup needs discovery only; there is no generation in this browser rung."""

    def do_GET(self):  # noqa: N802
        if self.path != "/api/tags":
            self.send_error(404)
            return
        payload = json.dumps({"models": [{"name": MODEL}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--fixture-provider":
        port = int(sys.argv[2])
        if os.environ.get("GITHUB_ACTIONS") != "true" or not 1024 <= port <= 65535:
            raise SystemExit("Owned provider fixture is required")
        HTTPServer(("127.0.0.1", port), SetupOnlyModelHandler).serve_forever()
        return

    sys.path.insert(0, str(ROOT))
    from scripts.v1.browser_ownership import BrowserSubreaper
    from scripts.v1.local_check import (
        build_fixture_environment,
        prepared_tokenizer,
        seed_tokenizer,
    )
    from scripts.v1.runtime_lifecycle import (
        SAFE_INHERITED_ENV,
        http_ready,
        owned_listener_ready,
        require_free_ports,
        require_owned_listener,
        select_unused_ports,
        start_owned,
        stop_processes,
        wait_for_service,
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    for name in ("tokenizer", "playwright", "browser-bin", "evidence"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true":
        parser.error("Run from the fixed hosted PR workflow")
    surreal = ROOT / ".runtime/bin/surreal"
    if hashlib.sha256(surreal.read_bytes()).hexdigest() != SURREAL_SHA256:
        parser.error("SurrealDB executable integrity mismatch")
    if not args.playwright.is_dir() or not args.browser_bin.is_dir():
        parser.error("Use prepared, locked Playwright and Chromium")
    if args.evidence.exists():
        parser.error("Use a fresh receipt destination")

    ports = select_unused_ports()
    database, api_port, gateway_port = ports
    model_port, *_ = select_unused_ports()
    if model_port in ports:
        raise RuntimeError("Ambiguous fixture port allocation")
    require_free_ports(ports)
    require_free_ports((model_port, database, api_port))

    # Retain registrations even on failure, but never publish private service logs.
    def interrupted(*_):
        raise KeyboardInterrupt

    previous_handler = signal.signal(signal.SIGTERM, interrupted)
    run = None
    try:
        run = Path(tempfile.mkdtemp(prefix="nb-u003-stack-"))
        env = build_fixture_environment(run, os.environ, ports=ports)
        env["TIKTOKEN_CACHE_DIR"] = str(
            seed_tokenizer(run, prepared_tokenizer(args.tokenizer))
        )
        processes = []
        proof = run / "target.json"
        private_receipt = run / "browser.json"
        origin = f"http://127.0.0.1:{gateway_port}"
        model_origin = f"http://127.0.0.1:{model_port}"
        safe = {k: v for k, v in env.items() if k in SAFE_INHERITED_ENV}
        safe["GITHUB_ACTIONS"] = "true"
        browser_home = run / "browser-home"
        browser_home.mkdir(0o700)

        with ExitStack() as handles, BrowserSubreaper():

            def spawn(label, command, child_env):
                log = handles.enter_context((run / (label + ".log")).open("w"))
                process = start_owned(
                    command,
                    cwd=ROOT,
                    env=child_env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )
                processes.append(process)
                return process

            def readiness(label, process, port, route):
                wait_for_service(
                    label,
                    process,
                    lambda: http_ready(f"http://127.0.0.1:{port}{route}"),
                    guard=lambda: owned_listener_ready(process, port),
                )

            try:
                db = spawn(
                    "db",
                    [
                        str(surreal),
                        "start",
                        "--bind",
                        f"127.0.0.1:{database}",
                        "--log",
                        "warn",
                        "rocksdb:" + str(run / "db"),
                    ],
                    {**env, "SURREAL_ONLINE_VERSION_CHECK": "false"},
                )
                readiness("database", db, database, "/health")
                api = spawn(
                    "api",
                    [
                        str(ROOT / ".venv/bin/python"),
                        "-m",
                        "uvicorn",
                        "api.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(api_port),
                    ],
                    env,
                )
                readiness("API", api, api_port, "/health")
                worker = spawn(
                    "worker",
                    [
                        str(ROOT / ".venv/bin/surreal-commands-worker"),
                        "--import-modules",
                        "commands",
                        "--max-tasks",
                        "2",
                    ],
                    env,
                )
                model = spawn(
                    "local-model",
                    [
                        sys.executable,
                        __file__,
                        "--fixture-provider",
                        str(model_port),
                    ],
                    safe,
                )
                readiness("local Ollama discovery", model, model_port, "/api/tags")
                gateway = spawn(
                    "gateway",
                    [
                        "node",
                        str(SCRIPTS / "gateway.mjs"),
                        args.sha,
                        str(ROOT / "apps/web/dist"),
                        str(ROOT / "apps/bff/dist"),
                        str(run / "gateway"),
                        str(proof),
                    ],
                    {
                        **safe,
                        "PORT": str(gateway_port),
                        "INTERNAL_API_URL": f"http://127.0.0.1:{api_port}",
                        "STUDY_WORKBENCH_WEB_ORIGIN": origin,
                        "STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK": "true",
                    },
                )
                readiness("artifact gateway", gateway, gateway_port, "/config")
                browser = spawn(
                    "chromium",
                    [
                        "node",
                        str(SCRIPTS / "setup-driver.mjs"),
                        str(args.playwright.absolute()),
                        str(proof),
                        str(ROOT / "tests/fixtures/v1"),
                        str(private_receipt),
                    ],
                    {
                        **safe,
                        "HOME": str(browser_home),
                        "TMPDIR": str(browser_home),
                        "XDG_CONFIG_HOME": str(browser_home / "config"),
                        "XDG_CACHE_HOME": str(browser_home / "cache"),
                        "PLAYWRIGHT_BROWSERS_PATH": str(args.browser_bin.absolute()),
                        "U003_GATEWAY_ORIGIN": origin,
                        "U003_MODEL_ORIGIN": model_origin,
                        "U003_FIXTURE_PASSWORD": env["OPEN_NOTEBOOK_PASSWORD"],
                    },
                )
                deadline = time.monotonic() + 210
                while browser.poll() is None:
                    if time.monotonic() > deadline or worker.poll() is not None:
                        raise RuntimeError(
                            "Owned browser stage timed out or worker exited"
                        )
                    for process, port in (
                        (db, database),
                        (api, api_port),
                        (model, model_port),
                        (gateway, gateway_port),
                    ):
                        require_owned_listener(process, port)
                    time.sleep(0.2)
                exit_code = browser.poll()
            finally:
                stop_processes(processes)
                require_free_ports(ports)
                require_free_ports((model_port, database, api_port))
        # No PASS receipt escapes until browsers, other owned processes and
        # all listener ports have both been checked and released.
        evidence = json.loads(private_receipt.read_text())
        if evidence.get("sourceCommit") != args.sha or evidence.get("status") != (
            "pass" if exit_code == 0 else "fail"
        ):
            raise RuntimeError("Unexpected browser receipt")
    finally:
        try:
            if run is not None:
                shutil.rmtree(run)
        finally:
            signal.signal(signal.SIGTERM, previous_handler)

    with args.evidence.open("x") as output:
        json.dump(evidence, output)
    if exit_code != 0:
        raise RuntimeError("U003 browser failed; see bounded stage receipt")


if __name__ == "__main__":
    main()
