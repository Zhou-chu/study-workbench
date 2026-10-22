"""Run the bounded historical DB gates on an owned memory-only Surreal 2.3.10.

Never accepts a database URL or forwards ambient credentials. Python connection
tripwire permits only the owned endpoint (not an OS firewall). No provider calls.
"""

import argparse
import hashlib
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.offline_pytest import build_environment, prepare_cache  # noqa: E402
from scripts.v1 import runtime_lifecycle as lifecycle  # noqa: E402

SHA256 = "bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7"
TESTS = [
    "tests/test_v1_device_session_repository.py",
    "tests/test_v1_note_repository.py",
    "tests/test_v1_source_snapshot_repository.py",
    "tests/test_v1_portable_roundtrip.py::test_real_surreal_sqlite_and_originals_restore_into_fresh_environment",
    "tests/test_web_discovery_repository.py",
]


def build_test_environment(run, inherited, url):
    env = build_environment(run, inherited)
    env.update(
        SURREAL_URL=url,
        AUTH_TEST_SURREAL_URL=url,
        SURREAL_USER="synthetic",
        SURREAL_PASSWORD="synthetic",
        SURREAL_NAMESPACE="historical_" + uuid4().hex,
        SURREAL_DATABASE="unused_" + uuid4().hex,
        STUDY_WORKBENCH_TEST_SURREAL="1",
        WEB_DISCOVERY_TEST_DB="1",
    )
    return env


def network_guard(port, event, args):
    if event == "socket.getaddrinfo":
        if args[:2] != ("127.0.0.1", port):
            raise OSError("Only numeric owned database resolution allowed")
    elif event in {
        "socket.gethostbyname",
        "socket.gethostbyaddr",
        "socket.getnameinfo",
    }:
        raise OSError("DNS disabled for synthetic database tests")
    elif event in {"socket.connect", "socket.sendto", "socket.bind"} and args[
        0
    ].family in {socket.AF_INET, socket.AF_INET6}:
        if event != "socket.connect" or args[1] != ("127.0.0.1", port):
            raise OSError("Only owned synthetic database connections allowed")


def child_main(port):
    sys.addaudithook(lambda event, args: network_guard(port, event, args))
    import pytest

    import open_notebook

    assert Path(open_notebook.__file__).resolve().parent == ROOT / "open_notebook"
    print(f"Historical DB test source: {ROOT}", flush=True)
    return pytest.main(
        [
            "-p",
            "pytest_asyncio.plugin",
            *TESTS,
            "-v",
            "-ra",
            "-o",
            f"cache_dir={os.environ['TMPDIR']}/pytest-cache",
            "--basetemp",
            f"{os.environ['TMPDIR']}/pytest-tmp",
        ]
    )


@contextmanager
def owned_processes():
    """SIGTERM unwinds through registered child cleanup; SIGKILL cannot."""
    processes: list[lifecycle.OwnedProcess] = []

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    previous = signal.signal(signal.SIGTERM, terminate)
    try:
        yield processes
    finally:
        # A repeated SIGTERM must not interrupt identity-checked cleanup.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            lifecycle.stop_processes(processes)
            assert all(process.closed for process in processes)
            print("Owned database and test sessions cleaned up", flush=True)
        finally:
            signal.signal(signal.SIGTERM, previous)


def start_registered(processes, args, **kwargs):
    # Defer SIGTERM until the new session is registered for cleanup. The child
    # must not inherit a blocked SIGTERM mask (Popen restores dispositions, not
    # this mask), so use a handler deferral instead of pthread_sigmask.
    pending = []
    previous = signal.signal(
        signal.SIGTERM, lambda signum, frame: pending.append(signum)
    )
    try:
        process = lifecycle.start_owned(args, **kwargs)
        processes.append(process)
        return process
    finally:
        signal.signal(signal.SIGTERM, previous)
        if pending:
            raise SystemExit(128 + pending[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--surreal-binary", type=Path, required=True)
    parser.add_argument("--tiktoken-cache", type=Path, required=True)
    options = parser.parse_args()
    binary = options.surreal_binary.resolve(strict=True)
    if (
        not binary.is_file()
        or not os.access(binary, os.X_OK)
        or hashlib.sha256(binary.read_bytes()).hexdigest() != SHA256
    ):
        parser.error("Requires executable official SurrealDB 2.3.10 with pinned digest")
    with tempfile.TemporaryDirectory(prefix="historical-db-", dir="/tmp") as temporary:
        run = Path(temporary)
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        env = build_test_environment(run, os.environ, f"ws://127.0.0.1:{port}/rpc")
        prepare_cache(options.tiktoken_cache.resolve(), Path(env["TIKTOKEN_CACHE_DIR"]))
        with owned_processes() as processes, (run / "server.log").open("wb") as log:
            process = start_registered(
                processes,
                [
                    str(binary),
                    "start",
                    "--bind",
                    f"127.0.0.1:{port}",
                    "--user",
                    "synthetic",
                    "--pass",
                    "synthetic",
                    "memory",
                ],
                cwd=run,
                env={"PATH": "/usr/bin:/bin", "HOME": str(run)},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            lifecycle.wait_for_service(
                "historical database",
                process,
                lambda: lifecycle.http_ready(f"http://127.0.0.1:{port}/health"),
                timeout=15,
                guard=lambda: lifecycle.owned_listener_ready(process, port),
            )
            lifecycle.require_owned_listener(process, port)
            child = start_registered(
                processes,
                [
                    sys.executable,
                    "-I",
                    str(Path(__file__).resolve()),
                    "--_child",
                    str(port),
                ],
                cwd=ROOT,
                env=env,
            )
            # Keep the exited leader waitable until identity-checked cleanup.
            while (returncode := child.poll()) is None:
                time.sleep(0.1)
            lifecycle.require_owned_listener(process, port)
            return returncode


if __name__ == "__main__":
    if sys.argv[1:2] == ["--_child"]:
        raise SystemExit(child_main(int(sys.argv[2])))
    raise SystemExit(main())
