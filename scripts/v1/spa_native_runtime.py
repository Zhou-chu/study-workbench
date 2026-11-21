"""Opt-in foreground native synthetic checks. Never browser or production evidence."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import secrets
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

import httpx

if TYPE_CHECKING or __package__:
    from . import runtime_lifecycle as life
    from . import spa_acceptance as gate
else:
    import runtime_lifecycle as life
    import spa_acceptance as gate

ROOT = Path(__file__).absolute().parents[2]
RUN_PARENT = Path("/tmp")
BASE = "46ec5bf53f70ebf34b1d8ff332b63f0b0ce5f115"
DEPLOY = gate.DEPLOY
PYTHON = gate.PYTHON
NODE = gate.NODE
SURREAL = DEPLOY / "source/.runtime/bin/surreal"
WORKER = DEPLOY / "source/.venv/bin/surreal-commands-worker"
FORBIDDEN_PORTS = {3000, 5055, 5056, 8000, 13000, 13001, 18000, 18001}
UPLOAD = "tests/fixtures/v1/fixture_course.md"
UPLOAD_SHA = "20e21965df9711d91e8e2b03dd890a453f0a71bc5092c7eb251c43e4c664effa"
TOKEN_FILE = "fb374d419588a4632f3f557e76b4b70aebbca790"
TOKEN_SHA = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d"


def environments(root: Path, ports: tuple[int, int, int]) -> dict[str, dict[str, str]]:
    db, api, bff = ports
    common = {
        "PATH": f"{PYTHON.parent}:{NODE.parent}:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "TZ": "UTC",
        "HOME": str(root / "home"),
        "XDG_CONFIG_HOME": str(root / "home/config"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "TMPDIR": str(root / "tmp"),
        "PYTHON_DOTENV_DISABLED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    database = {
        **common,
        "SURREAL_USER": "root",
        "SURREAL_PASS": secrets.token_urlsafe(32),
        "SURREAL_UNAUTHENTICATED": "false",
        "SURREAL_ONLINE_VERSION_CHECK": "false",
    }
    backend = {
        **common,
        "PYTHONPATH": str(ROOT),
        "PYTHONNOUSERSITE": "1",
        "SURREAL_URL": f"ws://127.0.0.1:{db}/rpc",
        "SURREAL_USER": "root",
        "SURREAL_PASSWORD": database["SURREAL_PASS"],
        "SURREAL_PASS": database["SURREAL_PASS"],
        "SURREAL_NAMESPACE": "native_" + secrets.token_hex(16),
        "SURREAL_DATABASE": "native_" + secrets.token_hex(16),
        "SURREAL_UNAUTHENTICATED": "false",
        "OPEN_NOTEBOOK_PASSWORD": secrets.token_urlsafe(32),
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": secrets.token_urlsafe(32),
        "STUDY_WORKBENCH_AUTH_MODE": "legacy_password",
        "STUDY_WORKBENCH_PRIVATE_MODE": "1",
        "STUDY_WORKBENCH_RUNTIME_DIR": str(root),
        "STUDY_WORKBENCH_DATA_DIR": str(root / "personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(root / "upstream-data"),
        "TIKTOKEN_CACHE_DIR": str(root / "cache/tiktoken"),
        "NOTEBOOKLM_HOME": str(root / "no-google-profile"),
        "NOTEBOOKLM_STORAGE_PATH": str(root / "no-google-profile/storage_state.json"),
        "CORS_ORIGINS": f"http://127.0.0.1:{bff}",
        "OPEN_NOTEBOOK_DISABLE_UPDATE_CHECK": "1",
        "LOGURU_DIAGNOSE": "NO",
    }
    frontend = {
        **common,
        "INTERNAL_API_URL": f"http://127.0.0.1:{api}",
        "STUDY_WORKBENCH_AUTH_MODE": "legacy_password",
        "STUDY_WORKBENCH_WEB_ORIGIN": f"http://127.0.0.1:{bff}",
        "STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK": "true",
        "STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH": "true",
        "STUDY_WORKBENCH_BFF_LISTEN_HOST": "127.0.0.1",
        "NODE_ENV": "test",
        "PORT": str(bff),
    }
    return {"db": database, "api": backend, "worker": dict(backend), "bff": frontend}


def select_ports() -> tuple[int, int, int]:
    ports = life.select_unused_ports()
    life.validate_ports(ports)
    if FORBIDDEN_PORTS.intersection(ports):
        raise ValueError("Selected port is protected; no services started")
    return ports


def create_root(root: Path) -> dict[str, Any]:
    root = gate.absolute(root)
    if root.parent != RUN_PARENT or not re.fullmatch(
        r"[A-Za-z0-9_-]{1,100}", root.name
    ):
        raise ValueError("Fresh direct temporary child required")
    if any(gate.overlap(root, p) for p in gate.PROTECTED_ROOTS):
        raise ValueError("Protected root")
    parent = gate.directory(root.parent)
    try:
        info = os.fstat(parent)
        if info.st_uid != os.getuid() and not (
            info.st_uid == 0 and info.st_mode & stat.S_ISVTX
        ):
            raise ValueError("Unowned temporary parent")
        os.mkdir(root.name, 0o700, dir_fd=parent)
        result = gate.identity(root, True)
        if result["device"] != info.st_dev:
            raise ValueError("Root device changed")
        return result
    finally:
        os.close(parent)


DEPENDENCIES = {
    "surreal-commands": "1.3.1",
    "surrealdb": "1.0.8",
    "uvicorn": "0.40.0",
    "fastapi": "0.136.3",
    "httpx": "0.28.1",
    "python-dotenv": "1.2.2",
    "esperanto": "2.28.0",
}
PYTHON_TARGET = DEPLOY / "tools/python/cpython-3.12.14-linux-x86_64-gnu/bin/python3.12"
WORKER_MODULE = (
    DEPLOY / "source/.venv/lib/python3.12/site-packages/surreal_commands/cli/worker.py"
)
PINS = {
    SURREAL: "bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7",
    NODE: "bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12",
    PYTHON_TARGET: "8f9781a98200d9ecda7e00464e4c64b1327abae788ae8e6979d5c859311410c7",
    WORKER: "fd6e0f65f88f3533f13596eb06f6718bbd3bb012a04b58095104c8ca1f283ad8",
    WORKER_MODULE: "cdfa76f3c6e142391d8c520ac4fa4d7537a1cc52a900c9ff9f6a07976d9de15f",
    gate.GIT: "4972b52f68a5955a499eb0c64b91d46dfcb87231a52c710d92e00b07b3114483",
}
HELPERS = {
    "scripts/v1/spa_acceptance.py": "505c29848b90241a0bda8ddc83331c0550c44303d00e3efd07b09b425de42e27",
    "scripts/v1/runtime_lifecycle.py": "56d01a5104961a76bf934f4a00e6175ede4ace047eda055c005a3f4998a185d3",
}
MODULE_PROBE = """
import importlib.machinery as machinery, importlib.metadata as metadata, json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
origins = {}
for name in ("api", "commands", "open_notebook"):
    spec = machinery.PathFinder.find_spec(name, sys.path)
    if spec is None or not spec.origin:
        raise RuntimeError("Missing candidate module")
    if name == "api":
        spec = machinery.PathFinder.find_spec("api.main", list(spec.submodule_search_locations))
        name = "api.main"
    origins[name] = spec.origin
