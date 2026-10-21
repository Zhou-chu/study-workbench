"""Run the unchanged four-tier Open Notebook stack in one native process tree.

Supply a private environment file whose credentials were explicitly authorized.
Nothing in this launcher creates credentials, opens a public listener, or logs in.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import time
from collections.abc import Mapping
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


def build_runtime_environment(
    config: Path, inherited_env: Mapping[str, str]
) -> dict[str, str]:
    """Load only the explicitly selected config, not a child-discovered .env."""
    return {
        **inherited_env,
        **{k: v for k, v in dotenv_values(config).items() if v},
        "PYTHON_DOTENV_DISABLED": "1",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config", required=True)
    p.add_argument("--frontend-dev", action="store_true")
    args = p.parse_args()
    config = Path(args.config).resolve()
    if config.stat().st_mode & 0o077:
        raise SystemExit(
            "Private runtime config must not be readable by other users (mode0600)"
        )
    env = build_runtime_environment(config, os.environ)
    for key in (
        "OPEN_NOTEBOOK_PASSWORD",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY",
        "SURREAL_PASSWORD",
    ):
        if not env.get(key) or env[key].startswith(("change-me", "test-only")):
            raise SystemExit(
                "Configure authorized private runtime credentials before starting"
            )
    env.setdefault("SURREAL_USER", "root")
    env["SURREAL_PASS"] = env["SURREAL_PASSWORD"]
    env.setdefault("SURREAL_URL", "ws://127.0.0.1:18000/rpc")
    env.setdefault("SURREAL_NAMESPACE", "study_workbench")
    env.setdefault("SURREAL_DATABASE", "study_workbench")
    env.setdefault("STUDY_WORKBENCH_DATA_DIR", str(ROOT / ".runtime/data/personal"))
    env.setdefault("INTERNAL_API_URL", "http://127.0.0.1:5055")
    env.setdefault("API_URL", "http://127.0.0.1:13000")
    env.setdefault("CORS_ORIGINS", "http://127.0.0.1:13000")
    runtime = Path(
        env.get("STUDY_WORKBENCH_RUNTIME_DIR", ROOT / ".runtime/data")
    ).resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    env.setdefault("OPEN_NOTEBOOK_DATA_DIR", str(runtime / "upstream-data"))
    env["STUDY_WORKBENCH_PRIVATE_MODE"] = "1"
    env["PORT"] = "13000"
    env["HOSTNAME"] = "127.0.0.1"
    if not args.frontend_dev:
        import shutil

        standalone = ROOT / "frontend/.next/standalone"
        if not standalone.exists():
            raise SystemExit("Build frontend first: cd frontend && npm run build")
        shutil.copytree(
            ROOT / "frontend/.next/static",
            standalone / ".next/static",
            dirs_exist_ok=True,
        )
        if (ROOT / "frontend/public").exists():
            shutil.copytree(
                ROOT / "frontend/public", standalone / "public", dirs_exist_ok=True
            )
    commands = [
        (
            "database",
            [
                str(ROOT / ".runtime/bin/surreal"),
                "start",
                "--bind",
                "127.0.0.1:18000",
                "--log",
                "warn",
                "rocksdb:" + str(runtime / "surreal.db"),
            ],
            ROOT,
        ),
        (
            "api",
            [
                str(ROOT / ".venv/bin/python"),
                "-m",
                "uvicorn",
                "api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "5055",
            ],
            ROOT,
        ),
        (
            "worker",
            [
                str(ROOT / ".venv/bin/surreal-commands-worker"),
                "--import-modules",
                "commands",
                "--max-tasks",
                "2",
            ],
            ROOT,
        ),
        (
            "frontend",
            [
                "npm",
                "run",
                "dev" if args.frontend_dev else "start",
                "--",
                "--hostname",
                "127.0.0.1",
                "--port",
                "13000",
            ],
            ROOT / "frontend",
        ),
    ]
    processes = []
    logs = []

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        for name, cmd, cwd in commands:
            output = (runtime / (name + ".log")).open("a")
            logs.append(output)
            processes.append(
                subprocess.Popen(
                    cmd, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT
                )
            )
            time.sleep(2)
        print(
            "Private native services started on loopback only. Frontend http://127.0.0.1:13000 is local to this process environment, not an external delivery URL.",
            flush=True,
        )
        while all(proc.poll() is None for proc in processes):
            time.sleep(1)
        raise SystemExit(
            "One service stopped. Inspect private runtime logs; automatic provider/Google retries are not performed."
        )
    except KeyboardInterrupt:
        pass
    finally:
        for proc in reversed(processes):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        for output in logs:
            output.close()


if __name__ == "__main__":
    main()
