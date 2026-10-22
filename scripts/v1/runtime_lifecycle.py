"""Narrow Linux-only lifecycle primitives; never discover/stop foreign services.

Owned leaders are deliberately left waitable (WNOWAIT) until group cleanup ends.
This pins their PID, including after exit, so a reused numeric PID cannot become
our cleanup target. Do not call the underlying Popen.poll/wait elsewhere.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

import httpx

SAFE_INHERITED_ENV = frozenset({"PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"})
PORTS = (18000, 5055, 13000)


def process_identity(pid: int) -> tuple[int, int, int]:
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[2]), int(fields[3]), int(fields[19])


class OwnedProcess:
    """A newly spawned session leader, never reaped until all signals are sent."""

    def __init__(self, process):
        self.process = process
        self.pid = process.pid
        self.identity = process_identity(self.pid)
        self.closed = False
        if self.identity[:2] != (self.pid, self.pid):
            raise RuntimeError("Child did not establish its owned session")

    def verify_identity(self):
        if self.closed or process_identity(self.pid) != self.identity:
            raise RuntimeError("Owned process identity changed; refusing to signal")

    def poll(self):
        if self.closed:
            return self.process.returncode
        self.verify_identity()
        try:
            result = os.waitid(os.P_PID, self.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            raise RuntimeError("Owned child was unexpectedly reaped") from None
        if result is None:
            return None
        return (
            result.si_status if result.si_code == os.CLD_EXITED else -result.si_status
        )


def start_owned(args, **kwargs) -> OwnedProcess:
    process = subprocess.Popen(args, **kwargs, start_new_session=True, umask=0o077)
    try:
        return OwnedProcess(process)
    except BaseException:
        # Popen's exec handshake guarantees setsid succeeded. Confirm that this
        # exact newly created child remains waitable before using its session ID.
        # No poll/wait may reap it until the group signal has been delivered.
        os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise


def stop_processes(processes, *, grace: float = 10):
    """Clean valid owned sessions even if another record cannot be verified."""
    owned = []
    errors = []
    for proc in reversed(processes):
        try:
            if not isinstance(proc, OwnedProcess):
                raise TypeError("Cleanup requires registered owned processes")
            if not proc.closed:
                proc.verify_identity()
                owned.append(proc)
        except (RuntimeError, OSError, TypeError) as error:
            errors.append(error)
    for proc in owned:
        try:
            proc.verify_identity()
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except (RuntimeError, OSError) as error:
            errors.append(error)
    if owned and grace:
        time.sleep(grace)
    # Reap only after escalation, preserving the dead leader's pinned session ID.
    for proc in owned:
        try:
            proc.verify_identity()
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.process.wait()
            proc.closed = True
        except (RuntimeError, OSError) as error:
            errors.append(error)
    if errors:
        if isinstance(errors[0], TypeError):
            raise TypeError("Cleanup requires registered owned processes")
        raise RuntimeError(
            "Owned process identity/cleanup failed; uncertain groups were not signaled"
        ) from None


def validate_ports(ports):
    if (
        len(ports) != 3
        or len(set(ports)) != 3
        or any(not 1 <= p <= 65535 for p in ports)
    ):
        raise ValueError("Ports must be three distinct integers between 1 and 65535")


def select_unused_ports() -> tuple[int, int, int]:
    """Selection only; recheck before startup and verify listener ownership later."""
    sockets = []
    try:
        for _ in range(3):
            sock = socket.socket()
            sockets.append(sock)
            sock.bind(("127.0.0.1", 0))
        return tuple(sock.getsockname()[1] for sock in sockets)
    finally:
        for sock in sockets:
            sock.close()


def require_free_ports(ports=PORTS):
    validate_ports(ports)
    for port in ports:
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                raise RuntimeError(
                    "Required loopback port is occupied; no services started"
                ) from None


def verify_loopback_listeners(ports=PORTS):
    for filename, allowed in (
        ("tcp", "0100007F"),
        ("tcp6", "00000000000000000000000001000000"),
    ):
        for line in Path("/proc/net", filename).read_text().splitlines()[1:]:
            fields = line.split()
            address, port = fields[1].split(":")
            if fields[3] == "0A" and int(port, 16) in ports and address != allowed:
                raise RuntimeError(
                    "Runtime port has a non-loopback listener; stopping owned services"
                )


def listener_inodes(port: int) -> set[str]:
    verify_loopback_listeners((port,))
    result = set()
    for filename in ("tcp", "tcp6"):
        for line in Path("/proc/net", filename).read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == "0A" and int(fields[1].split(":")[1], 16) == port:
                result.add(fields[9])
    return result


def owned_socket_inodes(proc: OwnedProcess) -> set[str]:
    proc.verify_identity()
    result = set()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            group, session, _ = process_identity(int(entry.name))
            if (group, session) != (proc.pid, proc.pid):
                continue
            for fd in (entry / "fd").iterdir():
                try:
                    target = os.readlink(fd)
                except FileNotFoundError:
                    continue
                if target.startswith("socket:["):
                    result.add(target[8:-1])
        except (FileNotFoundError, ProcessLookupError):
            continue
    proc.verify_identity()
    return result


def owned_listener_ready(proc: OwnedProcess, port: int) -> bool:
    inodes = listener_inodes(port)
    if not inodes:
        return False
    if not inodes <= owned_socket_inodes(proc):
        raise RuntimeError("Runtime listener is not owned by this run")
    return True


def require_owned_listener(proc: OwnedProcess, port: int):
    if (
        proc.poll() is not None
        or not owned_listener_ready(proc, port)
        or proc.poll() is not None
    ):
        raise RuntimeError("Required owned listener is no longer alive")
    return True


def wait_for_service(
    name: str,
    proc,
    probe: Callable[[], bool],
    timeout: float = 120,
    *,
    guard: Callable[[], bool] = lambda: True,
):
    deadline = time.monotonic() + timeout
    while True:
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited before readiness; inspect private logs")
        ready = guard() and probe()
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited during readiness; inspect private logs")
        if ready and guard():
            return
        if time.monotonic() >= deadline:
            raise RuntimeError(f"{name} readiness timed out; inspect private logs")
        time.sleep(min(0.25, max(0, deadline - time.monotonic())))


def http_ready(url: str) -> bool:
    try:
        return httpx.get(url, timeout=1, trust_env=False).status_code == 200
    except httpx.HTTPError:
        return False