print(json.dumps({"origins": origins, "versions": {
    name: metadata.version(name) for name in json.loads(sys.argv[2])
}}))
"""


def file_record(path: Path, expected: str, *, links: int = 1) -> dict[str, Any]:
    """No-follow bounded streaming hash, including binaries above C2's 32-MiB cap."""
    parent = gate.directory(path.parent)
    try:
        fd = os.open(
            path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent
        )
        with os.fdopen(fd, "rb") as handle:
            before = os.fstat(handle.fileno())
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_nlink != links
                or before.st_size > 256 * 1024 * 1024
            ):
                raise ValueError("Executable/file custody rejected")
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
            after = os.fstat(handle.fileno())
            if (
                before.st_ino,
                before.st_dev,
                before.st_size,
                before.st_mtime_ns,
                before.st_ctime_ns,
            ) != (
                after.st_ino,
                after.st_dev,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            ) or digest != expected:
                raise ValueError("Prepared file identity changed")
            return {
                "path": str(path),
                "sha256": digest,
                "size": before.st_size,
                "links": before.st_nlink,
            }
    finally:
        os.close(parent)


def validate_modules(record: dict[str, Any]) -> None:
    expected = {
        name: str(ROOT / path)
        for name, path in {
            "api.main": "api/main.py",
            "commands": "commands/__init__.py",
            "open_notebook": "open_notebook/__init__.py",
        }.items()
    }
    if record != {"origins": expected, "versions": DEPENDENCIES}:
        raise ValueError("Candidate module origin/dependency mismatch")


