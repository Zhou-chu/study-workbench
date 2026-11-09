"""Offline runner behavior only, never C2 live observations."""

import importlib
import json
import os
import signal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest


def helper():
    try:
        return importlib.import_module("scripts.v1.spa_native_runtime")
    except ModuleNotFoundError:
        pytest.fail("Foreground native runner is not implemented")


def test_environment_is_minimal_and_secrets_are_separated(monkeypatch, tmp_path):
    m = helper()
    monkeypatch.setenv("OPENAI_API_KEY", "ambient-secret")
    monkeypatch.setenv("HTTPS_PROXY", "https://foreign.invalid")
    envs = m.environments(tmp_path, (31001, 31002, 31003))
    db, api, worker, bff = (envs[x] for x in ("db", "api", "worker", "bff"))
    assert api == worker
    assert (
        len(
            {
                api["SURREAL_PASSWORD"],
                api["OPEN_NOTEBOOK_PASSWORD"],
                api["OPEN_NOTEBOOK_ENCRYPTION_KEY"],
            }
        )
        == 3
    )
    assert db["SURREAL_PASS"] == api["SURREAL_PASSWORD"]
    assert "OPEN_NOTEBOOK_PASSWORD" not in db
    assert bff["INTERNAL_API_URL"] == "http://127.0.0.1:31002"
    assert bff["STUDY_WORKBENCH_WEB_ORIGIN"] == "http://127.0.0.1:31003"
    assert bff["NODE_ENV"] != "production"
    assert bff["STUDY_WORKBENCH_BFF_LISTEN_HOST"] == "127.0.0.1"
    for env in envs.values():
        assert "OPENAI_API_KEY" not in env
        assert "HTTPS_PROXY" not in env
        assert env["HOME"] == str(tmp_path / "home")
    assert not any(
        "PASSWORD" in k or "ENCRYPTION" in k or k.startswith("SURREAL") for k in bff
    )
    for key in (
        "STUDY_WORKBENCH_RUNTIME_DIR",
        "STUDY_WORKBENCH_DATA_DIR",
        "OPEN_NOTEBOOK_DATA_DIR",
        "TIKTOKEN_CACHE_DIR",
        "NOTEBOOKLM_HOME",
    ):
        assert Path(api[key]).is_relative_to(tmp_path)
    assert api["PYTHON_DOTENV_DISABLED"] == "1"
    assert api["SURREAL_UNAUTHENTICATED"] == "false"


@pytest.mark.parametrize(
    "ports",
    [
        (18001, 31002, 31003),
        (31001, 5056, 31003),
        (31001, 31002, 13001),
        (8000, 31002, 31003),
        (31001, 31001, 31003),
    ],
)
def test_port_selection_rejects_live_defaults_and_duplicates(monkeypatch, ports):
    m = helper()
    monkeypatch.setattr(m.life, "select_unused_ports", lambda: ports)
    with pytest.raises(ValueError):
        m.select_ports()


def test_new_root_private_exclusive_and_never_deleted(tmp_path, monkeypatch):
    m = helper()
    monkeypatch.setattr(m, "RUN_PARENT", tmp_path)
    root = tmp_path / "fresh"
    identity = m.create_root(root)
    assert identity["mode"] == 0o700
    assert identity["inode"] == root.stat().st_ino
    with pytest.raises((ValueError, FileExistsError)):
        m.create_root(root)
    assert root.exists()


@pytest.mark.parametrize("kind", ["symlink", "nested", "parent"])
def test_root_rejects_aliases_and_non_direct_children(tmp_path, monkeypatch, kind):
    m = helper()
    monkeypatch.setattr(m, "RUN_PARENT", tmp_path)
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(foreign, target_is_directory=True)
    root = {"symlink": alias, "nested": foreign / "child", "parent": tmp_path}[kind]
    with pytest.raises((ValueError, FileExistsError)):
        m.create_root(root)
    assert list(foreign.iterdir()) == []


