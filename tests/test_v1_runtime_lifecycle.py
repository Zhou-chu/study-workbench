"""Owned Linux lifecycle: synthetic procfs/network first, no application imports."""

import importlib
import os
import signal
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest

from scripts.v1 import local_check, run_native


def lifecycle():
    assert importlib.util.find_spec("scripts.v1.runtime_lifecycle"), (
        "shared lifecycle missing"
    )
    return importlib.import_module("scripts.v1.runtime_lifecycle")


def test_readiness_rechecks_child_after_probe():
    proc = Mock(poll=Mock(side_effect=[None, 1]))
    with pytest.raises(RuntimeError, match="exited"):
        run_native.wait_for_service("api", proc, lambda: True)


def test_fixture_environment_is_unique_and_allowlisted(tmp_path):
    poison = {
        "PATH": "/safe",
        "PYTHONPATH": "/poison",
        "HTTPS_PROXY": "poison",
        "SURREAL_UNAUTHENTICATED": "true",
        "UNRELATED": "poison",
    }
    a = local_check.build_fixture_environment(tmp_path / "a", poison)
    b = local_check.build_fixture_environment(tmp_path / "b", poison)
    assert a["OPEN_NOTEBOOK_PASSWORD"] != b["OPEN_NOTEBOOK_PASSWORD"]
    assert a["SURREAL_PASSWORD"] != b["SURREAL_PASSWORD"]
    assert a["SURREAL_DATABASE"] != b["SURREAL_DATABASE"]
    assert a["SURREAL_UNAUTHENTICATED"] == "false"
    assert all(k not in a for k in ("PYTHONPATH", "HTTPS_PROXY", "UNRELATED"))


def test_owned_poll_does_not_reap_child(monkeypatch):
    lib = lifecycle()
    proc = Mock(pid=111)
    monkeypatch.setattr(lib, "process_identity", lambda pid: (111, 111, 200))
    owned = lib.OwnedProcess(proc)
    waitid = Mock(return_value=SimpleNamespace(si_code=os.CLD_EXITED, si_status=3))
    monkeypatch.setattr(lib.os, "waitid", waitid)
    assert owned.poll() == 3
    assert waitid.call_args.args[-1] & os.WNOWAIT
    proc.poll.assert_not_called()
    proc.wait.assert_not_called()


def test_cleanup_rejects_reused_pid_and_unregistered_process(monkeypatch):
    lib = lifecycle()
    monkeypatch.setattr(lib, "process_identity", lambda pid: (111, 111, 200))
    owned = lib.OwnedProcess(Mock(pid=111))
    monkeypatch.setattr(lib, "process_identity", lambda pid: (111, 111, 201))
    kill = Mock()
    monkeypatch.setattr(lib.os, "killpg", kill)
    with pytest.raises(RuntimeError, match="identity"):
        lib.stop_processes([owned], grace=0)
    with pytest.raises(TypeError):
        lib.stop_processes([Mock(pid=222)], grace=0)
    kill.assert_not_called()


def test_cleanup_signals_before_reaping_even_for_dead_leader(monkeypatch):
    lib = lifecycle()
    events: list[str | tuple[int, int]] = []
    monkeypatch.setattr(lib, "process_identity", lambda pid: (111, 111, 200))
    proc = Mock(pid=111, wait=lambda: events.append("reap"))
    owned = lib.OwnedProcess(proc)
    monkeypatch.setattr(lib.os, "killpg", lambda pid, sig: events.append((pid, sig)))
    lib.stop_processes([owned], grace=0)
    assert events == [(111, signal.SIGTERM), (111, signal.SIGKILL), "reap"]
    lib.stop_processes([owned], grace=0)
    assert len(events) == 3


def test_foreign_listener_gets_no_probe_or_write(monkeypatch):
    lib = lifecycle()
    proc = Mock(poll=lambda: None)
    monkeypatch.setattr(lib, "listener_inodes", lambda port: {"foreign"})
    monkeypatch.setattr(lib, "owned_socket_inodes", lambda owner: {"owned"})
    writes = []
    probe = Mock(return_value=True)
    with pytest.raises(RuntimeError, match="owned"):
        lib.wait_for_service(
            "api", proc, probe, guard=lambda: lib.require_owned_listener(proc, 12345)
        )
        writes.append("POST")
    probe.assert_not_called()
    assert writes == []


def test_404_never_ready(monkeypatch):
    lib = lifecycle()
    get = Mock(return_value=Mock(status_code=404))
    monkeypatch.setattr(lib.httpx, "get", get)
    assert not lib.http_ready("http://127.0.0.1:12345/health")
    assert get.call_args.kwargs["trust_env"] is False


def test_occupied_local_check_has_no_mutations(tmp_path, monkeypatch):
    lib = lifecycle()
    monkeypatch.setattr(local_check, "ROOT", tmp_path)
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(
        local_check, "require_free_ports", Mock(side_effect=RuntimeError("occupied"))
    )
    spawn = Mock(side_effect=AssertionError("must not start"))
    monkeypatch.setattr(lib.subprocess, "Popen", spawn)
    with pytest.raises(RuntimeError, match="occupied"):
        local_check.main()
    assert not list(tmp_path.iterdir())
    spawn.assert_not_called()