def verify_tools() -> dict[str, Any]:
    # All file identities are checked before executing any version/import probe.
    records = [
        file_record(p, digest, links={gate.GIT: 150, WORKER_MODULE: 2}.get(p, 1))
        for p, digest in PINS.items()
    ]
    fd = gate.directory(PYTHON.parent)
    try:
        if os.readlink(PYTHON.name, dir_fd=fd) != str(PYTHON_TARGET):
            raise ValueError("Unapproved interpreter symlink")
    finally:
        os.close(fd)
    versions = {}
    for name, argv, expected in (
        ("surreal", [str(SURREAL), "version"], "2.3.10"),
        ("node", [str(NODE), "--version"], "v24.19.0"),
        ("python", [str(PYTHON), "-I", "-B", "--version"], "Python 3.12.14"),
    ):
        value = gate.command(argv, ROOT)
        if (name == "surreal" and not re.fullmatch(r"2\.3\.10(?:[ +].*)?", value)) or (
            name != "surreal" and value != expected
        ):
            raise ValueError("Prepared executable version mismatch")
        versions[name] = value
    modules = json.loads(
        gate.command(
            [
                str(PYTHON),
                "-I",
                "-B",
                "-c",
                MODULE_PROBE,
                str(ROOT),
                json.dumps(list(DEPENDENCIES)),
            ],
            ROOT,
        )
    )
    validate_modules(modules)
    return {
        "files": records,
        "versions": versions,
        "module_resolution": modules,
        "application_imports": "deferred_to_owned_bootstrap",
    }


def verify_native_source(expected: str) -> None:
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{40}", expected):
        raise ValueError("Explicit reviewed source commit required")
    if (
        ROOT != gate.APPROVED_SOURCE_ROOT
        or gate.git(ROOT, "rev-parse", "HEAD") != expected
    ):
        raise ValueError("Expected clean source commit mismatch")
    gate.git(ROOT, "merge-base", "--is-ancestor", BASE, "HEAD")
    for name, digest in HELPERS.items():
        file_record(ROOT / name, digest)
    path = "scripts/v1/spa_native_runtime.py"
    if (
        gate.git(ROOT, "show", f"HEAD:{path}")
        != gate.read_file(ROOT / path).decode().strip()
    ):
        raise ValueError("Runtime entrypoint is not the committed source")


def public_bytes() -> tuple[bytes, bytes]:
    upload = gate.read_file(ROOT / UPLOAD)
    tokenizer = gate.read_file(DEPLOY / "prepared-tokenizer" / TOKEN_FILE)
    if gate.sha(upload) != UPLOAD_SHA or gate.sha(tokenizer) != TOKEN_SHA:
        raise ValueError("Public upload/tokenizer identity mismatch")
    return upload, tokenizer


def preflight(fixture: str, gateway: Path, source_commit: str) -> dict[str, Any]:
    for name, digest in HELPERS.items():
        file_record(ROOT / name, digest)
    tools = verify_tools()
    verify_native_source(source_commit)
    inputs = gate.verify_inputs(
        source_root=ROOT,
        fixture=fixture,
        web=ROOT / "apps/web/dist",
        bff=ROOT / "apps/bff/dist",
        gateway=gate.absolute(gateway),
        contract=ROOT / "contracts/v1/openapi.json",
    )
    public_bytes()
    return {"inputs": inputs, "tools": tools}


def require_free(port: int) -> None:
    if port in FORBIDDEN_PORTS or life.listener_inodes(port):
        raise RuntimeError("Port is protected or occupied")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", port))


