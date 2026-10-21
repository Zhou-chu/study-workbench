"""Real SIGKILL recovery check on an isolated native DB/API/queue worker.

Only a temporary worker import pauses at the parser boundary. Queue, stores,
locks, API polling and recovery are unmodified production implementations.
No provider/account calls, persistent credentials, or public listeners are used.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix="maintenance-crash-", dir=ROOT / ".runtime"))
    db_port, api_port = free_port(), free_port()
    inherited = {
        key: value
        for key, value in os.environ.items()
        if not any(
            word in key.upper()
            for word in ("API_KEY", "TOKEN", "SECRET", "PASSWORD", "ENCRYPTION_KEY")
        )
        and not key.startswith(("GOOGLE_", "NOTEBOOKLM_"))
    }
    env = {
        **inherited,
        "SURREAL_URL": f"ws://127.0.0.1:{db_port}/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASSWORD": "test-only-local-fixture",
        "SURREAL_NAMESPACE": "crash_check",
        "SURREAL_DATABASE": "crash_check",
        "OPEN_NOTEBOOK_PASSWORD": "test-only-local-fixture",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": "test-only-encryption-fixture",
        "STUDY_WORKBENCH_PRIVATE_MODE": "1",
        "STUDY_WORKBENCH_DATA_DIR": str(run / "personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(run / "upstream-data"),
        "NOTEBOOKLM_HOME": str(run / "no-google"),
        "NOTEBOOKLM_STORAGE_PATH": str(run / "no-google/storage_state.json"),
        "PYTHONPATH": str(ROOT) + os.pathsep + str(run),
        "PYTHON_DOTENV_DISABLED": "1",
        "CRASH_CHECK_DIR": str(run),
        "TZ": "UTC",
    }
    # No production source edits. Pause after durable running extraction is
    # stored but before CPU parsing, while real advisory locks are held.
    (run / "crash_pause.py").write_text(
        "import os, time\nfrom pathlib import Path\n"
        "import api.evidence_service as module\n"
        "original = module._bounded_parse\n"
        "def pause(*args, **kwargs):\n"
        "    root = Path(os.environ['CRASH_CHECK_DIR'])\n"
        "    if (root / 'armed').exists():\n"
        "        (root / 'paused').write_text(str(os.getpid()))\n"
        "        while True: time.sleep(0.1)\n"
        "    return original(*args, **kwargs)\n"
        "module._bounded_parse = pause\n"
    )
    processes, handles = [], []
    cases: list[dict[str, Any]] = []
    report = {
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "method": "Native RocksDB SurrealDB + authenticated HTTP API + real surreal-commands worker. SIGKILL at parser boundary; unchanged recovery deadlines and HTTP polling.",
        "limits": "No browser interaction, host reboot, DB corruption, remote Google/model calls, or restored-archive trust checks in this test.",
        "cases": cases,
    }

    def start(name, command):
        output = (args.out / f"{name}.log").open("w")
        handles.append(output)
        proc = subprocess.Popen(
            command,
            cwd=ROOT,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        processes.append(proc)
        return proc

    def stop(proc, force=False):
        if proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL if force else signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=10)

    def healthy(url):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                if httpx.get(url, timeout=1).status_code < 500:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        raise AssertionError(f"Service not healthy: {url}")

    def worker(name, paused=False):
        return start(
            name,
            [
                str(ROOT / ".venv/bin/surreal-commands-worker"),
                "--import-modules",
                "commands,crash_pause" if paused else "commands",
                "--max-tasks",
                "1",
            ],
        )

    try:
        start(
            "database",
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
                f"rocksdb:{run / 'db'}",
            ],
        )
        healthy(f"http://127.0.0.1:{db_port}/health")
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
        healthy(f"http://127.0.0.1:{api_port}/health")
        active = worker("worker-initial")
        with httpx.Client(
            base_url=f"http://127.0.0.1:{api_port}",
            headers={"Authorization": "Bearer test-only-local-fixture"},
            timeout=20,
        ) as client:

            def request(method, path, **kwargs):
                response = client.request(method, "/api" + path, **kwargs)
                response.raise_for_status()
                return response.json()

            def finished(job_id, timeout=150):
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    job = request("GET", f"/personal/jobs/{job_id}")
                    if job["state"] in ("succeeded", "failed", "cancelled_local"):
                        assert job["state"] == "succeeded", job
                        return job
                    time.sleep(0.5)
                raise AssertionError(f"Job failed to finish: {job}")

            notebook = request(
                "POST", "/notebooks", json={"name": "Crash recovery public fixture"}
            )["id"]
            content = b"# Recovery fixture\n\nOriginal evidence survives interruption.\n\nSecond paragraph.\n"
            uploaded = request(
                "POST",
                f"/personal/notebooks/{notebook}/sources/upload",
                data={"idempotency_key": "upload"},
                files={"file": ("recovery.md", content, "text/markdown")},
            )
            finished(uploaded["job_id"])
            version_id = uploaded["source_version_id"]
            path = f"/personal/source-versions/{version_id}"
            initial = request("GET", path)
            historical_id = initial["extraction"]["extraction_id"]
            for operation in ("reparse", "revalidate"):
                before = request("GET", path)
                stop(active)
                (run / "armed").touch()
                (run / "paused").unlink(missing_ok=True)
                active = worker(f"worker-{operation}-paused", paused=True)
                payload = {"idempotency_key": f"crash-{operation}"}
                if operation == "revalidate":
                    payload["extraction_id"] = historical_id
                submitted = request("POST", path + "/" + operation, json=payload)
                deadline = time.monotonic() + 60
                while not (run / "paused").exists() and time.monotonic() < deadline:
                    assert active.poll() is None, "Worker exited before pause"
                    time.sleep(0.1)
                assert (run / "paused").exists(), "Worker never reached parser boundary"
                running = request("GET", f"/personal/jobs/{submitted['job_id']}")
                assert running["state"] == "running", running
                at_pause = request("GET", path)
                assert at_pause["extraction"] == before["extraction"]
                assert at_pause["evidence"] == before["evidence"]
                assert (run / "paused").read_text() == str(active.pid)
                stopped_at = time.monotonic()
                stop(active, force=True)
                assert active.returncode == -signal.SIGKILL
                after_kill = request("GET", path)
                assert after_kill["evidence"] == before["evidence"]
                (run / "armed").unlink()
                active = worker(f"worker-{operation}-restarted")
                done = finished(submitted["job_id"])
                assert done["job_id"] == submitted["job_id"]
                assert done["attempts"] == 2, done
                assert done["fresh_extraction_id"] == submitted["fresh_extraction_id"]
                after = request("GET", path)
                assert after["version"]["status"] == "ready"
                assert (
                    after["extraction"]["extraction_id"]
                    == submitted["fresh_extraction_id"]
                )
                assert after["extraction"]["status"] == "ready"
                historical = request(
                    "GET", path, params={"extraction_id": historical_id}
                )
                assert historical["evidence"] == initial["evidence"]
                if operation == "revalidate":
                    assert done["result"]["verified_count"] == len(initial["evidence"])
                duplicate = request("POST", path + "/" + operation, json=payload)
                assert duplicate["job_id"] == done["job_id"]
                assert duplicate["attempts"] == 2
                cases.append(
                    {
                        "operation": operation,
                        "passed": True,
                        "job_id": done["job_id"],
                        "attempts": done["attempts"],
                        "old_worker_id": submitted.get("worker_job_id"),
                        "recovery_worker_id": done.get("worker_job_id"),
                        "fresh_extraction_id": done["fresh_extraction_id"],
                        "old_ready_content_preserved_during_kill": True,
                        "historical_evidence_preserved": True,
                        "same_job_and_extraction_recovered": True,
                        "idempotent_resubmission": True,
                        "recovery_seconds": round(time.monotonic() - stopped_at, 2),
                    }
                )
                print(json.dumps(cases[-1]), flush=True)
            report["status"] = "passed"
    except Exception as exc:
        report.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        for proc in reversed(processes):
            stop(proc)
        for handle in handles:
            handle.close()
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        (args.out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