def test_listener_inode_parsing_rejects_wildcard_and_foreign_session(
    tmp_path, monkeypatch
):
    lib = lifecycle()
    monkeypatch.setattr(
        lib.Path,
        "read_text",
        lambda self: "header\n0: 0100007F:3039 00000000:0000 0A 0 0 0 0 0 999\n"
        if self.name == "tcp"
        else "header\n",
    )
    assert lib.listener_inodes(12345) == {"999"}
    monkeypatch.setattr(
        lib.Path,
        "read_text",
        lambda self: "header\n0: 00000000:3039 00000000:0000 0A 0 0 0 0 0 999\n",
    )
    with pytest.raises(RuntimeError, match="non-loopback"):
        lib.listener_inodes(12345)


def test_fixture_missing_or_symlink_never_creates_or_reads_external_file(tmp_path):
    root = tmp_path / "repo"
    fixture_dir = root / "tests/fixtures/v1"
    fixture_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="public fixture"):
        local_check.fixture_inventory(root)
    assert list(fixture_dir.iterdir()) == []
    (fixture_dir / "fixture_course.md").symlink_to(tmp_path / "unread-private")
    with pytest.raises(ValueError, match="public fixture"):
        local_check.fixture_inventory(root)
    assert not (tmp_path / "unread-private").exists()


def test_browser_phase_fails_closed_before_ports_or_storage(monkeypatch):
    monkeypatch.setattr("sys.argv", ["local_check", "--browser"])
    select = Mock(side_effect=AssertionError("must not select ports"))
    monkeypatch.setattr(local_check, "select_unused_ports", select)
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
    select.assert_not_called()