def require(condition: Any) -> None:
    if not condition:
        raise RuntimeError("Synthetic check failed")


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_:-]{1,150}", value):
        raise RuntimeError("Invalid synthetic identifier")
    return value


class Transaction:
    """Exact local requests, bounded observations, no unknown-outcome replay."""

    def __init__(
        self, client, guard, password, *, clock=time.monotonic, sleep=time.sleep
    ):
        self.client, self.guard, self.password = client, guard, password
        self.clock, self.sleep = clock, sleep
        self.deadline = clock() + 300
        self.counts = {"attempted": 0, "completed": 0, "mutations": 0}
        self.events: list[dict[str, Any]] = []
        self.result: dict[str, Any] = {}

    def request(
        self, label, method, path, expected=200, *, auth=True, mutation=False, **kwargs
    ):
        self.guard()
        if self.clock() >= self.deadline or self.counts["attempted"] >= 800:
            raise TimeoutError("Transaction request budget exhausted")
        if (
            not path.startswith("/")
            or path.startswith("//")
            or "?" in path
            or "#" in path
        ):
            raise RuntimeError("Nonlocal request rejected")
        headers = {"Authorization": "Bearer " + self.password} if auth else {}
        self.counts["attempted"] += 1
        self.counts["mutations"] += int(mutation)
        event = {"step": label, "method": method, "outcome": "unknown"}
        self.events.append(event)
        try:
            # A stream enforces a response cap and wall-clock check between chunks.
            with self.client.stream(
                method,
                path,
                headers=headers,
                follow_redirects=False,
                timeout=min(10, self.deadline - self.clock()),
                **kwargs,
            ) as response:
                body = bytearray()
                for chunk in response.iter_bytes():
                    if (
                        self.clock() >= self.deadline
                        or len(body) + len(chunk) > 16 * 1024 * 1024
                    ):
                        raise TimeoutError("Response budget exhausted")
                    body.extend(chunk)
                self.guard()
                self.counts["completed"] += 1
                event.update(status=response.status_code, outcome="received")
                require(response.status_code == expected)
                return httpx.Response(response.status_code, content=bytes(body))
        except httpx.HTTPError:
            raise RuntimeError("Request outcome unknown; no replay") from None

    def read(self, label, path):
        return self.request(label, "GET", path).json()

    def poll_job(self, notebook, job_id, label):
        deadline = min(self.deadline, self.clock() + 90)
        while self.clock() < deadline:
            workspace = self.read(
                label, f"/api/personal/notebooks/{quote(notebook, safe='')}/workspace"
            )
            jobs = [j for j in workspace["jobs"] if j.get("job_id") == job_id]
            require(len(jobs) <= 1)
            if jobs and jobs[0].get("state") == "succeeded":
                return jobs[0]
            if jobs and jobs[0].get("state") in {
                "failed",
                "cancelled",
                "cancelled_local",
            }:
                raise RuntimeError("Synthetic job failed")
            # Unknown submission is read-only observed, never redispatched.
            self.sleep(min(0.5, max(0, deadline - self.clock())))
        raise TimeoutError("Synthetic job deadline exceeded")

    def check_workspace(self, workspace, notebook, version, note_id=None):
        require(workspace["notebook"]["id"] == notebook)
        require(workspace["selection"]["source_version_ids"] == [version])
        require(
            any(
                v["source_version_id"] == version
                for s in workspace["sources"]
                for v in s["versions"]
            )
        )
        if note_id is not None:
            require(
                any(
                    n.get("id") == note_id
                    and n.get("content") == "Retained public synthetic note"
                    and n.get("scope_snapshot", {}).get("source_version_ids")
                    == [version]
                    for n in workspace["notes"]
                )
            )

    def execute(self, content: bytes) -> dict[str, Any]:
        config = self.read("config", "/config")
        # The real BFF declares an empty API base for same-origin routing.
        # Never accept a different destination from configuration received here.
        require(
            config
            == {
                "apiUrl": "",
                "auth_mode": "legacy_password",
                "web_session_protocol": None,
                "client_contracts": ["workspace-view-v1"],
                "ui_transport_protocol": 1,
            }
            and type(config["ui_transport_protocol"]) is int
        )
        status = self.read("auth_status", "/api/auth/status")
        require(status.get("auth_enabled") is True)
        self.request(
            "anonymous_denied",
            "GET",
            "/api/personal/notebooks/synthetic-denied/workspace",
            401,
            auth=False,
        )
        nb = identifier(
            self.request(
                "create_notebook",
                "POST",
                "/api/notebooks",
                200,
                mutation=True,
                json={
                    "name": "Native public fixture",
                    "description": "Owned synthetic acceptance",
                },
            ).json()["id"]
        )
        base = f"/api/personal/notebooks/{quote(nb, safe='')}"
        key = secrets.token_hex(16)
        upload = self.request(
            "upload",
            "POST",
            base + "/sources/upload",
            200,
            mutation=True,
            data={"idempotency_key": key},
            files={"file": ("fixture_course.md", content, "text/markdown")},
        ).json()
        upload = {
            k: identifier(upload[k])
            for k in ("source_id", "source_version_id", "job_id")
        }
        self.result["upload"] = upload
        self.poll_job(nb, upload["job_id"], "extract_poll")
        self.result["worker_completion"] = "extraction_succeeded"
        duplicate = self.request(
            "upload_same_key",
            "POST",
            base + "/sources/upload",
            200,
            mutation=True,
            data={"idempotency_key": key},
            files={"file": ("fixture_course.md", content, "text/markdown")},
        ).json()
        require(all(duplicate.get(k) == v for k, v in upload.items()))
        workspace = self.read("dedup_workspace", base + "/workspace")
        matching = [j for j in workspace["jobs"] if j.get("job_id") == upload["job_id"]]
        require(len(matching) == 1)
        # This fresh notebook has exactly the original extraction job before export.
        require(len(workspace["jobs"]) == 1)
        version = upload["source_version_id"]
        version_path = "/api/personal/source-versions/" + quote(version, safe="")
        detail = self.read("extraction", version_path)
        require(detail["extraction"]["status"] == "ready")
        quote_text = detail["evidence"][0]["quote"]
        require(isinstance(quote_text, str) and quote_text.strip())
        original = self.request("original", "GET", version_path + "/download").content
        require(gate.sha(original) == gate.sha(content))
        selection = {
            "engine": "independent",
            "selection_origin": "local",
            "source_version_ids": [version],
            "remote_source_ids": [],
            "reading": {"source_version_id": version, "page_index": 0},
        }
        self.request(
            "selection", "PATCH", base + "/selection", mutation=True, json=selection
        )
        search = self.request(
            "lexical_search",
            "POST",
            "/api/personal/search",
            json={"query": quote_text[:20], "source_version_ids": [version]},
        ).json()
        require(search["hits"])
        note = self.request(
            "save_note",
            "POST",
            base + "/notes",
            200,
            mutation=True,
            json={
                "title": "Public evidence",
                "content": "Retained public synthetic note",
                "citations": [],
                "scope_snapshot": {"source_version_ids": [version]},
            },
        ).json()
        note_id = identifier(note["id"])
        for suffix in ("workspace", "workspace-view"):
            self.check_workspace(
                self.read(suffix, base + "/" + suffix), nb, version, note_id
            )
        self.result.update(
            notebook_id=nb,
            note_id=note_id,
            original_sha256=gate.sha(original),
            citation_validation="not_run",
            worker_completion="extraction_succeeded",
            native_checks="succeeded",
        )
        export = self.request(
            "export",
            "POST",
            base + "/exports",
            202,
            mutation=True,
            json={"idempotency_key": secrets.token_hex(16)},
        ).json()
        export_job = identifier(export["job_id"])
        self.result["export"] = {"job_id": export_job, "state": "submitted"}
        completed = self.poll_job(nb, export_job, "export_poll")
        export_id = identifier(completed["result"]["export_id"])
        self.result["export"].update(export_id=export_id, state="succeeded")
        archive = self.request(
            "export_download",
            "GET",
            "/api/personal/exports/" + quote(export_id, safe="") + "/download",
        ).content
        require(archive)
        restored = self.request(
            "portable_import",
            "POST",
            "/api/personal/imports/portable",
            201,
            mutation=True,
            files={"file": ("synthetic.zip", archive, "application/zip")},
        ).json()
        restored_nb = identifier(restored["notebook_id"])
        require(restored_nb != nb)
        restored_workspace = self.read(
            "import_workspace",
            "/api/personal/notebooks/" + quote(restored_nb, safe="") + "/workspace",
        )
        selected = restored_workspace["selection"]["source_version_ids"]
        require(len(selected) == 1)
        restored_version = identifier(selected[0])
        require(restored_version != version)
        self.check_workspace(restored_workspace, restored_nb, restored_version)
        restored_original = self.request(
            "import_original",
            "GET",
            "/api/personal/source-versions/"
            + quote(restored_version, safe="")
            + "/download",
        ).content
        require(gate.sha(restored_original) == gate.sha(content))
        self.result["portable"] = {
            "notebook_id": restored_nb,
            "source_version_id": restored_version,
            "export_id": export_id,
            "job_id": export_job,
            "zip_sha256": gate.sha(archive),
            "original_sha256": gate.sha(restored_original),
            "status": "succeeded",
        }
        return self.result


