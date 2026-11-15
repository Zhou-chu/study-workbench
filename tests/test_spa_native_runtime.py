"""Offline runner behavior only, never C2 live observations."""

import asyncio
import importlib
import json
import os
import signal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from spa_native_runtime_support import Clock, helper


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


def test_import_is_inert(monkeypatch):
    m = helper()

    def forbidden(*args, **kwargs):
        pytest.fail("Import must not start, connect, inspect environment or signal")

    monkeypatch.setattr(m.subprocess, "run", forbidden)
    monkeypatch.setattr(m.socket, "socket", forbidden)
    monkeypatch.setattr(os, "getenv", forbidden)
    monkeypatch.setattr(os, "killpg", forbidden)
    importlib.reload(m)


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


@pytest.mark.parametrize("child", ["db", "api", "worker", "bff"])
@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM])
def test_interrupt_at_acquire_registration_boundary_cleans_every_child(
    fake_run, monkeypatch, child, sig
):
    import sys

    m, root, processes, events = fake_run
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
    injected: list[str] = []
    prior_trace = sys.gettrace()

    def forbidden_mask(*args, **kwargs):
        pytest.fail("Child must not inherit blocked termination signals")

    monkeypatch.setattr(signal, "pthread_sigmask", forbidden_mask)

    def trace(frame, event, arg):
        if (
            event == "line"
            and frame.f_code.co_filename
            == str(m.ROOT / "scripts/v1/spa_native_runtime.py")
            and frame.f_code.co_name == "start"
            and "proc" in frame.f_locals
            and not injected
        ):
            acquired = frame.f_locals["proc"]
            registry = frame.f_locals["processes"]
            if acquired.name == child and not any(p is acquired for p in registry):
                injected.append(child)
                handler = signal.getsignal(sig)
                assert callable(handler)
                handler(sig, None)  # Invoke Python handler, never send an OS signal.
        return trace

    try:
        sys.settrace(trace)
        result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    finally:
        sys.settrace(prior_trace)
    expected = ["db", "api", "worker", "bff"][
        : ["db", "api", "worker", "bff"].index(child) + 1
    ]
    assert injected == [child]
    assert [p.name for p in processes] == expected
    assert all(p.closed for p in processes)
    assert [e[1] for e in events if e[0] == "stop"] == expected[::-1]
    assert result["status"] == "failed"
    assert result["failure"] == "interrupted"
    assert result["cleanup"] == "succeeded"
    assert result["startup"] == expected
    assert result["transaction"] == {}
    assert {s: signal.getsignal(s) for s in previous} == previous


class ReadinessResponse:
    """Finite continuing-response fake: no socket, process or real waiting."""

    def __init__(
        self,
        clock,
        payload=b"x",
        chunks=1,
        step=0,
        headers=0,
        status=200,
        continuing_headers=False,
    ):
        self.continuing_headers = continuing_headers
        self.clock = clock
        self.payload = payload
        self.chunks = chunks
        self.step = step
        self.headers = headers
        self.status_code = status
        self.read_chunks = 0
        self.closed = False

    def __enter__(self):
        self.clock.sleep(self.headers)
        return self

    def __exit__(self, *args):
        self.closed = True

    async def __aenter__(self):
        if self.continuing_headers:
            # Keep producing header fragments without ever yielding a response.
            for _ in range(1000):
                self.clock.sleep(1)
                await asyncio.sleep(0)
        return self.__enter__()

    async def __aexit__(self, *args):
        self.__exit__(*args)

    async def aiter_raw(self):
        for chunk in self.iter_raw():
            await asyncio.sleep(0)
            yield chunk

    def iter_raw(self, **kwargs):
        for _ in range(self.chunks):
            self.clock.sleep(self.step)
            self.read_chunks += 1
            yield self.payload


def install_readiness_wire(m, monkeypatch, clock, **response_options):
    responses = []
    requests = []

    def response(mode, kwargs):
        requests.append({"mode": mode, **kwargs})
        item = ReadinessResponse(clock, **response_options)
        responses.append(item)
        return item

    def buffered(*args, **kwargs):
        item = response("buffered", kwargs)
        with item:
            for _ in item.iter_raw():
                pass
        return item

    def streamed(*args, **kwargs):
        return response("streamed", kwargs)

    class AsyncWire:
        def __init__(self, **kwargs):
            self.options = kwargs
            self.item = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            if self.item is not None:
                self.item.closed = True

        def stream(self, *args, **kwargs):
            self.item = response("streamed", self.options | kwargs)
            return self.item

    def once(name, proc, probe, **kwargs):
        if not kwargs["guard"]() or not probe() or not kwargs["guard"]():
            raise RuntimeError("Readiness did not succeed")

    monkeypatch.setattr(m.time, "monotonic", clock)
    monkeypatch.setattr(m.httpx, "get", buffered)
    monkeypatch.setattr(m.httpx, "stream", streamed)
    monkeypatch.setattr(m.httpx, "AsyncClient", AsyncWire)
    monkeypatch.setattr(m.life, "wait_for_service", once)
    return responses, requests