def test_preflight_failure_never_creates_root_or_spawns(tmp_path, monkeypatch):
    m = helper()

    def refuse(*a, **k):
        raise ValueError("untrusted input")

    monkeypatch.setattr(m, "preflight", refuse)
    monkeypatch.setattr(m.life, "start_owned", lambda *a, **k: pytest.fail("spawn"))
    with pytest.raises(ValueError):
        m.run(tmp_path / "no-root", "fixture", Path("/explicit/gateway"), "a" * 40)
    assert not (tmp_path / "no-root").exists()


def test_unknown_process_never_signalled(monkeypatch):
    m = helper()
    monkeypatch.setattr(os, "killpg", lambda *a: pytest.fail("unknown PID signalled"))
    with pytest.raises(TypeError):
        m.life.stop_processes([SimpleNamespace(pid=123456)])


@pytest.mark.parametrize(
    "failure",
    [
        "dirty",
        "wrong-commit",
        "stale-web",
        "stale-bff",
        "stale-gateway",
        "missing-fixture",
        "origin",
    ],
)
def test_input_rejection_precedes_root_and_spawn(tmp_path, monkeypatch, failure):
    m = helper()
    monkeypatch.setattr(m, "verify_tools", lambda: {"safe": True})
    monkeypatch.setattr(m, "verify_native_source", lambda expected: None)

    def refuse(**kwargs):
        raise ValueError(failure)

    monkeypatch.setattr(m.gate, "verify_inputs", refuse)
    monkeypatch.setattr(m.life, "start_owned", lambda *a, **k: pytest.fail("spawn"))
    with pytest.raises(ValueError):
        m.run(tmp_path / "never", "fixture", Path("/gateway"), "a" * 40)
    assert not (tmp_path / "never").exists()


def test_executable_hash_mismatch_precedes_execution(tmp_path, monkeypatch):
    m = helper()
    binary = tmp_path / "binary"
    binary.write_bytes(b"untrusted")
    binary.chmod(0o700)
    monkeypatch.setattr(m.subprocess, "run", lambda *a, **k: pytest.fail("executed"))
    with pytest.raises(ValueError):
        m.file_record(binary, "0" * 64)


@pytest.mark.parametrize("kind", ["hardlink", "symlink", "directory"])
def test_executable_custody_rejects_aliases(tmp_path, kind):
    m = helper()
    original = tmp_path / "original"
    original.write_bytes(b"x")
    target = tmp_path / "binary"
    if kind == "hardlink":
        os.link(original, target)
    elif kind == "symlink":
        target.symlink_to(original)
    else:
        target.mkdir()
    with pytest.raises((ValueError, OSError)):
        m.file_record(target, m.gate.sha(b"x"))


def test_wrong_loaded_origin_or_dependency_version_blocks():
    m = helper()
    correct = {
        "origins": {
            "api.main": str(m.ROOT / "api/main.py"),
            "commands": str(m.ROOT / "commands/__init__.py"),
            "open_notebook": str(m.ROOT / "open_notebook/__init__.py"),
        },
        "versions": dict(m.DEPENDENCIES),
    }
    m.validate_modules(correct)
    correct["origins"]["commands"] = "/deployment/commands/__init__.py"
    with pytest.raises(ValueError):
        m.validate_modules(correct)
    correct["origins"]["commands"] = str(m.ROOT / "commands/__init__.py")
    correct["versions"]["surreal-commands"] = "unknown"
    with pytest.raises(ValueError):
        m.validate_modules(correct)