def copy_log(source, target: Path, secret_values: tuple[str, ...]) -> None:
    """Bounded private log; redact before disk, discard oversized lines entirely."""
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out:
        count = 0
        while True:
            line = source.readline(65537)
            if not line:
                return
            if len(line) > 65536:
                while line and not line.endswith(b"\n"):
                    line = source.readline(65537)
                line = b"[oversized log line suppressed]\n"
            for secret in secret_values:
                line = line.replace(secret.encode(), b"[REDACTED]")
            if count + len(line) <= 4 * 1024 * 1024:
                out.write(line)
                count += len(line)


def bootstrap(kind: str, port: int) -> list[str]:
    # -I ignores ambient/importable user paths; only this fixed checkout is prepended.
    check = (
        "import sys; from pathlib import Path; "
        f"sys.path.insert(0, {str(ROOT)!r}); "
        "import open_notebook; "
        f"assert Path(open_notebook.__file__).resolve() == Path({str(ROOT / 'open_notebook/__init__.py')!r}); "
    )
    if kind == "api":
        code = check + (
            "import api.main as app; "
            f"assert Path(app.__file__).resolve() == Path({str(ROOT / 'api/main.py')!r}); "
            f"import uvicorn; uvicorn.run(app.app, host='127.0.0.1', port={port}, log_level='warning')"
        )
    else:
        code = check + (
            "import commands; "
            f"assert Path(commands.__file__).resolve() == Path({str(ROOT / 'commands/__init__.py')!r}); "
            "import surreal_commands.cli.worker as worker; "
            f"assert Path(worker.__file__).resolve() == Path({str(WORKER_MODULE)!r}); "
            "sys.argv=['surreal-commands-worker','--import-modules','commands','--max-tasks','2']; worker.main()"
        )
    return [str(PYTHON), "-I", "-B", "-c", code]


