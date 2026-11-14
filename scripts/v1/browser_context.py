"""Parent-bound browser acceptance context; no browser or application imports.

This is an accidental-instance/fixture boundary, not a hostile same-UID sandbox.
Only local_check's direct child may use its private context and one-run token.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING or __package__:
    from .runtime_lifecycle import (
        OwnedProcess,
        listener_inodes,
        owned_socket_inodes,
        process_identity,
        validate_ports,
    )
else:
    from runtime_lifecycle import (
        OwnedProcess,
        listener_inodes,
        owned_socket_inodes,
        process_identity,
        validate_ports,
    )

ROOT = Path(__file__).resolve().parents[2]


def verify_artifact(source_root: Path, artifact: Path) -> dict[str, Any]:
    # Lazy so importing the browser harness never performs artifact/build work.
    if TYPE_CHECKING or __package__:
        from .artifact_identity import verify_artifact as verify
    else:
        from artifact_identity import verify_artifact as verify
    return verify(source_root, artifact)


def process_state(pid: int) -> str:
    return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]


def no_links(path: Path):
    if not path.is_absolute() or any(
        part.is_symlink() for part in (path, *path.parents)
    ):
        raise ValueError("Acceptance paths must be absolute and contain no symlinks")


def read_context(path: Path) -> bytes:
    no_links(path)
    if path.name != "browser-run-context.json":
        raise ValueError("Invalid browser context filename")
    directory = path.parent.stat()
    if (
        not stat.S_ISDIR(directory.st_mode)
        or directory.st_uid != os.getuid()
        or stat.S_IMODE(directory.st_mode) != 0o700
    ):
        raise ValueError("Browser context must be in an owner-only run directory")
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("Browser context must be an owner-only regular file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1
            or info.st_size > 65536
        ):
            raise ValueError("Browser context must be an owner-only regular file")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            return handle.read(65537)
    finally:
        os.close(fd)


@dataclass(frozen=True)
class Observer:
    """Read-only process observer; never adopts or signals another process."""

    pid: int
    identity: tuple[int, int, int]

    def verify_identity(self):
        if process_identity(self.pid) != self.identity or process_state(self.pid) in {
            "Z",
            "X",
        }:
            raise RuntimeError("Acceptance process identity is no longer alive")


@dataclass(frozen=True)
class BrowserContext:
    path: Path
    digest: str
    data: dict[str, Any]

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.data['ports']['frontend']}"

    @property
    def notebook(self) -> str:
        return self.data["notebook_id"]

    @property
    def out(self) -> Path:
        return Path(self.data["out"])

    @property
    def navigation_cases(self) -> Path:
        return Path(self.data["navigation_cases"])

    @property
    def password(self) -> str:
        password = os.environ.get("OPEN_NOTEBOOK_PASSWORD", "")
        if not password:
            raise ValueError("Parent fixture authentication is required")
        return password

    @property
    def evidence(self) -> dict[str, Any]:
        return {
            "run_id": self.data["run_id"],
            "manifest_sha256": self.data["manifest_sha256"],
            "ports": self.data["ports"],
        }

    def assert_runtime(self):
        data = self.data
        parent = data["parent_pid"]
        if (
            os.getppid() != parent
            or process_identity(parent)[2] != data["parent_start_ticks"]
            or process_state(parent) in {"Z", "X"}
        ):
            raise RuntimeError("Browser acceptance requires its live owning parent")
        for name, port in data["ports"].items():
            record = data["processes"][name]
            observer = Observer(record["pid"], tuple(record["identity"]))
            observer.verify_identity()
            inodes = listener_inodes(port)
            if not inodes or not inodes <= owned_socket_inodes(
                cast(OwnedProcess, observer)
            ):
                raise RuntimeError(
                    "Browser acceptance listener is not owned by this run"
                )
            observer.verify_identity()

    def recheck(self):
        if hashlib.sha256(read_context(self.path)).hexdigest() != self.digest:
            raise ValueError("Browser acceptance context changed during the run")
        self.assert_runtime()
        manifest = verify_artifact(
            Path(self.data["source_root"]), Path(self.data["artifact_path"])
        )
        if manifest.get("manifest_sha256") != self.data["manifest_sha256"]:
            raise ValueError("Browser acceptance artifact identity changed")


def load_context(path: Path) -> BrowserContext:
    raw = read_context(path)
    try:
        data = json.loads(raw)
        required = {
            "schema",
            "parent_pid",
            "parent_start_ticks",
            "run_id",
            "token_sha256",
            "source_root",
            "artifact_path",
            "manifest_sha256",
            "ports",
            "processes",
            "notebook_id",
            "navigation_cases",
            "out",
        }
        if (
            not isinstance(data, dict)
            or set(data) != required
            or type(data["schema"]) is not int
            or data["schema"] != 1
        ):
            raise ValueError
        for key in ("parent_pid", "parent_start_ticks"):
            if type(data[key]) is not int or data[key] <= 0:
                raise ValueError
        for key, length in (
            ("run_id", 32),
            ("token_sha256", 64),
            ("manifest_sha256", 64),
        ):
            if (
                not isinstance(data[key], str)
                or re.fullmatch(f"[0-9a-f]{{{length}}}", data[key]) is None
            ):
                raise ValueError
        token = os.environ.get("STUDY_WORKBENCH_ACCEPTANCE_TOKEN", "")
        if len(token) < 16 or not hmac.compare_digest(
            hashlib.sha256(token.encode()).hexdigest(), data["token_sha256"]
        ):
            raise ValueError
        source = Path(data["source_root"])
        artifact = Path(data["artifact_path"])
        no_links(source)
        no_links(artifact)
        if source != ROOT or not artifact.is_dir():
            raise ValueError
        ports = data["ports"]
        if (
            not isinstance(ports, dict)
            or set(ports) != {"database", "api", "frontend"}
            or any(type(port) is not int for port in ports.values())
        ):
            raise ValueError
        validate_ports(tuple(ports.values()))
        processes = data["processes"]
        if not isinstance(processes, dict) or set(processes) != set(ports):
            raise ValueError
        pids = set()
        for record in processes.values():
            if (
                not isinstance(record, dict)
                or set(record) != {"pid", "identity"}
                or type(record["pid"]) is not int
                or record["pid"] <= 0
            ):
                raise ValueError
            identity = record["identity"]
            if (
                not isinstance(identity, list)
                or len(identity) != 3
                or any(type(value) is not int or value <= 0 for value in identity)
                or identity[:2] != [record["pid"], record["pid"]]
            ):
                raise ValueError
            pids.add(record["pid"])
        if len(pids) != 3 or data["parent_pid"] in pids:
            raise ValueError
        if (
            not isinstance(data["notebook_id"], str)
            or not data["notebook_id"].startswith("notebook:")
            or len(data["notebook_id"]) > 256
        ):
            raise ValueError
        out = Path(data["out"])
        navigation = Path(data["navigation_cases"])
        if (
            out != path.parent / "screenshots"
            or navigation != path.parent / "navigation-cases.json"
        ):
            raise ValueError
        no_links(out)
        no_links(navigation)
        info = navigation.stat()
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise ValueError
    except (ValueError, TypeError, KeyError, OSError):
        raise ValueError("Invalid parent-owned browser acceptance context") from None
    context = BrowserContext(path, hashlib.sha256(raw).hexdigest(), data)
    context.password
    context.recheck()
    return context