class FixtureService:
    """Stateful fake wire boundary; runner code owns the real transaction."""

    def __init__(self, mode="ok"):
        self.mode = mode
        self.requests = []
        self.uploads = []
        self.note = None
        self.selection = None
        self.exported = False
        self.imported = False

    def workspace(self, imported=False):
        version = "version_imported" if imported else "version_original"
        return {
            "notebook": {
                "id": "notebook_imported" if imported else "notebook_original"
            },
            "selection": {**(self.selection or {}), "source_version_ids": [version]},
            "sources": [
                {
                    "source_id": "source_original",
                    "versions": [{"source_version_id": version}],
                }
            ],
            "notes": [self.note] if self.note else [],
            "jobs": [
                {
                    "job_id": "job_upload",
                    "state": "running"
                    if self.mode == "upload-timeout"
                    else "succeeded",
                },
                *(
                    [
                        {
                            "job_id": "job_export",
                            "state": "running"
                            if self.mode == "export-timeout"
                            else "succeeded",
                            "result": {"export_id": "export_original"},
                        }
                    ]
                    if self.exported
                    else []
                ),
            ],
        }

    def __call__(self, request):
        self.requests.append(request)
        p = request.url.path
        if p == "/config":
            return httpx.Response(
                200,
                json={
                    "apiUrl": "http://127.0.0.1:31003",
                    "auth_mode": "legacy_password",
                },
            )
        if p == "/api/auth/status":
            return httpx.Response(200, json={"auth_enabled": True})
        if "synthetic-denied" in p:
            assert "authorization" not in request.headers
            return httpx.Response(401)
        if p == "/api/notebooks":
            return httpx.Response(200, json={"id": "notebook_original"})
        if p.endswith("/sources/upload"):
            self.uploads.append(request.content)
            if self.mode == "upload-unknown":
                raise httpx.ReadTimeout("secret response URL", request=request)
            return httpx.Response(
                200,
                json={
                    "source_id": "source_original",
                    "source_version_id": "version_original",
                    "job_id": "job_changed"
                    if self.mode == "replay-mismatch" and len(self.uploads) == 2
                    else "job_upload",
                },
            )
        if p.endswith("/workspace") or p.endswith("/workspace-view"):
            body = self.workspace("notebook_imported" in p)
            if self.mode == "bad-selection":
                body["selection"]["source_version_ids"] = []
            return httpx.Response(200, json=body)
        if p.endswith("/selection"):
            self.selection = json.loads(request.content)
            return httpx.Response(200, json=self.selection)
        if p == "/api/personal/search":
            return httpx.Response(200, json={"hits": [{"quote": "public quote"}]})
        if p.endswith("/notes"):
            self.note = {"id": "note_original", **json.loads(request.content)}
            return httpx.Response(200, json=self.note)
        if p.endswith("/exports"):
            self.exported = True
            if self.mode == "export-unknown":
                raise httpx.ReadTimeout("do not leak bearer", request=request)
            return httpx.Response(202, json={"job_id": "job_export"})
        if p == "/api/personal/imports/portable":
            self.imported = True
            return httpx.Response(
                201,
                json={
                    "notebook_id": "notebook_original"
                    if self.mode == "bad-remap"
                    else "notebook_imported"
                },
            )
        if p == "/api/personal/exports/export_original/download":
            return httpx.Response(200, content=b"synthetic zip")
        if p.endswith("/download"):
            return httpx.Response(
                200,
                content=b"corrupt"
                if self.mode == "bad-original"
                else b"public fixture",
            )
        if "/source-versions/" in p:
            return httpx.Response(
                200,
                json={
                    "extraction": {"status": "ready"},
                    "evidence": [{"quote": "public quote"}],
                },
            )
        pytest.fail(f"Unexpected wire request: {p}")


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def transact(mode="ok", guard=lambda: None):
    m = helper()
    service = FixtureService(mode)
    clock = Clock()
    client = httpx.Client(
        base_url="http://127.0.0.1:31003",
        trust_env=False,
        transport=httpx.MockTransport(service),
    )
    txn = m.Transaction(
        client, guard, "memory-only-bearer", clock=clock, sleep=clock.sleep
    )
    return txn, service, client


def test_transaction_requires_all_native_steps_and_portable_roundtrip():
    txn, service, client = transact()
    with client:
        result = txn.execute(b"public fixture")
    assert result["portable"]["original_sha256"] == helper().gate.sha(b"public fixture")
    assert result["portable"]["notebook_id"] == "notebook_imported"
    assert result["citation_validation"] == "not_run"
    assert result["upload"]["job_id"] == "job_upload"
    assert len(service.uploads) == 2
    # Multipart boundaries differ. The original key and file bytes must not.
    assert service.uploads[0].split(b'name="idempotency_key"')[1].split(b"\r\n--")[0]
    assert all(b"public fixture" in body for body in service.uploads)
    keys = [
        body.split(b'name="idempotency_key"\r\n\r\n')[1].split(b"\r\n")[0]
        for body in service.uploads
    ]
    assert keys[0] == keys[1]
    search = next(r for r in service.requests if r.url.path.endswith("/search"))
    assert json.loads(search.content) == {
        "query": "public quote",
        "source_version_ids": ["version_original"],
    }
    assert all(
        "origin" not in r.headers and "sec-fetch-site" not in r.headers
        for r in service.requests
    )
    assert txn.counts["attempted"] == txn.counts["completed"] == len(service.requests)
    assert txn.counts["mutations"] == 7
    assert sum(r.url.path.endswith("/imports/portable") for r in service.requests) == 1


