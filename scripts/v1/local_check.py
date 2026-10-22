"""Isolated real-stack checks, no Google/model calls. All processes share one sandbox."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

ROOT = Path(__file__).resolve().parents[2]

if TYPE_CHECKING or __package__:
    from .artifact_identity import verify_artifact
    from .runtime_lifecycle import (
        PORTS,
        SAFE_INHERITED_ENV,
        OwnedProcess,
        http_ready,
        owned_listener_ready,
        process_identity,
        require_free_ports,
        require_owned_listener,
        select_unused_ports,
        start_owned,
        stop_processes,
        validate_ports,
        wait_for_service,
    )
else:
    from artifact_identity import verify_artifact
    from runtime_lifecycle import (
        PORTS,
        SAFE_INHERITED_ENV,
        OwnedProcess,
        http_ready,
        owned_listener_ready,
        process_identity,
        require_free_ports,
        require_owned_listener,
        select_unused_ports,
        start_owned,
        stop_processes,
        validate_ports,
        wait_for_service,
    )


def build_fixture_environment(
    run: Path, inherited_env: Mapping[str, str], *, ports=PORTS
) -> dict[str, str]:
    database, api, frontend = ports
    identity = secrets.token_hex(16)
    password = secrets.token_urlsafe(32)
    return {
        **{k: v for k, v in inherited_env.items() if k in SAFE_INHERITED_ENV},
        "PYTHON_DOTENV_DISABLED": "1",
        "LOGURU_DIAGNOSE": "NO",
        "SURREAL_URL": f"ws://127.0.0.1:{database}/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASSWORD": password,
        "SURREAL_PASS": password,
        "SURREAL_UNAUTHENTICATED": "false",
        "SURREAL_NAMESPACE": "check_" + identity,
        "SURREAL_DATABASE": "check_" + identity,
        "OPEN_NOTEBOOK_PASSWORD": secrets.token_urlsafe(32),
        "STUDY_WORKBENCH_PRIVATE_MODE": "1",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": secrets.token_urlsafe(32),
        "STUDY_WORKBENCH_RUNTIME_DIR": str(run),
        "STUDY_WORKBENCH_DATA_DIR": str(run / "personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(run / "upstream-data"),
        "HOME": str(run / "home"),
        "XDG_CONFIG_HOME": str(run / "home/config"),
        "XDG_CACHE_HOME": str(run / "cache"),
        "CORS_ORIGINS": f"http://127.0.0.1:{frontend}",
        "INTERNAL_API_URL": f"http://127.0.0.1:{api}",
        "API_URL": f"http://127.0.0.1:{frontend}",
        "UV_CACHE_DIR": str(run / "uv-cache"),
        "NOTEBOOKLM_HOME": str(run / "no-google-profile"),
        "NOTEBOOKLM_STORAGE_PATH": str(run / "no-google-profile/storage_state.json"),
        "TZ": "UTC",
    }


def build_frontend_environment(backend: Mapping[str, str], port: int) -> dict[str, str]:
    """Frontend gets routing and private HOME only, never DB or encryption secrets."""
    allowed = SAFE_INHERITED_ENV | {
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "INTERNAL_API_URL",
        "API_URL",
    }
    return {
        **{key: value for key, value in backend.items() if key in allowed},
        "PORT": str(port),
        "HOSTNAME": "127.0.0.1",
        "NODE_ENV": "production",
        "NEXT_TELEMETRY_DISABLED": "1",
    }


def probe_frontend_http(
    client, artifact: Path, origin: str, password: str, notebook: str
):
    """Only public bytes and fixture API reads; caller guards every owned request."""
    config = client.get("/config")
    config.raise_for_status()
    assert config.json()["apiUrl"] == origin
    assert config.json()["auth_mode"] == "legacy_password"
    assets = sorted((artifact / ".next/static").rglob("*.js"))
    assert assets, "Verified artifact has no JavaScript static assets"
    asset = assets[0]
    response = client.get(
        "/_next/static/" + asset.relative_to(artifact / ".next/static").as_posix()
    )
    response.raise_for_status()
    assert response.content == asset.read_bytes(), (
        "Served static bytes differ from artifact"
    )
    path = f"/api/notebooks/{notebook}"
    assert client.get(path).status_code == 401
    authorized = client.get(path, headers={"Authorization": "Bearer " + password})
    authorized.raise_for_status()
    assert authorized.json()["id"] == notebook


def restart_owned_stack(processes, ports, start_backend, start_frontend):
    """No restart after failed cleanup/free-port check; caller retains cleanup registry."""
    stop_processes(processes)
    require_free_ports(ports)
    backend = start_backend()
    frontend = start_frontend()
    return (*backend, frontend)


def fixture_inventory(root: Path) -> dict[str, bytes]:
    fixtures = {}
    for name in (
        "fixture_course.md",
        "fixture_a.pdf",
        "fixture_b.pdf",
        "fixture_scanned.pdf",
        "fixture_invalid.pdf",
    ):
        path = root / "tests/fixtures/v1" / name
        if (
            any(part.is_symlink() for part in (path, *path.parents))
            or not path.is_file()
        ):
            raise ValueError(
                "Required public fixture must be a regular non-symlink file"
            )
        fixtures[name] = path.read_bytes()
    return fixtures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--frontend-http", action="store_true")
    parser.add_argument("--artifact", type=Path)
    parser.add_argument(
        "--browser-engine", choices=["chromium", "firefox"], default="chromium"
    )
    for name in ("database", "api", "frontend"):
        parser.add_argument(f"--{name}-port", type=int)
    args = parser.parse_args()
    if (args.browser or args.frontend_http) and args.artifact is None:
        parser.error(
            "Frontend acceptance requires --artifact from an isolated npm run build"
        )
    artifact_identity = verify_artifact(ROOT, args.artifact) if args.artifact else None
    requested = (args.database_port, args.api_port, args.frontend_port)
    if any(port is not None for port in requested) and not all(
        port is not None for port in requested
    ):
        parser.error(
            "Supply all three isolated ports, or omit all for automatic selection"
        )
    ports = (
        requested
        if all(port is not None for port in requested)
        else select_unused_ports()
    )
    try:
        validate_ports(ports)
    except ValueError as error:
        parser.error(str(error))
    require_free_ports(ports)
    fixtures = fixture_inventory(ROOT)
    database, api_port, frontend = ports
    api_base = f"http://127.0.0.1:{api_port}"
    run = Path(tempfile.mkdtemp(prefix="sw-check-"))
    env = build_fixture_environment(run, os.environ, ports=ports)
    fixture_hashes = {
        name: hashlib.sha256(data).hexdigest() for name, data in fixtures.items()
    }
    procs: list[OwnedProcess] = []
    handles = []
    results = []
    navigation_cases = []

    def start(name, args, *, child_env=None):
        output = (run / (name + ".log")).open("a")
        handles.append(output)
        p = start_owned(
            args,
            cwd=ROOT,
            env=env if child_env is None else child_env,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        procs.append(p)
        return p

    def wait_url(name, proc, port, path):
        wait_for_service(
            name,
            proc,
            lambda: http_ready(f"http://127.0.0.1:{port}{path}"),
            guard=lambda: owned_listener_ready(proc, port),
        )

    def check_stack(_request=None):
        require_owned_listener(db, database)
        require_owned_listener(api, api_port)
        if worker.poll() is not None:
            raise RuntimeError("Owned worker exited")

    def interrupted(*_):
        raise KeyboardInterrupt

    def check_artifact():
        if args.artifact and verify_artifact(ROOT, args.artifact) != artifact_identity:
            raise RuntimeError("Frontend artifact identity changed during acceptance")

    def start_stack():
        db = start(
            "db",
            [
                str(ROOT / ".runtime/bin/surreal"),
                "start",
                "--bind",
                f"127.0.0.1:{database}",
                "--log",
                "warn",
                "rocksdb:" + str(run / "db"),
            ],
        )
        wait_url("database", db, database, "/health")
        require_owned_listener(db, database)
        api = start(
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
        )
        wait_url("api", api, api_port, "/health")
        require_owned_listener(db, database)
        worker = start(
            "worker",
            [
                str(ROOT / ".venv/bin/surreal-commands-worker"),
                "--import-modules",
                "commands",
                "--max-tasks",
                "2",
            ],
        )
        return db, api, worker

    def start_frontend():
        check_artifact()
        proc = start(
            "frontend",
            ["node", str(args.artifact.absolute() / "server.js")],
            child_env=build_frontend_environment(env, frontend),
        )
        wait_url("frontend", proc, frontend, "/config")
        return proc

    previous_handler = signal.signal(signal.SIGTERM, interrupted)
    try:
        db, api, worker = start_stack()
        with httpx.Client(
            base_url=api_base,
            trust_env=False,
            event_hooks={"request": [check_stack]},
            headers={"Authorization": "Bearer " + env["OPEN_NOTEBOOK_PASSWORD"]},
            timeout=20,
        ) as client:
            for path in [
                "/api/personal/jobs/x",
                "/api/personal/source-versions/x/download",
                "/api/personal/exports/x/download",
            ]:
                check_stack()
                r = httpx.get(api_base + path, trust_env=False)
                assert r.status_code == 401, (path, r.status_code)
            results.append(
                "Anonymous API, original, task and export requests rejected with 401"
            )
            r = client.post(
                "/api/notebooks",
                json={
                    "name": "V1 public fixture",
                    "description": "Isolated real-stack verification",
                },
            )
            r.raise_for_status()
            nb = r.json()["id"]
            fixture = ROOT / "tests/fixtures/v1/fixture_course.md"
            content = fixtures[fixture.name]
            upload_data = {"idempotency_key": "upload-once"}
            upload_files = {"file": (fixture.name, content, "text/markdown")}
            r = client.post(
                f"/api/personal/notebooks/{nb}/sources/upload",
                data=upload_data,
                files=upload_files,
            )
            r.raise_for_status()
            upload = r.json()
            duplicate = client.post(
                f"/api/personal/notebooks/{nb}/sources/upload",
                data=upload_data,
                files=upload_files,
            )
            duplicate.raise_for_status()
            assert duplicate.json() == upload
            for _ in range(120):
                r = client.get(f"/api/personal/notebooks/{nb}/workspace")
                r.raise_for_status()
                workspace = r.json()
                job = next(
                    j for j in workspace["jobs"] if j["job_id"] == upload["job_id"]
                )
                if job["state"] in ("succeeded", "failed"):
                    break
                time.sleep(0.5)
            assert job["state"] == "succeeded", job
            detail = client.get(
                "/api/personal/source-versions/" + upload["source_version_id"]
            )
            detail.raise_for_status()
            detail = detail.json()
            assert detail["extraction"]["status"] == "ready", detail
            original = client.get(
                "/api/personal/source-versions/"
                + upload["source_version_id"]
                + "/download"
            )
            original.raise_for_status()
            assert original.content == content
            results.append(
                "Real native DB/API/worker upload, CPU extraction, idempotency and original hash verified"
            )
            evidence = detail["evidence"][0]
            assert evidence["quote"]
            search = client.post(
                "/api/personal/search",
                json={
                    "query": evidence["quote"][:20],
                    "source_version_ids": [upload["source_version_id"]],
                },
            )
            search.raise_for_status()
            assert search.json()["hits"]
            note = client.post(
                f"/api/personal/notebooks/{nb}/notes",
                json={
                    "title": "Saved evidence",
                    "content": "Retained public test note",
                    "citations": [],
                    "scope_snapshot": {
                        "source_version_ids": [upload["source_version_id"]]
                    },
                },
            )
            note.raise_for_status()
            selection = {
                "engine": "independent",
                "selection_origin": "local",
                "source_version_ids": [upload["source_version_id"]],
                "remote_source_ids": [],
                "reading": {
                    "source_version_id": upload["source_version_id"],
                    "page_index": 0,
                },
            }
            saved_selection = client.patch(
                f"/api/personal/notebooks/{nb}/selection", json=selection
            )
            saved_selection.raise_for_status()
            saved_selection = saved_selection.json()
            results.append(
                "Real lexical search, note save and persistent selection verified without a model"
            )
            # Real CPU PDF/TXT and explicit failure states, still no model/provider.
            for filename, mime, expected_status, expected_pages in [
                ("fixture_a.pdf", "application/pdf", "ready", 3),
                ("fixture_b.pdf", "application/pdf", "ready", 4),
                ("fixture_scanned.pdf", "application/pdf", "needs_ocr", 1),
                ("fixture_invalid.pdf", "application/pdf", "failed", None),
                ("fixture_text.txt", "text/plain", "ready", None),
            ]:
                raw = (
                    fixtures[filename]
                    if filename != "fixture_text.txt"
                    else "真实 TXT 解析测试。证据必须来自原件。".encode()
                )
                uploaded = client.post(
                    f"/api/personal/notebooks/{nb}/sources/upload",
                    data={"idempotency_key": filename},
                    files={"file": (filename, raw, mime)},
                )
                uploaded.raise_for_status()
                vid = uploaded.json()["source_version_id"]
                jid = uploaded.json()["job_id"]
                for _ in range(120):
                    current = client.get(f"/api/personal/jobs/{jid}")
                    current.raise_for_status()
                    if current.json()["state"] in {"succeeded", "failed"}:
                        break
                    time.sleep(0.5)
                parsed = client.get(f"/api/personal/source-versions/{vid}")
                parsed.raise_for_status()
                parsed = parsed.json()
                assert parsed["extraction"]["status"] == expected_status, parsed
                assert parsed["extraction"].get("page_count") == expected_pages, parsed
                downloaded = client.get(f"/api/personal/source-versions/{vid}/download")
                downloaded.raise_for_status()
                assert downloaded.content == raw
                if expected_status == "needs_ocr":
                    assert parsed["extraction"]["warnings"] and not parsed["evidence"]
                if expected_pages and expected_status == "ready":
                    assert {
                        e["locator"]["page_index"] for e in parsed["evidence"]
                    } == set(range(expected_pages))
                if filename in {"fixture_a.pdf", "fixture_b.pdf"}:
                    references = []
                    records = parsed["evidence"]
                    for index in range(5):
                        record = records[index % len(records)]
                        # Distinct known references include exact subquotes, not model claims.
                        quote = record["quote"]
                        if index >= len(records):
                            quote = next(
                                line for line in quote.splitlines() if line.strip()
                            )
                        citation_id = f"LOC_{filename[8]}_{index + 1}"
                        references.append(
                            {
                                **record,
                                "citation_id": citation_id,
                                "kind": "local_evidence",
                                "quote": quote,
                            }
                        )
                        navigation_cases.append(
                            {
                                "source_title": filename,
                                "source_version_id": vid,
                                "citation_id": citation_id,
                                "physical_page": record["locator"]["page_index"] + 1,
                                "quote": quote,
                            }
                        )
                    checked = client.post(
                        f"/api/personal/notebooks/{nb}/notes",
                        json={
                            "title": f"Known locations: {filename}",
                            "content": "Five public known-reference fixtures, authored without a model.",
                            "citations": references,
                            "scope_snapshot": {"source_version_ids": [vid]},
                        },
                    )
                    checked.raise_for_status()
                    assert all(
                        c["reference_validity"] == "verified"
                        for c in checked.json()["citations"]
                    ), checked.json()
                if filename == "fixture_a.pdf":
                    citation = next(
                        e for e in parsed["evidence"] if e["locator"]["page_index"] == 2
                    )
                    citation = {
                        **citation,
                        "citation_id": "PDF_NAV",
                        "kind": "local_evidence",
                    }
                    nav_note = client.post(
                        f"/api/personal/notebooks/{nb}/notes",
                        json={
                            "title": "PDF navigation fixture",
                            "content": "Public authored note for physical-page navigation; no model answer.",
                            "citations": [citation],
                            "scope_snapshot": {"source_version_ids": [vid]},
                        },
                    )
                    nav_note.raise_for_status()
            results.append(
                "Real Chinese PDF (3+4 pages), TXT, image-only PDF needs_ocr and malformed PDF failed states verified; all original bytes preserved"
            )
            stop_processes([api])
            require_owned_listener(db, database)
            api = start(
                "api-restarted",
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
            )
            wait_url("api", api, api_port, "/health")
            require_owned_listener(db, database)
            restored = client.get(f"/api/personal/notebooks/{nb}/workspace")
            restored.raise_for_status()
            restored = restored.json()
            assert (
                restored["selection"]["source_version_ids"]
                == selection["source_version_ids"]
            )
            assert any(
                n["content"] == "Retained public test note" for n in restored["notes"]
            )
            assert (
                client.get(
                    "/api/personal/source-versions/"
                    + upload["source_version_id"]
                    + "/download"
                ).content
                == content
            )
            results.append(
                "API process restart retains original bytes, evidence, note and selection in real native DB"
            )
            if args.browser or args.frontend_http:
                assert artifact_identity is not None
                frontend_proc = start_frontend()
            if args.frontend_http:

                def check_frontend(_request=None):
                    check_stack()
                    require_owned_listener(frontend_proc, frontend)

                origin = f"http://127.0.0.1:{frontend}"
                with httpx.Client(
                    base_url=origin,
                    trust_env=False,
                    timeout=20,
                    event_hooks={"request": [check_frontend]},
                ) as frontend_client:
                    probe_frontend_http(
                        frontend_client,
                        args.artifact,
                        origin,
                        env["OPEN_NOTEBOOK_PASSWORD"],
                        nb,
                    )
                    check_artifact()
                    results.append(
                        "Verified artifact /config, exact static bytes and anonymous/authenticated API proxy passed over HTTP (no browser)"
                    )
                    db, api, worker, frontend_proc = restart_owned_stack(
                        [db, api, worker, frontend_proc],
                        ports,
                        start_stack,
                        start_frontend,
                    )
                    probe_frontend_http(
                        frontend_client,
                        args.artifact,
                        origin,
                        env["OPEN_NOTEBOOK_PASSWORD"],
                        nb,
                    )
                    headers = {
                        "Authorization": "Bearer " + env["OPEN_NOTEBOOK_PASSWORD"]
                    }
                    restored = frontend_client.get(
                        f"/api/personal/notebooks/{nb}/workspace", headers=headers
                    )
                    restored.raise_for_status()
                    restored = restored.json()
                    assert restored["selection"] == saved_selection
                    assert any(
                        n["content"] == "Retained public test note"
                        for n in restored["notes"]
                    )
                    original = frontend_client.get(
                        "/api/personal/source-versions/"
                        + upload["source_version_id"]
                        + "/download",
                        headers=headers,
                    )
                    original.raise_for_status()
                    assert original.content == content
                    check_artifact()
                    results.append(
                        "Owned DB/API/worker/frontend coupled stop/restart retained original bytes, notes and selection using same fixture data/config; not cold restore"
                    )
            if args.browser:
                assert artifact_identity is not None
                check_stack()
                require_owned_listener(frontend_proc, frontend)
                (run / "navigation-cases.json").write_text(json.dumps(navigation_cases))
                token = secrets.token_urlsafe(32)
                env["STUDY_WORKBENCH_ACCEPTANCE_TOKEN"] = token
                context = {
                    "schema": 1,
                    "parent_pid": os.getpid(),
                    "parent_start_ticks": process_identity(os.getpid())[2],
                    "run_id": secrets.token_hex(16),
                    "token_sha256": hashlib.sha256(token.encode()).hexdigest(),
                    "source_root": str(ROOT),
                    "artifact_path": str(args.artifact.absolute()),
                    "manifest_sha256": artifact_identity["manifest_sha256"],
                    "ports": {
                        "database": database,
                        "api": api_port,
                        "frontend": frontend,
                    },
                    "processes": {
                        name: {"pid": proc.pid, "identity": proc.identity}
                        for name, proc in (
                            ("database", db),
                            ("api", api),
                            ("frontend", frontend_proc),
                        )
                    },
                    "notebook_id": nb,
                    "navigation_cases": str(run / "navigation-cases.json"),
                    "out": str(run / "screenshots"),
                }
                context_path = run / "browser-run-context.json"
                fd = os.open(
                    context_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                )
                with os.fdopen(fd, "w") as output:
                    json.dump(context, output)
                browser = start(
                    "browser",
                    [
                        sys.executable,
                        str(ROOT / "scripts/v1/browser_check.py"),
                        "--run-context",
                        str(context_path),
                        "--engine",
                        args.browser_engine,
                    ],
                )
                deadline = time.monotonic() + 1200
                while browser.poll() is None:
                    check_stack()
                    require_owned_listener(frontend_proc, frontend)
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Browser acceptance timed out")
                    time.sleep(0.25)
                if browser.poll() != 0:
                    raise RuntimeError(
                        "Browser acceptance failed; inspect isolated run logs"
                    )
                check_artifact()
                results.append(
                    "Parent-bound browser fixture actions passed against the verified artifact"
                )
    finally:
        try:
            stop_processes(procs)
        finally:
            for h in handles:
                h.close()
            signal.signal(signal.SIGTERM, previous_handler)

    require_free_ports(ports)
    results.append("All owned fixture listeners released after cleanup")
    check_artifact()
    (run / "api-results.json").write_text(
        json.dumps(
            {
                "status": "passed",
                "results": results,
                "artifact_identity": artifact_identity,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    (run / "navigation-cases.json").write_text(
        json.dumps(navigation_cases, ensure_ascii=False, indent=2)
    )
    (run / "context.json").write_text(
        json.dumps(
            {
                "notebook_id": nb,
                "upload": upload,
                "results": results,
                "fixture_sha256": fixture_hashes,
                "ports": ports,
                "browser_status": "passed" if args.browser else "not_run",
                "frontend_http_status": "passed" if args.frontend_http else "not_run",
                "artifact_identity": artifact_identity,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(
        json.dumps(
            {
                "status": "passed",
                "run_dir": str(run),
                "results": results,
                "artifact_identity": artifact_identity,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
