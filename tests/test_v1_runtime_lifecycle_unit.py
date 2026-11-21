"""Direct launcher/lifecycle decisions with fake process, procfs and HTTP seams."""

import os
import signal
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from runtime_lifecycle_test_fixtures import lifecycle

from scripts.v1 import local_check, run_native


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


def test_browser_phase_fails_closed_before_ports_or_storage(monkeypatch):
    monkeypatch.setattr("sys.argv", ["local_check", "--browser"])
    select = Mock(side_effect=AssertionError("must not select ports"))
    monkeypatch.setattr(local_check, "select_unused_ports", select)
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
    select.assert_not_called()


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
