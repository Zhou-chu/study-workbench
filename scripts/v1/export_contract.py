#!/usr/bin/env python3
"""Export the actual FastAPI OpenAPI document without starting application services.

The child process has no ambient application environment, cannot connect sockets
or write files, and replaces only import-time directory/checkpoint scaffolding.
This is an accidental-side-effect guard, not a sandbox for untrusted Python code.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "contracts/v1/openapi.json"


def _schema() -> str:
    import sqlite3
    from unittest.mock import patch

    sys.path.insert(0, str(ROOT))
    sys.dont_write_bytecode = True
    data_root = "/__contract_export_no_data__"
    os.environ["OPEN_NOTEBOOK_DATA_DIR"] = data_root
    os.environ["STUDY_WORKBENCH_DATA_DIR"] = data_root + "/personal"
    scaffolding = {
        data_root + "/" + suffix
        for suffix in ("sqlite-db", "uploads", "podcasts", "tiktoken-cache")
    }
    connect = sqlite3.connect

    def memory_checkpoint(database, *args, **kwargs):
        if str(database) != data_root + "/sqlite-db/checkpoints.sqlite":
            raise RuntimeError("Unexpected database access during schema export")
        return connect(":memory:", *args, **kwargs)

    def scaffold(path, *args, **kwargs):
        if str(path) not in scaffolding:
            raise RuntimeError("Unexpected directory creation during schema export")

    def guard(event, args):
        if event in {
            "socket.connect",
            "socket.getaddrinfo",
            "socket.bind",
            "subprocess.Popen",
        }:
            raise RuntimeError(f"External access during schema export: {event}")
        if event == "open":
            _, mode, flags = args
            if (mode and any(c in mode for c in "wax+")) or (
                flags
                & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            ):
                raise RuntimeError("File write during schema export")
        if event in {
            "os.mkdir",
            "os.remove",
            "os.rename",
            "os.rmdir",
            "os.truncate",
            "os.chmod",
            "os.link",
            "os.symlink",
        }:
            raise RuntimeError(f"Filesystem mutation during schema export: {event}")
        if event == "sqlite3.connect" and args[0] != ":memory:":
            raise RuntimeError("Disk database access during schema export")

    sys.addaudithook(guard)
    with patch("os.makedirs", scaffold), patch("sqlite3.connect", memory_checkpoint):
        from api.main import app

        # No TestClient/lifespan, migrations, worker, DB or provider invocation.
        schema = app.openapi()
    return json.dumps(schema, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def render() -> str:
    # Deliberately do not pass credentials, *_FILE paths, proxy settings, Python
    # startup hooks, HOME, or dotenv configuration into the isolated importer.
    result = subprocess.run(
        [sys.executable, "-B", str(Path(__file__).resolve()), "--_schema"],
        cwd=ROOT,
        env={
            "PYTHON_DOTENV_DISABLED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
            "LC_ALL": "C.UTF-8",
        },
        capture_output=True,
        text=True,
        timeout=90,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Schema import failed")
    # Fail on incidental stdout rather than silently committing a partial schema.
    json.loads(result.stdout)
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="Compare only; never rewrite the snapshot"
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--_schema", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args._schema:
        sys.stdout.write(_schema())
        return 0
    try:
        generated = render()
        if args.check:
            if (
                not args.output.is_file()
                or args.output.read_bytes() != generated.encode("utf-8")
            ):
                print(
                    f"Contract drift: {args.output}; regenerate and review the diff.",
                    file=sys.stderr,
                )
                return 1
            print("API contract matches actual app.openapi().")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(generated.encode("utf-8"))
            print(f"Exported API contract: {args.output}")
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"Contract export failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