def run(root: Path, fixture: str, gateway: Path, source_commit: str) -> dict[str, Any]:
    frozen = preflight(fixture, gateway, source_commit)
    root = gate.absolute(root)
    if gate.overlap(root, gate.absolute(gateway)):
        raise ValueError("Run overlaps gateway")
    upload, tokenizer = public_bytes()
    ports = select_ports()
    life.require_free_ports(ports)
    owned_root = create_root(root)
    receipt: dict[str, Any] = {
        "version": "spa-native-runtime-receipt-v1",
        "status": "incomplete",
        "root": owned_root,
        "root_retained": True,
        **frozen,
        "api_commit": source_commit,
        "worker_commit": source_commit,
        "startup": [],
        "readiness": [],
        "transaction": {},
        "cleanup": "not_run",
        "request_counts": {},
        "requests": [],
        "evidence": [],
        "limits": {
            "request_seconds": 10,
            "readiness_seconds": 90,
            "readiness_io_seconds": 1,
            "readiness_response_bytes": 65536,
            "job_seconds": 90,
            "transaction_seconds": 300,
            "max_requests": 800,
            "response_bytes": 16777216,
        },
        "claim": "Native synthetic partial only; gateway identity is not served evidence",
    }
    processes: list[life.OwnedProcess] = []
    listeners: list[tuple[life.OwnedProcess, int]] = []
    readiness_attempted = readiness_completed = 0
    threads: list[threading.Thread] = []
    log_errors: list[bool] = []
    logs: list[Path] = []
    transaction = None
    handlers = {}
    interrupt_state = {"acquiring": False, "pending": False}
    envs = environments(root, ports)

    def custody():
        require(gate.identity(root, True) == owned_root)

    def interrupted(*_):
        interrupt_state["pending"] = True
        if not interrupt_state["acquiring"]:
            raise KeyboardInterrupt

    def start(name, args, port=None):
        custody()
        if port is not None:
            require_free(port)
        # Defer Python interruption, not OS signal delivery/masks. A child must
        # never inherit blocked termination signals, and every returned handle
        # must enter the cleanup registry before a pending interrupt can unwind.
        interrupt_state["acquiring"] = True
        try:
            proc = life.start_owned(
                args,
                cwd=ROOT,
                env=envs[name],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            processes.append(proc)
            receipt["startup"].append(name)
        finally:
            interrupt_state["acquiring"] = False
            if interrupt_state["pending"]:
                raise KeyboardInterrupt
        if port is not None:
            listeners.append((proc, port))
        target = root / (name + ".log")
        logs.append(target)
        secret_values = tuple(
            envs["api"][key]
            for key in (
                "SURREAL_PASSWORD",
                "OPEN_NOTEBOOK_PASSWORD",
                "OPEN_NOTEBOOK_ENCRYPTION_KEY",
            )
        )

        def pump():
            try:
                copy_log(proc.process.stdout, target, secret_values)
            except BaseException:
                log_errors.append(True)
            finally:
                proc.process.stdout.close()

        thread = threading.Thread(target=pump, daemon=True)
        threads.append(thread)
        thread.start()
        return proc

    def wait(name, proc, port, path):
        deadline = time.monotonic() + 90

        def guard():
            custody()
            for child in processes:
                require(child.poll() is None)
            return all(
                life.owned_listener_ready(child, listen_port)
                for child, listen_port in listeners
            )

        def remaining():
            budget = deadline - time.monotonic()
            if budget <= 0:
                raise TimeoutError("Readiness deadline exceeded")
            return budget

        async def read_probe():
            # The outer cancellation deadline also covers connect and headers,
            # where a stream has not yielded yet. Inactivity timeouts alone do
            # not bound a peer that keeps sending header fragments.
            budget = remaining()
            async with asyncio.timeout(budget):
                async with httpx.AsyncClient(
                    trust_env=False,
                    timeout=min(1, budget),
                    follow_redirects=False,
                ) as client:
                    async with client.stream(
                        "GET", f"http://127.0.0.1:{port}{path}"
                    ) as response:
                        remaining()
                        require(guard())
                        count = 0
                        # Do not request a minimum chunk size: buffering to that
                        # size could hide a continuing trickle from our checks.
                        async for chunk in response.aiter_raw():
                            remaining()
                            count += len(chunk)
                            require(count <= 65536)
                            require(guard())
                        remaining()
                        require(guard())
                        return response.status_code == 200

        def probe():
            nonlocal readiness_attempted, readiness_completed
            remaining()
            readiness_attempted += 1
            try:
                ready = asyncio.run(read_probe())
            except httpx.HTTPError:
                return False
            readiness_completed += 1
            return ready

        life.wait_for_service(name, proc, probe, timeout=remaining(), guard=guard)
        receipt["readiness"].append(name + path)

    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            handlers[sig] = signal.signal(sig, interrupted)
        gate.write_private(root, "started.json", receipt, owned_root)
        for name in (
            "home",
            "home/config",
            "cache",
            "cache/tiktoken",
            "tmp",
            "upstream-data",
            "personal",
        ):
            (root / name).mkdir(mode=0o700)
        fd = os.open(
            root / "cache/tiktoken" / TOKEN_FILE,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        with os.fdopen(fd, "wb") as handle:
            handle.write(tokenizer)
        db = start(
            "db",
            [
                str(SURREAL),
                "start",
                "--bind",
                f"127.0.0.1:{ports[0]}",
                "--log",
                "warn",
                "rocksdb:" + str(root / "db"),
            ],
            ports[0],
        )
        wait("db", db, ports[0], "/health")
        life.require_owned_listener(db, ports[0])
        api = start("api", bootstrap("api", ports[1]), ports[1])
        wait("api", api, ports[1], "/health")
        life.require_owned_listener(db, ports[0])
        life.require_owned_listener(api, ports[1])
        worker = start("worker", bootstrap("worker", ports[1]))
        require(worker.poll() is None)
        bff = start(
            "bff",
            [str(NODE), str(Path(frozen["inputs"]["bff"]["root"]) / "cli.js")],
            ports[2],
        )

        def stack_guard():
            custody()
            for proc, port in ((db, ports[0]), (api, ports[1]), (bff, ports[2])):
                life.require_owned_listener(proc, port)
            require(worker.poll() is None)

        wait("bff", bff, ports[2], "/config")
        wait("bff", bff, ports[2], "/api/auth/status")
        with httpx.Client(
            base_url=f"http://127.0.0.1:{ports[2]}",
            trust_env=False,
            follow_redirects=False,
            timeout=10,
        ) as client:
            transaction = Transaction(
                client, stack_guard, envs["api"]["OPEN_NOTEBOOK_PASSWORD"]
            )
            receipt["transaction"] = transaction.execute(upload)
        receipt["status"] = "partial_pass"
    except BaseException as error:
        receipt.update(
            status="failed",
            failure="interrupted"
            if isinstance(error, KeyboardInterrupt)
            else type(error).__name__,
        )
        # Never record error strings, response bodies, credentials, argv or environment.
    finally:
        for sig in handlers:
            signal.signal(sig, signal.SIG_IGN)
        uncertain = False
        try:
            life.stop_processes(processes)
        except BaseException:
            uncertain = True
        drained = True
        for thread in threads:
            try:
                thread.join(timeout=5)
                drained &= not thread.is_alive()
            except BaseException:
                drained = False
        uncertain |= not drained or bool(log_errors)
        for check in (
            lambda: life.require_free_ports(ports),
            custody,
            lambda: require(preflight(fixture, gateway, source_commit) == frozen),
        ):
            try:
                check()
            except BaseException:
                uncertain = True
        if transaction is not None:
            receipt["request_counts"] = transaction.counts
            receipt["requests"] = transaction.events
            if not receipt["transaction"]:
                receipt["transaction"] = transaction.result
        receipt["readiness_requests"] = {
            "attempted": readiness_attempted,
            "completed": readiness_completed,
        }
        receipt["cleanup"] = "uncertain" if uncertain else "succeeded"
        if uncertain:
            receipt["status"] = "cleanup_uncertain"
        try:
            custody()
            for log in logs:
                if not drained or log_errors:
                    receipt["evidence"].append(
                        {"path": log.name, "status": "not_final"}
                    )
                    continue
                raw = gate.read_file(log, True)
                receipt["evidence"].append({"path": log.name, "sha256": gate.sha(raw)})
            gate.write_private(root, "receipt.json", receipt, owned_root)
        except BaseException:
            receipt.update(
                status="cleanup_uncertain", cleanup="uncertain", receipt_write="failed"
            )
        finally:
            for sig, previous in handlers.items():
                signal.signal(sig, previous)
    return receipt


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run_parser = sub.add_parser(
        "run", help="Requires separate reviewed runtime authorization"
    )
    run_parser.add_argument("--run-root", type=Path, required=True)
    run_parser.add_argument("--fixture", required=True)
    run_parser.add_argument("--gateway", type=Path, required=True)
    run_parser.add_argument("--source-commit", required=True)
    args = parser.parse_args(argv)
    try:
        result = run(args.run_root, args.fixture, args.gateway, args.source_commit)
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
        print("Native preflight refused; no runtime claim", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": result["status"],
                "root_retained": True,
                "receipt": str(args.run_root / "receipt.json"),
            }
        )
    )
    return 0 if result["status"] == "partial_pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