@pytest.mark.parametrize(
    "mode",
    [
        "upload-unknown",
        "export-unknown",
        "replay-mismatch",
        "bad-original",
        "bad-selection",
        "bad-remap",
        "upload-timeout",
        "export-timeout",
    ],
)
def test_incomplete_or_uncertain_transaction_never_passes_or_replays(mode):
    txn, service, client = transact(mode)
    with client, pytest.raises((RuntimeError, TimeoutError)):
        txn.execute(b"public fixture")
    assert len(service.uploads) <= 2
    assert sum(r.url.path.endswith("/exports") for r in service.requests) <= 1
    assert sum(r.url.path.endswith("/imports/portable") for r in service.requests) <= 1
    if mode == "upload-unknown":
        assert len(service.uploads) == 1
    assert txn.counts["attempted"] <= 800
    last = {
        "upload-unknown": "upload",
        "export-unknown": "export",
        "replay-mismatch": "upload_same_key",
        "bad-original": "original",
        "bad-selection": "workspace",
        "bad-remap": "portable_import",
        "upload-timeout": "extract_poll",
        "export-timeout": "export_poll",
    }[mode]
    assert txn.events[-1]["step"] == last


def test_request_guard_prevents_any_http_and_counter_increment():
    def refuse():
        raise RuntimeError("foreign listener")

    txn, service, client = transact(guard=refuse)
    with client, pytest.raises(RuntimeError):
        txn.execute(b"public fixture")
    assert not service.requests
    assert txn.counts["attempted"] == 0


def test_request_limit_and_deadline_prevent_dispatch():
    txn, service, client = transact()
    txn.counts["attempted"] = 800
    with client, pytest.raises((RuntimeError, TimeoutError)):
        txn.execute(b"public fixture")
    assert not service.requests


def test_private_logs_redact_and_bound_lines(tmp_path):
    import io

    m = helper()
    target = tmp_path / "api.log"
    source = io.BytesIO(
        b"prefix private-key suffix\n" + b"x" * 70000 + b"private-key\nend\n"
    )
    m.copy_log(source, target, ("private-key",))
    raw = target.read_bytes()
    assert b"private-key" not in raw
    assert b"prefix [REDACTED] suffix" in raw
    assert b"end" in raw
    assert len(raw) < 1024
    assert target.stat().st_mode & 0o777 == 0o600


@pytest.fixture
def fake_run(tmp_path, monkeypatch):
    import io

    m = helper()
    monkeypatch.setattr(m, "RUN_PARENT", tmp_path)
    inputs = {
        "source": {"commit": "a" * 40},
        "bff": {"root": "/fake/bff"},
        "fixture": {},
        "web": {},
        "gateway": {},
        "contract": {},
    }
    monkeypatch.setattr(m, "preflight", lambda *a: {"inputs": inputs, "tools": {}})
    monkeypatch.setattr(m, "public_bytes", lambda: (b"public fixture", b"tokenizer"))
    monkeypatch.setattr(m, "select_ports", lambda: (31001, 31002, 31003))
    events: list[Any] = []
    monkeypatch.setattr(m, "require_free", lambda port: events.append(("free", port)))
    monkeypatch.setattr(
        m.life, "require_free_ports", lambda ports: events.append(("released", ports))
    )
    monkeypatch.setattr(
        m.life,
        "require_owned_listener",
        lambda proc, port: events.append(("owned", proc.name)),
    )
    monkeypatch.setattr(m.life, "owned_listener_ready", lambda proc, port: True)
    processes: list[Any] = []

    def start(args, **kwargs):
        name = ("db", "api", "worker", "bff")[len(processes)]
        p = SimpleNamespace(
            name=name,
            pid=100 + len(processes),
            identity=(1, 1, 1),
            closed=False,
            poll=lambda: None,
            process=SimpleNamespace(stdout=io.BytesIO(b"safe\n")),
        )
        processes.append(p)
        events.append(("start", name, args, kwargs))
        return p

    monkeypatch.setattr(m.life, "start_owned", start)

    def stop(procs, **kwargs):
        for p in reversed(procs):
            events.append(("stop", p.name))
            p.closed = True

    monkeypatch.setattr(m.life, "stop_processes", stop)
    monkeypatch.setattr(
        m.life,
        "wait_for_service",
        lambda name, proc, probe, **kwargs: events.append(("ready", name)),
    )
    monkeypatch.setattr(
        m.Transaction, "execute", lambda self, content: {"native": "checked"}
    )
    return m, tmp_path / "native", processes, events


