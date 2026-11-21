"""Real temporary launcher directories and log lifetimes with fake processes."""

import signal
import sys
from pathlib import Path
from unittest.mock import MagicMock, Mock, call

import pytest
from launcher_ports_fixtures import ISOLATED_PORTS, PORT_FLAGS

from scripts.v1 import run_native, runtime_lifecycle


@pytest.fixture
def mocked_launcher(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    env = {
        "OPEN_NOTEBOOK_PASSWORD": "synthetic-app-secret",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": "synthetic-encryption-secret",
        "SURREAL_PASSWORD": "synthetic-db-secret",
        "STUDY_WORKBENCH_RUNTIME_DIR": str(tmp_path / "fresh-runtime"),
        "STUDY_WORKBENCH_DATA_DIR": str(tmp_path / "fresh-personal"),
        "OPEN_NOTEBOOK_DATA_DIR": str(tmp_path / "fresh-upstream"),
    }
    monkeypatch.setattr(run_native, "ROOT", root)
    monkeypatch.setattr(
        run_native, "validate_private_config", Mock(return_value=tmp_path / "config")
    )
    monkeypatch.setattr(run_native, "build_runtime_environment", Mock(return_value=env))
    monkeypatch.setattr(run_native.os, "umask", Mock())
    monkeypatch.setattr(run_native.signal, "signal", Mock())
    killpg = Mock()
    monkeypatch.setattr(run_native.os, "killpg", killpg)
    procs = [
        Mock(pid=91000 + index, poll=Mock(return_value=None)) for index in range(4)
    ]
    popen = Mock(side_effect=procs)
    monkeypatch.setattr(run_native.subprocess, "Popen", popen)
    monkeypatch.setattr(
        runtime_lifecycle, "process_identity", lambda pid: (pid, pid, 1)
    )
    monkeypatch.setattr(runtime_lifecycle.os, "waitid", Mock(return_value=None))
    monkeypatch.setattr(run_native, "owned_listener_ready", Mock(return_value=True))
    monkeypatch.setattr(run_native, "require_owned_listener", Mock(return_value=True))
    get = Mock(return_value=Mock(status_code=200))
    monkeypatch.setattr(run_native.httpx, "get", get)
    worker = Mock(return_value=True)
    monkeypatch.setattr(run_native, "worker_startup_observed", worker)
    sock = MagicMock()
    sock.__enter__.return_value = sock
    monkeypatch.setattr(run_native.socket, "socket", Mock(return_value=sock))
    read_text = Path.read_text
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda self, *a, **kw: "header\n"
        if self.parent == Path("/proc/net")
        else read_text(self, *a, **kw),
    )

    def sleep(seconds):
        if seconds == 1:
            raise KeyboardInterrupt

    monkeypatch.setattr(run_native.time, "sleep", sleep)
    monkeypatch.setattr(
        sys,
        "argv",
        ["run_native", "--config", "/synthetic/config", "--frontend-dev", *PORT_FLAGS],
    )
    return env, procs, popen, get, worker, sock, killpg


