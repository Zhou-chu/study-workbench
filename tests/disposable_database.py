"""Opt-in memory-only test database using the reviewed owned-session lifecycle.

Port selection is not atomic reservation; readiness verifies listener ownership
before HTTP traffic. This is not an adversarial same-UID security boundary.
"""

import hashlib
import os
import socket
import subprocess
from contextlib import contextmanager
from pathlib import Path

import pytest

from scripts.v1 import runtime_lifecycle as lifecycle

SHA256 = "bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7"


@contextmanager
def disposable_database(tmp_path_factory, prefix, directory_name):
    if os.getenv(f"{prefix}_DISPOSABLE_DB") != "1":
        pytest.skip("requires explicitly enabled owned disposable database")
    selected = os.getenv(f"{prefix}_TEST_SURREAL_BINARY")
    if not selected:
        pytest.fail(
            f"Set {prefix}_TEST_SURREAL_BINARY to an explicitly selected verified SurrealDB 2.3.10 executable"
        )
    binary = Path(selected).expanduser().resolve(strict=True)
    assert binary.is_file() and os.access(binary, os.X_OK), (
        "fixture binary must be executable"
    )
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == SHA256, (
        "fixture requires the documented official 2.3.10 binary digest"
    )
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    directory = tmp_path_factory.mktemp(directory_name)
    with (directory / "server.log").open("wb") as log:
        process = lifecycle.start_owned(
            [
                str(binary),
                "start",
                "--bind",
                f"127.0.0.1:{port}",
                "--user",
                "public_fixture",
                "--pass",
                "public_fixture",
                "memory",
            ],
            cwd=directory,
            env={"PATH": "/usr/bin:/bin", "HOME": str(directory)},
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            lifecycle.wait_for_service(
                "disposable database",
                process,
                lambda: lifecycle.http_ready(f"http://127.0.0.1:{port}/health"),
                timeout=15,
                guard=lambda: lifecycle.owned_listener_ready(process, port),
            )
            yield f"ws://127.0.0.1:{port}/rpc"
        finally:
            lifecycle.stop_processes([process])