def test_foreground_launch_registry_cleanup_and_private_receipt(fake_run):
    m, root, processes, events = fake_run
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "partial_pass"
    assert [e[1] for e in events if e[0] == "start"] == ["db", "api", "worker", "bff"]
    assert [e[1] for e in events if e[0] == "stop"] == ["bff", "worker", "api", "db"]
    assert all(p.closed for p in processes)
    assert root.exists()
    receipt = json.loads((root / "receipt.json").read_text())
    assert receipt["version"] == "spa-native-runtime-receipt-v1"
    assert receipt["cleanup"] == "succeeded"
    assert receipt["root_retained"] is True
    assert receipt["transaction"] == {"native": "checked"}
    assert (root / "receipt.json").stat().st_mode & 0o777 == 0o600
    for e in events:
        if e[0] == "start":
            assert e[3]["stdin"] == m.subprocess.DEVNULL
            assert e[3]["cwd"] == m.ROOT


@pytest.mark.parametrize(
    "failure", ["api", "worker", "bff", "transaction", "sigint", "sigterm"]
)
def test_partial_launch_and_interrupt_always_cleanup(fake_run, monkeypatch, failure):
    m, root, processes, events = fake_run
    start = m.life.start_owned

    def failing_start(args, **kwargs):
        if ("db", "api", "worker", "bff")[len(processes)] == failure:
            raise RuntimeError("failure with secret body")
        return start(args, **kwargs)

    monkeypatch.setattr(m.life, "start_owned", failing_start)

    def fail_txn(*args):
        if failure.startswith("sig"):
            handler = signal.getsignal(
                signal.SIGINT if failure == "sigint" else signal.SIGTERM
            )
            assert callable(handler)
            handler(0, None)
        raise RuntimeError("failure with secret body")

    if failure in ("transaction", "sigint", "sigterm"):
        monkeypatch.setattr(m.Transaction, "execute", fail_txn)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert all(p.closed for p in processes)
    assert [e[1] for e in events if e[0] == "stop"] == [
        p.name for p in reversed(processes)
    ]
    assert "secret body" not in (root / "receipt.json").read_text()
    assert root.exists()


def test_uncertain_cleanup_is_visible_and_retained(fake_run, monkeypatch):
    m, root, processes, events = fake_run

    def unknown(*args, **kwargs):
        raise RuntimeError("identity changed")

    monkeypatch.setattr(m.life, "stop_processes", unknown)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "cleanup_uncertain"
    assert json.loads((root / "receipt.json").read_text())["cleanup"] == "uncertain"
    assert root.exists()