@pytest.mark.parametrize(
    "payload,chunks,step,headers,maximum_reads",
    [
        (b"x", 1000, 1, 0, 90),
        (b"x" * 4096, 1000, 0, 0, 17),
        (b"x", 1000, 0, 91, 0),
    ],
)
def test_readiness_stream_budget_unwinds_to_owned_cleanup(
    fake_run, monkeypatch, payload, chunks, step, headers, maximum_reads
):
    m, root, processes, events = fake_run
    clock = Clock()
    responses, requests = install_readiness_wire(
        m,
        monkeypatch,
        clock,
        payload=payload,
        chunks=chunks,
        step=step,
        headers=headers,
    )
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert result["cleanup"] == "succeeded"
    assert [p.name for p in processes] == ["db"]
    assert all(p.closed for p in processes)
    assert len(responses) == 1
    assert responses[0].closed
    assert responses[0].read_chunks <= maximum_reads
    assert requests[0]["mode"] == "streamed"
    assert result["readiness_requests"] == {"attempted": 1, "completed": 0}


def test_readiness_stream_exact_body_limit_is_accepted(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    responses, requests = install_readiness_wire(
        m, monkeypatch, Clock(), payload=b"x" * 4096, chunks=16
    )
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "partial_pass"
    assert all(r.read_chunks == 16 and r.closed for r in responses)
    assert result["readiness_requests"] == {"attempted": 4, "completed": 4}


def test_readiness_stream_deadline_rejects_late_admission(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    clock = Clock()
    responses, requests = install_readiness_wire(m, monkeypatch, clock)

    def late(name, proc, probe, **kwargs):
        clock.sleep(90)
        probe()

    monkeypatch.setattr(m.life, "wait_for_service", late)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert responses == requests == []
    assert result["readiness_requests"] == {"attempted": 0, "completed": 0}
    assert all(p.closed for p in processes)


def test_readiness_stream_retry_uses_remaining_deadline(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    clock = Clock()
    responses, requests = install_readiness_wire(m, monkeypatch, clock)

    def retry(name, proc, probe, **kwargs):
        if name == "db":
            if not kwargs["guard"]():
                raise RuntimeError("Guard refused")
            # The first completed response is ready, but a repeated guarded
            # observation must still share the original endpoint deadline.
            probe()
            clock.sleep(89.75)
        if not probe():
            raise RuntimeError("Not ready")

    monkeypatch.setattr(m.life, "wait_for_service", retry)
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "partial_pass"
    assert [r["timeout"] for r in requests[:2]] == [1, 0.25]
    assert all(
        r["trust_env"] is False and r["follow_redirects"] is False for r in requests
    )
    assert all(r.closed for r in responses)


def test_readiness_stream_rechecks_ownership_while_consuming(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    responses, requests = install_readiness_wire(m, monkeypatch, Clock(), chunks=100)
    monkeypatch.setattr(
        m.life,
        "owned_listener_ready",
        lambda proc, port: not responses or responses[0].read_chunks < 2,
    )
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert result["cleanup"] == "succeeded"
    assert responses[0].read_chunks == 2
    assert result["readiness_requests"]["completed"] == 0
    assert all(p.closed for p in processes)


def test_readiness_stream_cancels_continuing_headers(fake_run, monkeypatch):
    m, root, processes, events = fake_run
    clock = Clock()
    responses, requests = install_readiness_wire(
        m, monkeypatch, clock, continuing_headers=True
    )
    result = m.run(root, "fixture", Path("/gateway"), "a" * 40)
    assert result["status"] == "failed"
    assert result["cleanup"] == "succeeded"
    assert requests[0]["mode"] == "streamed"
    assert responses[0].closed and responses[0].read_chunks == 0
    assert clock.now <= 93
    assert result["readiness_requests"] == {"attempted": 1, "completed": 0}
    assert all(p.closed for p in processes)