def test_main_propagates_isolated_ports_to_every_boundary(mocked_launcher, capsys):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    run_native.main()
    commands = [invocation.args[0] for invocation in popen.call_args_list]
    assert commands[0][commands[0].index("--bind") + 1] == "127.0.0.1:18001"
    assert commands[1][commands[1].index("--port") + 1] == "5056"
    assert commands[3][commands[3].index("--port") + 1] == "13001"
    assert env["PORT"] == "13001" and env["HOSTNAME"] == "127.0.0.1"
    assert env["API_URL"] == env["CORS_ORIGINS"] == "http://127.0.0.1:13001"
    assert env["INTERNAL_API_URL"] == "http://127.0.0.1:5056"
    assert env["SURREAL_URL"] == "ws://127.0.0.1:18001/rpc"
    assert get.call_args_list == [
        call(url, timeout=1, trust_env=False)
        for url in (
            "http://127.0.0.1:18001/health",
            "http://127.0.0.1:5056/health",
            "http://127.0.0.1:13001/login",
        )
    ]
    worker.assert_called_once_with(
        Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]) / "worker.log", 0
    )
    assert sock.bind.call_args_list == [
        call(("127.0.0.1", port)) for port in ISOLATED_PORTS
    ]
    output = capsys.readouterr().out
    assert "Frontend http://127.0.0.1:13001" in output
    for old_port in ("18000", "5055", "13000"):
        assert old_port not in repr(commands) + repr(get.call_args_list) + output
    for secret in (
        "synthetic-app-secret",
        "synthetic-encryption-secret",
        "synthetic-db-secret",
    ):
        assert secret not in repr(commands) + repr(get.call_args_list) + output
    assert env["SURREAL_PASS"] == env["SURREAL_PASSWORD"]
    assert env["STUDY_WORKBENCH_PRIVATE_MODE"] == "1"
    for invocation in popen.call_args_list:
        assert invocation.kwargs["start_new_session"] is True
        assert invocation.kwargs["umask"] == 0o077
        assert invocation.kwargs["env"] is env
        assert invocation.kwargs["stdout"].closed
    assert killpg.call_args_list == [
        call(proc.pid, sig)
        for sig in (signal.SIGTERM, signal.SIGKILL)
        for proc in reversed(procs)
    ]


def test_startup_failure_closes_logs_and_only_stops_owned_groups(
    mocked_launcher, capsys
):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    popen.side_effect = [procs[0], OSError("synthetic-db-secret")]
    with pytest.raises(SystemExit) as error:
        run_native.main()
    assert "synthetic-db-secret" not in str(error.value) + capsys.readouterr().out
    assert killpg.call_args_list == [
        call(procs[0].pid, signal.SIGTERM),
        call(procs[0].pid, signal.SIGKILL),
    ]
    assert popen.call_count == 2
    assert all(
        invocation.kwargs["stdout"].closed for invocation in popen.call_args_list
    )


def test_bad_local_url_fails_before_runtime_creation_or_processes(mocked_launcher):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    env["SURREAL_URL"] = "ws://synthetic-db-secret@127.0.0.1:18000/rpc"
    with pytest.raises(SystemExit) as error:
        run_native.main()
    assert "synthetic-db-secret" not in str(error.value)
    assert not Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]).exists()
    popen.assert_not_called()
    get.assert_not_called()
    sock.bind.assert_not_called()
    killpg.assert_not_called()


def test_occupied_selected_port_never_starts_services(mocked_launcher):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    sock.bind.side_effect = OSError("synthetic")
    with pytest.raises(RuntimeError, match="occupied"):
        run_native.main()
    popen.assert_not_called()
    get.assert_not_called()
    killpg.assert_not_called()
    assert not Path(env["STUDY_WORKBENCH_RUNTIME_DIR"]).exists()


def test_readiness_failure_stops_only_started_services(mocked_launcher, monkeypatch):
    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    get.side_effect = [Mock(status_code=200), Mock(status_code=401)]
    monkeypatch.setattr(run_native.time, "monotonic", Mock(side_effect=[0, 0, 121]))
    with pytest.raises(SystemExit, match="startup/health check failed"):
        run_native.main()
    assert popen.call_count == 2
    assert killpg.call_args_list == [
        call(proc.pid, sig)
        for sig in (signal.SIGTERM, signal.SIGKILL)
        for proc in reversed(procs[:2])
    ]
    assert all(
        invocation.kwargs["stdout"].closed for invocation in popen.call_args_list
    )


def test_production_frontend_receives_selected_port(mocked_launcher, monkeypatch):
    import shutil

    env, procs, popen, get, worker, sock, killpg = mocked_launcher
    (run_native.ROOT / "frontend/.next/standalone").mkdir(parents=True)
    monkeypatch.setattr(shutil, "copytree", Mock())
    monkeypatch.setattr(
        sys, "argv", ["run_native", "--config", "/synthetic/config", *PORT_FLAGS]
    )
    run_native.main()
    frontend_command = popen.call_args_list[-1].args[0]
    assert frontend_command[:3] == ["npm", "run", "start"]
    assert frontend_command[-2:] == ["--port", "13001"]
    assert env["PORT"] == "13001"