@pytest.mark.skipif(
    os.environ.get("STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE") != "1",
    reason="Set STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1 for owned disposable OS tests",
)
def test_real_disposable_dummy_listeners_stop_a_leaves_b_and_foreign_zero_requests(
    tmp_path,
):
    """Opt in with STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1; stdlib loopback dummies only."""
    import subprocess
    import sys
    import time

    lib = lifecycle()
    code = """
import http.server, sys
from pathlib import Path
portfile, requests = map(Path, sys.argv[1:])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with requests.open("a") as out: out.write("GET\\n")
        self.send_response(200); self.end_headers(); self.wfile.write(b"dummy")
    def do_POST(self):
        with requests.open("a") as out: out.write("POST\\n")
        self.send_response(200); self.end_headers()
    def log_message(self, *args): pass
server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
portfile.write_text(str(server.server_port))
server.serve_forever()
"""
    processes = []
    try:
        for label in ("a", "b"):
            proc = lib.start_owned(
                [
                    sys.executable,
                    "-c",
                    code,
                    str(tmp_path / label),
                    str(tmp_path / (label + "-requests")),
                ],
                env={"PATH": os.environ.get("PATH", "")},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            processes.append(proc)
        deadline = time.monotonic() + 5
        while not all((tmp_path / name).exists() for name in ("a", "b")):
            assert time.monotonic() < deadline
            assert all(p.poll() is None for p in processes)
            time.sleep(0.01)
        a, b = processes
        pa, pb = (int((tmp_path / label).read_text()) for label in ("a", "b"))
        assert lib.require_owned_listener(a, pa)
        assert lib.require_owned_listener(b, pb)
        with pytest.raises(RuntimeError, match="not owned"):
            lib.wait_for_service(
                "wrong-api",
                a,
                lambda: lib.http_ready(f"http://127.0.0.1:{pb}/health"),
                guard=lambda: lib.owned_listener_ready(a, pb),
            )
            lib.httpx.post(f"http://127.0.0.1:{pb}/write", trust_env=False)
        assert not (tmp_path / "b-requests").exists()
        lib.stop_processes([a], grace=0.01)
        assert a.closed
        assert b.poll() is None
        assert lib.require_owned_listener(b, pb)
        assert lib.http_ready(f"http://127.0.0.1:{pb}/health")
        assert (tmp_path / "b-requests").read_text() == "GET\n"
        assert not lib.listener_inodes(pa)
    finally:
        lib.stop_processes(processes, grace=0.01)


@pytest.fixture
def mocked_runner_custody(monkeypatch):
    # These runner tests fake every process; real custody belongs in bounded
    # subprocess tests, not the potentially multithreaded aggregate pytest host.
    custody = MagicMock()
    monkeypatch.setattr(local_check, "BrowserSubreaper", lambda: custody)
    yield custody
    custody.__enter__.assert_called_once_with()
    custody.__exit__.assert_called_once_with(None, None, None)


@pytest.mark.parametrize("foreign_index,expected_starts", [(0, 1), (1, 2)])
def test_local_runner_foreign_db_or_api_stops_before_dependents_and_writes(
    tmp_path, monkeypatch, foreign_index, expected_starts, mocked_runner_custody
):
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(local_check, "require_free_ports", lambda ports: None)
    monkeypatch.setattr(
        local_check, "fixture_inventory", lambda root: {"fixture_course.md": b"public"}
    )
    monkeypatch.setattr(local_check.tempfile, "mkdtemp", lambda **kwargs: str(tmp_path))
    processes = [Mock(poll=lambda: None) for _ in range(3)]
    spawn = Mock(side_effect=processes)
    monkeypatch.setattr(local_check, "start_owned", spawn)
    cleanup = Mock()
    monkeypatch.setattr(local_check, "stop_processes", cleanup)

    def ready(proc, port):
        if proc is processes[foreign_index]:
            raise RuntimeError("foreign listener not owned")
        return True

    monkeypatch.setattr(local_check, "owned_listener_ready", ready)
    monkeypatch.setattr(local_check, "require_owned_listener", ready)
    monkeypatch.setattr(local_check, "http_ready", lambda url: True)
    client = Mock(
        side_effect=AssertionError("no client/writes before verified ownership")
    )
    monkeypatch.setattr(local_check.httpx, "Client", client)
    with pytest.raises(RuntimeError, match="not owned"):
        local_check.main()
    assert spawn.call_count == expected_starts
    client.assert_not_called()
    cleanup.assert_called_once_with(processes[:expected_starts])


def test_unreadable_owner_metadata_fails_closed(monkeypatch):
    lib = lifecycle()
    monkeypatch.setattr(lib, "listener_inodes", lambda port: {"999"})
    monkeypatch.setattr(
        lib,
        "owned_socket_inodes",
        Mock(side_effect=PermissionError("synthetic procfs unavailable")),
    )
    with pytest.raises(PermissionError):
        lib.owned_listener_ready(Mock(), 12345)


def test_registration_failure_cleans_new_unreaped_child(monkeypatch):
    lib = lifecycle()
    process = Mock(pid=111)
    monkeypatch.setattr(lib.subprocess, "Popen", Mock(return_value=process))
    monkeypatch.setattr(
        lib, "process_identity", Mock(side_effect=OSError("synthetic procfs failure"))
    )
    monkeypatch.setattr(lib.os, "waitid", Mock(return_value=None))
    kill = Mock()
    monkeypatch.setattr(lib.os, "killpg", kill)
    with pytest.raises(OSError, match="procfs"):
        lib.start_owned(["synthetic"])
    kill.assert_called_once_with(111, signal.SIGKILL)
    process.wait.assert_called_once()
    process.poll.assert_not_called()


def test_stale_record_does_not_prevent_other_owned_cleanup(monkeypatch):
    lib = lifecycle()
    monkeypatch.setattr(lib, "process_identity", lambda pid: (pid, pid, 200))
    valid = lib.OwnedProcess(Mock(pid=111))
    stale = lib.OwnedProcess(Mock(pid=222))
    monkeypatch.setattr(
        lib, "process_identity", lambda pid: (pid, pid, 201 if pid == 222 else 200)
    )
    kill = Mock()
    monkeypatch.setattr(lib.os, "killpg", kill)
    with pytest.raises(RuntimeError, match="identity"):
        lib.stop_processes([valid, stale], grace=0)
    assert [call.args for call in kill.call_args_list] == [
        (111, signal.SIGTERM),
        (111, signal.SIGKILL),
    ]
    assert valid.closed
    assert not stale.closed


def test_local_runner_rechecks_ownership_at_first_write(
    tmp_path, monkeypatch, mocked_runner_custody
):
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--database-port",
            "18001",
            "--api-port",
            "5056",
            "--frontend-port",
            "13001",
        ],
    )
    monkeypatch.setattr(local_check, "require_free_ports", lambda ports: None)
    monkeypatch.setattr(
        local_check, "fixture_inventory", lambda root: {"fixture_course.md": b"public"}
    )
    monkeypatch.setattr(local_check.tempfile, "mkdtemp", lambda **kwargs: str(tmp_path))
    processes = [Mock(poll=lambda: None) for _ in range(3)]
    monkeypatch.setattr(local_check, "start_owned", Mock(side_effect=processes))
    monkeypatch.setattr(local_check, "stop_processes", Mock())
    monkeypatch.setattr(local_check, "owned_listener_ready", lambda proc, port: True)
    monkeypatch.setattr(local_check, "http_ready", lambda url: True)
    requests: list[str] = []

    def owner(proc, port):
        if len(requests) == 3:
            raise RuntimeError("ownership lost before write")
        return True

    monkeypatch.setattr(local_check, "require_owned_listener", owner)

    def anonymous_get(url, **kwargs):
        requests.append("anonymous GET")
        return Mock(status_code=401)

    monkeypatch.setattr(local_check.httpx, "get", anonymous_get)

    class Client:
        def __init__(self, **kwargs):
            self.guard = kwargs["event_hooks"]["request"][0]
            assert kwargs["trust_env"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, *args, **kwargs):
            self.guard()
            requests.append("POST")
            raise AssertionError("unowned write reached transport")

    monkeypatch.setattr(local_check.httpx, "Client", Client)
    with pytest.raises(RuntimeError, match="ownership lost"):
        local_check.main()
    assert requests == ["anonymous GET"] * 3
    assert not (tmp_path / "api-results.json").exists()
