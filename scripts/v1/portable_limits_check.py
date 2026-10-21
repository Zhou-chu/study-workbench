"""Real native HTTP >100 MiB portable roundtrip; synthetic public data only.

Large files and process logs stay in .runtime; --out receives sanitized JSON only.
No Google/model, browser, production data, credentials or remote services are used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import wave
import zipfile
from pathlib import Path
from urllib.parse import quote

import httpx
from local_check import ROOT, build_fixture_environment

MIB = 1024 * 1024
PASSWORD = "test-only-local-fixture"


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fixture(run):
    wav_path = run / "public-synthetic-silence.wav"
    with wave.open(str(wav_path), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        for _ in range(108):
            wav.writeframesraw(bytes(MIB))
    sha = file_hash(wav_path)
    with zipfile.ZipFile(
        ROOT / "docs/v1/examples/public-fixture-project.zip"
    ) as source:
        members = {name: source.read(name) for name in source.namelist()}
    notebook = json.loads(members["notebook.json"])["id"]
    payload = f"artifacts/{sha}.wav"
    artifact = {
        "artifact_id": "artifact_public_large_silence",
        "notebook_id": notebook,
        "file_path": payload,
        "byte_size": wav_path.stat().st_size,
        "sha256": sha,
        "mime_type": "audio/wav",
    }
    job = {
        "job_id": "job_public_saved_silence",
        "notebook_id": notebook,
        "operation": "audio",
        "state": "succeeded",
        "result": {"downloaded": True, "artifact": artifact},
    }
    members["artifacts.json"] = json.dumps([artifact]).encode()
    members["jobs.json"] = json.dumps([job]).encode()
    manifest = json.loads(members.pop("manifest.json"))
    manifest["entity_counts"].update(artifact=1, job=1)
    manifest["files"] = {
        name: {"byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for name, data in members.items()
    }
    manifest["files"][payload] = {"byte_size": wav_path.stat().st_size, "sha256": sha}
    members["manifest.json"] = json.dumps(manifest).encode()
    archive = run / "public-synthetic-large.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as package:
        for name, data in members.items():
            package.writestr(name, data)
        package.write(wav_path, payload)
    return archive, sha, wav_path.stat().st_size


def verify_archive(path, expected_hash, expected_size):
    with zipfile.ZipFile(path) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["format_version"] == 1
        assert set(package.namelist()) == set(manifest["files"]) | {"manifest.json"}
        for name, expected in manifest["files"].items():
            with package.open(name) as stream:
                hasher = hashlib.sha256()
                while chunk := stream.read(MIB):
                    hasher.update(chunk)
                actual = hasher.hexdigest()
            assert actual == expected["sha256"], name
            assert package.getinfo(name).file_size == expected["byte_size"], name
        artifacts = json.loads(package.read("artifacts.json"))
        assert len(artifacts) == 1
        artifact = artifacts[0]
        assert artifact["sha256"] == expected_hash
        assert artifact["byte_size"] == expected_size
        assert manifest["files"][artifact["file_path"]]["sha256"] == expected_hash
        return {
            "archive_bytes": path.stat().st_size,
            "archive_sha256": file_hash(path),
            "manifest_members_verified": len(manifest["files"]),
            "expanded_bytes": sum(item.file_size for item in package.infolist()),
            "all_members_stored": all(
                item.compress_type == zipfile.ZIP_STORED for item in package.infolist()
            ),
        }


def headers_only_status(port, path, size, authenticated=False):
    """Send no body: a response proves rejection did not await/read the body."""
    authorization = f"Authorization: Bearer {PASSWORD}\r\n" if authenticated else ""
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(
            (
                f"POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n"
                f"{authorization}Content-Length: {size}\r\n"
                "Content-Type: multipart/form-data; boundary=fixture\r\n"
                "Connection: close\r\n\r\n"
            ).encode()
        )
        line = sock.recv(4096).split(b"\r\n", 1)[0]
        return int(line.split()[1])


def download(client, url, path):
    with client.stream("GET", url) as response:
        response.raise_for_status()
        assert "no-store" in response.headers["cache-control"]
        with path.open("wb") as output:
            for chunk in response.iter_bytes():
                output.write(chunk)


def browser_restore(base, archive, client, env, phase_run, out):
    from playwright.sync_api import expect, sync_playwright

    response = client.post(
        "/api/notebooks",
        json={
            "name": "Public restore UI fixture",
            "description": "Disposable empty notebook for real restore controls",
        },
    )
    response.raise_for_status()
    target = base + "/notebooks/" + quote(response.json()["id"], safe="") + "/study"
    with sync_playwright() as pw:
        browser = pw.firefox.launch(headless=True, timeout=30000, env=env)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000}, locale="en-US"
        )
        # This verification cannot accidentally contact provider/public services.
        context.route(
            "**/*",
            lambda route: route.continue_()
            if route.request.url.startswith(base + "/")
            else route.abort(),
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(target)
        page.locator("input[type=password]").fill(PASSWORD)
        page.locator("button[type=submit]").click()
        page.wait_for_url(lambda url: "/login" not in url)
        page.goto(target)
        page.get_by_text("Project backup", exact=True).click()
        with page.expect_response(
            lambda response: response.url.endswith("/api/personal/portable/limits"),
            timeout=30000,
        ) as limits_pending:
            page.locator(
                'input[type=file][accept=".zip,application/zip"]'
            ).set_input_files(str(archive))
        limits_response = limits_pending.value
        assert limits_response.status == 200
        confirm = page.get_by_role("dialog").get_by_role(
            "button", name="Confirm", exact=True
        )
        expect(confirm).to_be_enabled(timeout=30000)
        expect(page.get_by_role("dialog")).to_have_css("opacity", "1")
        (out / "browser").mkdir(exist_ok=True)
        page.screenshot(
            path=str(out / "browser" / "next-browser-restore-confirm.png"),
            full_page=True,
            animations="disabled",
        )
        with page.expect_response(
            lambda response: response.url.endswith("/api/personal/imports/portable")
            and response.request.method == "POST",
            timeout=120000,
        ) as imported:
            confirm.click()
        response = imported.value
        assert response.status == 201, (response.status, response.text())
        restored = response.json()
        link = page.get_by_role("link", name="Open restored notebook", exact=True)
        expect(link).to_be_visible(timeout=30000)
        assert quote(restored["notebook_id"], safe="") in link.get_attribute("href")
        page.screenshot(
            path=str(out / "browser" / "next-browser-restore-complete.png"),
            full_page=True,
            animations="disabled",
        )
        assert not errors, errors
        browser.close()
        return restored, {
            "browser": "Firefox",
            "real_ui_file_input": True,
            "limits_http_status": limits_response.status,
            "confirm_enabled_after_limits": True,
            "import_http_status": response.status,
            "restored_link_visible": True,
            "page_errors": errors,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--frontend-standalone",
        action="store_true",
        help="Route every request through built Next standalone; its rewrite must target port 5055",
    )
    parser.add_argument(
        "--browser-restore",
        action="store_true",
        help="Use real Firefox PortableControls for fresh restore phase; requires --frontend-standalone",
    )
    args = parser.parse_args()
    if args.browser_restore and not args.frontend_standalone:
        parser.error("--browser-restore requires --frontend-standalone")
    if args.browser_restore:
        standalone = ROOT / "frontend/.next/standalone"
        shutil.copytree(
            ROOT / "frontend/.next/static",
            standalone / ".next/static",
            dirs_exist_ok=True,
        )
        shutil.copytree(
            ROOT / "frontend/public", standalone / "public", dirs_exist_ok=True
        )
    args.out.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="portable-limits-", dir=ROOT / ".runtime"))
    archive, sha, size = fixture(run)
    report = {
        "status": "running",
        "transport": "next-standalone" if args.frontend_standalone else "direct-api",
        "fixture": "Public-domain deterministic 108 MiB of zero PCM samples plus valid WAV header; synthetic saved asset, NOT Google/model-generated audio",
        "artifact_sha256": sha,
        "artifact_bytes": size,
        "old_global_body_cap_bytes": 100 * MIB,
        "initial_archive": verify_archive(archive, sha, size),
        "cases": [],
        "scope": "Fresh native SurrealDB/API/worker, loopback ports (API5055 for production rewrites, otherwise random), public test-only credentials, allowlisted environment, dotenv disabled; no private files, model calls or external deployment.",
    }
    assert archive.stat().st_size > 100 * MIB
    try:
        for phase in ("initial-import", "fresh-db-restore"):
            phase_run = run / phase
            phase_run.mkdir()
            db_port, api_port = (
                free_port(),
                5055 if args.frontend_standalone else free_port(),
            )
            if args.frontend_standalone:
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    probe.bind(("127.0.0.1", api_port))
            request_port = free_port() if args.frontend_standalone else api_port
            base = f"http://127.0.0.1:{api_port}"
            # Only basic executable/runtime variables survive from the host.
            inherited = {
                key: os.environ[key]
                for key in ("PATH", "LANG", "LC_ALL")
                if key in os.environ
            }
            env = build_fixture_environment(phase_run, inherited)
            env.update(
                SURREAL_URL=f"ws://127.0.0.1:{db_port}/rpc",
                INTERNAL_API_URL=base,
                API_URL=f"http://127.0.0.1:{request_port}",
                CORS_ORIGINS=f"http://127.0.0.1:{request_port}",
                PORT=str(request_port),
                HOSTNAME="127.0.0.1",
                HOME=str(phase_run),
                XDG_CONFIG_HOME=str(phase_run / "config"),
                XDG_CACHE_HOME=str(phase_run / "cache"),
                OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB="100",
            )
            procs, handles = [], []

            def start(name, command):
                handle = (phase_run / f"{name}.log").open("w")
                handles.append(handle)
                procs.append(
                    subprocess.Popen(
                        command,
                        cwd=ROOT,
                        env=env,
                        stdout=handle,
                        stderr=subprocess.STDOUT,
                    )
                )

            def wait_url(url):
                until = time.monotonic() + 90
                while time.monotonic() < until:
                    assert all(proc.poll() is None for proc in procs), (
                        f"Process exited; local logs: {phase_run}"
                    )
                    try:
                        if (
                            httpx.get(url, timeout=1, trust_env=False).status_code
                            == 200
                        ):
                            return
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.5)
                raise AssertionError("Service readiness timed out")

            try:
                start(
                    "db",
                    [
                        str(ROOT / ".runtime/bin/surreal"),
                        "start",
                        "--bind",
                        f"127.0.0.1:{db_port}",
                        "--user",
                        "root",
                        "--pass",
                        PASSWORD,
                        "--log",
                        "warn",
                        "rocksdb:" + str(phase_run / "db"),
                    ],
                )
                wait_url(f"http://127.0.0.1:{db_port}/health")
                start(
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
                wait_url(base + "/health")
                start(
                    "worker",
                    [
                        str(ROOT / ".venv/bin/surreal-commands-worker"),
                        "--import-modules",
                        "commands",
                        "--max-tasks",
                        "2",
                    ],
                )
                if args.frontend_standalone:
                    start(
                        "frontend",
                        ["node", str(ROOT / "frontend/.next/standalone/server.js")],
                    )
                    base = f"http://127.0.0.1:{request_port}"
                    wait_url(base + "/api/auth/status")
                with httpx.Client(
                    base_url=base,
                    trust_env=False,
                    headers={
                        "Authorization": f"Bearer {PASSWORD}",
                        **({"Origin": base} if args.frontend_standalone else {}),
                    },
                    timeout=120,
                ) as client:
                    origin_rejected = None
                    if args.frontend_standalone:
                        evil = client.post(
                            "/api/personal/imports/portable",
                            content=b"invalid",
                            headers={
                                "Origin": "https://evil.invalid",
                                "Content-Type": "application/zip",
                            },
                        )
                        assert evil.status_code == 403, (evil.status_code, evil.text)
                        origin_rejected = evil.status_code
                    limits = client.get("/api/personal/portable/limits")
                    limits.raise_for_status()
                    limits = limits.json()
                    assert limits["max_archive_bytes"] == 1024 * MIB
                    assert limits["max_request_bytes"] == 1025 * MIB
                    anonymous = headers_only_status(
                        api_port, "/api/personal/imports/portable", 1026 * MIB
                    )
                    assert anonymous == 401
                    browser_evidence = None
                    if args.browser_restore and phase == "fresh-db-restore":
                        imported, browser_evidence = browser_restore(
                            base, archive, client, env, phase_run, args.out
                        )
                        import_status = 201
                    else:
                        with archive.open("rb") as stream:
                            response = client.post(
                                "/api/personal/imports/portable",
                                files={
                                    "file": (archive.name, stream, "application/zip")
                                },
                            )
                        assert response.status_code == 201, (
                            response.status_code,
                            response.text,
                        )
                        imported = response.json()
                        import_status = response.status_code
                    notebook = imported["notebook_id"]
                    source_status = headers_only_status(
                        api_port,
                        f"/api/personal/notebooks/{notebook}/sources/upload",
                        101 * MIB,
                        True,
                    )
                    assert source_status == 413
                    portable_over = headers_only_status(
                        api_port,
                        "/api/personal/imports/portable",
                        limits["max_request_bytes"] + 1,
                        True,
                    )
                    assert portable_over == 413
                    workspace = client.get(
                        f"/api/personal/notebooks/{notebook}/workspace"
                    )
                    workspace.raise_for_status()
                    job = next(
                        item
                        for item in workspace.json()["jobs"]
                        if item["operation"] == "audio"
                    )
                    assert job["restored_history"] and job["replay_allowed"] is False
                    artifact_id = job["result"]["artifact"]["artifact_id"]
                    asset_url = f"/api/personal/artifacts/{artifact_id}/download"
                    assert (
                        httpx.get(base + asset_url, trust_env=False).status_code == 401
                    )
                    saved = phase_run / "download.wav"
                    download(client, asset_url, saved)
                    assert saved.stat().st_size == size and file_hash(saved) == sha
                    case = {
                        "phase": phase,
                        "import_http_status": import_status,
                        "browser_restore": browser_evidence,
                        "untrusted_origin_http_status": origin_rejected,
                        "import_archive_bytes": archive.stat().st_size,
                        "headers_only_probe_transport": "direct-api",
                        "anonymous_headers_only_status": anonymous,
                        "global_source_upload_headers_only_status": source_status,
                        "portable_over_budget_headers_only_status": portable_over,
                        "download_sha256": file_hash(saved),
                        "download_bytes": saved.stat().st_size,
                        "history_replay_disabled": True,
                        "limits": limits,
                        "notebook_id": notebook,
                        "artifact_id": artifact_id,
                    }
                    report["cases"].append(case)
                    if phase == "initial-import":
                        response = client.post(
                            f"/api/personal/notebooks/{notebook}/exports",
                            json={"idempotency_key": "large-public-portable-check"},
                        )
                        response.raise_for_status()
                        export_job = response.json()
                        until = time.monotonic() + 180
                        while time.monotonic() < until:
                            response = client.get(
                                "/api/personal/jobs/" + export_job["job_id"]
                            )
                            response.raise_for_status()
                            export_job = response.json()
                            if export_job["state"] in ("succeeded", "failed"):
                                break
                            time.sleep(0.5)
                        assert export_job["state"] == "succeeded", export_job
                        archive = run / "genuine-worker-export.zip"
                        download(client, export_job["result"]["download_url"], archive)
                        case["worker_export"] = verify_archive(archive, sha, size)
                        assert archive.stat().st_size > 100 * MIB
                        assert case["worker_export"]["all_members_stored"]
            finally:
                for proc in reversed(procs):
                    proc.terminate()
                    try:
                        proc.wait(10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                for handle in handles:
                    handle.close()
        assert report["cases"][0]["artifact_id"] != report["cases"][1]["artifact_id"]
        assert report["cases"][0]["notebook_id"] != report["cases"][1]["notebook_id"]
        report["status"] = "passed"
    except Exception as exc:
        report["status"] = "failed"
        report["failure_type"] = type(exc).__name__
        raise
    finally:
        (args.out / "portable-limits-results.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