def test_source_drift_at_cleanup_cannot_report_pass(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    original = m.preflight
    calls = 0

    def changing(*args):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise ValueError("source drift")
        return original(*args)

    monkeypatch.setattr(m, "preflight", changing)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "cleanup_uncertain"
    assert all(p.closed for p in processes)


def test_prepared_hardlink_exception_is_exact_and_explicit(tmp_path):
    m = helper()
    original = tmp_path / "original"
    original.write_bytes(b"prepared")
    target = tmp_path / "alias"
    os.link(original, target)
    row = m.file_record(target, m.gate.sha(b"prepared"), links=2)
    assert row["links"] == 2
    with pytest.raises(ValueError):
        m.file_record(target, m.gate.sha(b"prepared"), links=3)


def test_expected_commit_mismatch_blocks_before_source_gate(monkeypatch):
    m = helper()
    monkeypatch.setattr(m.gate, "git", lambda *args: "b" * 40)
    with pytest.raises(ValueError, match="commit"):
        m.verify_native_source("a" * 40)


def test_readiness_guards_previous_services_before_http(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    observed = []

    def ready(name, proc, probe, **kwargs):
        if name == "api":
            # Current API socket is ready, but DB custody disappeared.
            observed.append(kwargs["guard"]())
            raise RuntimeError("database unavailable")

    def listener(proc, port):
        return proc.name != "db"

    monkeypatch.setattr(m.life, "owned_listener_ready", listener)
    monkeypatch.setattr(m.life, "wait_for_service", ready)
    monkeypatch.setattr(
        m.httpx, "get", lambda *a, **k: pytest.fail("HTTP without ancestors")
    )
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert [p.name for p in processes] == ["db", "api"]
    assert observed == [False]


def test_post_response_ownership_loss_does_not_publish_success():
    calls = 0

    def guard():
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("listener changed")

    txn, service, client = transact(guard=guard)
    with client, pytest.raises(RuntimeError):
        txn.execute(b"public fixture")
    assert len(service.requests) == 1
    assert txn.counts["attempted"] == 1
    assert txn.counts["completed"] == 0


def test_export_timeout_preserves_original_job_identity():
    txn, service, client = transact("export-timeout")
    with client, pytest.raises(TimeoutError):
        txn.execute(b"public fixture")
    assert txn.result["export"]["job_id"] == "job_export"
    assert txn.result["worker_completion"] == "extraction_succeeded"


def test_import_is_inert(monkeypatch):
    m = helper()

    def forbidden(*args, **kwargs):
        pytest.fail("Import must not start, connect, inspect environment or signal")

    monkeypatch.setattr(m.subprocess, "run", forbidden)
    monkeypatch.setattr(m.socket, "socket", forbidden)
    monkeypatch.setattr(os, "getenv", forbidden)
    monkeypatch.setattr(os, "killpg", forbidden)
    importlib.reload(m)


@pytest.mark.parametrize(
    "status, expected", [("partial_pass", 0), ("failed", 1), ("cleanup_uncertain", 1)]
)
def test_cli_exit_tracks_actual_result(monkeypatch, status, expected, tmp_path):
    m = helper()
    monkeypatch.setattr(m, "run", lambda *args: {"status": status})
    assert (
        m.main(
            [
                "run",
                "--run-root",
                str(tmp_path / "root"),
                "--fixture",
                "fixture",
                "--gateway",
                "/explicit/gateway",
                "--source-commit",
                "a" * 40,
            ]
        )
        == expected
    )


def test_spawn_port_race_never_adopts_foreign_service(fake_run, monkeypatch):
    m, root, processes, events = fake_run

    def occupied(port):
        raise RuntimeError("occupied")

    monkeypatch.setattr(m, "require_free", occupied)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert not processes
    assert root.exists()


def test_log_thread_start_failure_still_restores_signals_and_cleans_owned(
    fake_run, monkeypatch
):
    m, root, processes, events = fake_run
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}

    class BrokenThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            raise RuntimeError("cannot start log thread")

        def join(self, **kwargs):
            raise RuntimeError("cannot join thread before it is started")

        def is_alive(self):
            return False

    monkeypatch.setattr(m.threading, "Thread", BrokenThread)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "cleanup_uncertain"
    assert all(p.closed for p in processes)
    assert {sig: signal.getsignal(sig) for sig in previous} == previous
    assert (root / "started.json").exists()
    receipt = json.loads((root / "receipt.json").read_text())
    assert receipt["cleanup"] == "uncertain"
    assert receipt["evidence"] == [{"path": "db.log", "status": "not_final"}]
