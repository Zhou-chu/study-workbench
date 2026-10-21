"""Real saved-audio playback, not Google/model generation acceptance.

Uses a deterministic public-domain synthetic WAV and genuine portable HTTP
import/export. Each phase has fresh native DB and filesystem; no fake adapter.
Run with a Python containing httpx and Playwright after building frontend.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import wave
import zipfile
from pathlib import Path
from urllib.parse import quote

import httpx
from local_check import ROOT, build_fixture_environment
from playwright.sync_api import expect, sync_playwright


def digest(data):
    return hashlib.sha256(data).hexdigest()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fixture(path):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(
            b"".join(
                struct.pack("<h", int(2000 * math.sin(2 * math.pi * 440 * n / 16000)))
                for n in range(32000)
            )
        )
    audio = stream.getvalue()
    with zipfile.ZipFile(
        ROOT / "docs/v1/examples/public-fixture-project.zip"
    ) as source:
        members = {name: source.read(name) for name in source.namelist()}
    notebook = json.loads(members["notebook.json"])["id"]
    payload = f"artifacts/{digest(audio)}.wav"
    artifact = {
        "artifact_id": "artifact_public_tone",
        "notebook_id": notebook,
        "file_path": payload,
        "byte_size": len(audio),
        "sha256": digest(audio),
        "mime_type": "audio/wav",
    }
    job = {
        "job_id": "job_public_saved_tone",
        "notebook_id": notebook,
        "operation": "audio",
        "state": "succeeded",
        "result": {"downloaded": True, "artifact": artifact},
    }
    members[payload] = audio
    members["artifacts.json"] = json.dumps([artifact]).encode()
    members["jobs.json"] = json.dumps([job]).encode()
    manifest = json.loads(members.pop("manifest.json"))
    manifest["entity_counts"].update(artifact=1, job=1)
    manifest["files"] = {
        name: {"byte_size": len(data), "sha256": digest(data)}
        for name, data in members.items()
    }
    members["manifest.json"] = json.dumps(manifest).encode()
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return audio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    archive = args.out / "public-synthetic-audio.zip"
    audio = fixture(archive)
    report = {
        "status": "running",
        "fixture": "Public-domain deterministic 2-second 440Hz PCM WAV; synthetic saved asset, NOT generated Google/model audio",
        "sha256": digest(audio),
        "byte_size": len(audio),
        "cases": [],
        "limits": "No Google login, remote generation, model inference, paid resources, host reboot, or external deployment.",
    }
    standalone = ROOT / "frontend/.next/standalone"
    shutil.copytree(
        ROOT / "frontend/.next/static", standalone / ".next/static", dirs_exist_ok=True
    )
    shutil.copytree(ROOT / "frontend/public", standalone / "public", dirs_exist_ok=True)
    try:
        for phase in ("imported-fixture", "fresh-restored-export"):
            run = Path(tempfile.mkdtemp(prefix="audio-check-", dir=ROOT / ".runtime"))
            db_port, api_port, ui_port = free_port(), free_port(), free_port()
            base = f"http://127.0.0.1:{api_port}"
            ui = f"http://127.0.0.1:{ui_port}"
            env = build_fixture_environment(run, os.environ)
            env.update(
                SURREAL_URL=f"ws://127.0.0.1:{db_port}/rpc",
                INTERNAL_API_URL=base,
                API_URL=base,
                CORS_ORIGINS=ui,
                PORT=str(ui_port),
                HOSTNAME="127.0.0.1",
            )
            procs, logs = [], []

            def start(name, command):
                handle = (args.out / f"{phase}-{name}.log").open("w")
                logs.append(handle)
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
                    try:
                        if httpx.get(url, timeout=1, trust_env=False).status_code < 500:
                            return
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.5)
                raise AssertionError(f"Service not ready: {url}")

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
                        "test-only-local-fixture",
                        "--log",
                        "warn",
                        "rocksdb:" + str(run / "db"),
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
                start("frontend", ["node", str(standalone / "server.js")])
                wait_url(ui + "/login")
                with httpx.Client(
                    base_url=base,
                    trust_env=False,
                    headers={"Authorization": "Bearer test-only-local-fixture"},
                    timeout=30,
                ) as client:
                    response = client.post(
                        "/api/personal/imports/portable",
                        files={
                            "file": (
                                archive.name,
                                archive.read_bytes(),
                                "application/zip",
                            )
                        },
                    )
                    response.raise_for_status()
                    imported = response.json()
                    notebook = imported["notebook_id"]
                    # Resolve remapped identity from genuine workspace response.
                    response = client.get(
                        f"/api/personal/notebooks/{notebook}/workspace"
                    )
                    response.raise_for_status()
                    job = next(
                        job
                        for job in response.json()["jobs"]
                        if job["operation"] == "audio"
                    )
                    assert job["restored_history"] and job["replay_allowed"] is False
                    artifact_id = job["result"]["artifact"]["artifact_id"]
                    asset_path = f"/api/personal/artifacts/{artifact_id}/download"
                    anonymous = httpx.get(base + asset_path, trust_env=False)
                    assert anonymous.status_code == 401
                    fetched = client.get(asset_path)
                    fetched.raise_for_status()
                    assert fetched.content == audio
                    assert "no-store" in fetched.headers["cache-control"]
                    case = {
                        "phase": phase,
                        "notebook_id": notebook,
                        "artifact_id": artifact_id,
                        "anonymous_status": anonymous.status_code,
                        "api_sha256": digest(fetched.content),
                        "historical_job_replay_disabled": True,
                        "playback": [],
                    }
                    report["cases"].append(case)
                    with sync_playwright() as pw:
                        profile_home = tempfile.mkdtemp(
                            prefix="sw-audio-browser-", dir="/tmp"
                        )
                        browser = pw.firefox.launch(
                            headless=True,
                            timeout=30000,
                            env={
                                **env,
                                "HOME": profile_home,
                                "XDG_CONFIG_HOME": profile_home + "/config",
                                "XDG_CACHE_HOME": profile_home + "/cache",
                            },
                        )
                        context = browser.new_context(
                            viewport={"width": 1440, "height": 1000},
                            locale="en-US",
                            accept_downloads=True,
                        )
                        page = context.new_page()
                        errors = []
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        target = (
                            ui + "/notebooks/" + quote(notebook, safe="") + "/study"
                        )
                        page.goto(target)
                        page.locator("input[type=password]").fill(
                            "test-only-local-fixture"
                        )
                        page.locator("button[type=submit]").click()
                        page.wait_for_url(lambda url: "/login" not in url)
                        page.goto(target)
                        for reload in (False, True):
                            if reload:
                                page.reload()
                            play = page.get_by_role(
                                "button", name="Play saved audio", exact=True
                            )
                            expect(play).to_be_visible(timeout=30000)
                            play.click()
                            element = page.locator("audio")
                            expect(element).to_be_visible()
                            result = element.evaluate("""async audio => {
                                audio.muted = true;
                                await audio.play();
                                const start = audio.currentTime;
                                await new Promise(resolve => setTimeout(resolve, 350));
                                const progressed = audio.currentTime;
                                await new Promise((resolve, reject) => {
                                    if (audio.ended) return resolve();
                                    audio.addEventListener('ended', resolve, {once: true});
                                    setTimeout(() => reject(new Error('Audio did not end')), 10000);
                                });
                                return {start, progressed, duration: audio.duration, ended: audio.ended, readyState: audio.readyState, error: audio.error && audio.error.code, source: audio.currentSrc.slice(0,5)};
                            }""")
                            assert (
                                result["progressed"] > result["start"]
                                and result["ended"]
                                and result["error"] is None
                            )
                            assert (
                                abs(result["duration"] - 2) < 0.05
                                and result["source"] == "blob:"
                            )
                            case["playback"].append({"after_reload": reload, **result})
                        with page.expect_download() as pending:
                            page.get_by_role(
                                "button", name="Download result", exact=True
                            ).first.click()
                        download = pending.value
                        saved = args.out / f"{phase}-download.wav"
                        download.save_as(saved)
                        assert saved.read_bytes() == audio
                        case["browser_download_sha256"] = digest(saved.read_bytes())
                        case["page_errors"] = errors
                        assert not errors, errors
                        page.screenshot(
                            path=str(args.out / f"{phase}.png"), full_page=True
                        )
                        browser.close()
                    if phase == "imported-fixture":
                        response = client.post(
                            f"/api/personal/notebooks/{notebook}/exports",
                            json={"idempotency_key": "audio-portable-check"},
                        )
                        response.raise_for_status()
                        export_job = response.json()
                        until = time.monotonic() + 90
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
                        response = client.get(export_job["result"]["download_url"])
                        response.raise_for_status()
                        archive = args.out / "real-export-with-audio.zip"
                        archive.write_bytes(response.content)
                        case["export_sha256"] = digest(response.content)
            finally:
                for proc in reversed(procs):
                    proc.terminate()
                    try:
                        proc.wait(10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                for handle in logs:
                    handle.close()
        assert report["cases"][0]["artifact_id"] != report["cases"][1]["artifact_id"]
        report["status"] = "passed"
    finally:
        (args.out / "audio-results.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
