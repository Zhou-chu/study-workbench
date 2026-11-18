"""Direct environment/launcher decisions using process, procfs and socket doubles."""

import pytest

from scripts.v1.local_check import build_fixture_environment


def test_fixture_environment_drops_host_credentials_and_disables_dotenv(tmp_path):
    env = build_fixture_environment(
        tmp_path,
        {
            "PATH": "/synthetic/bin",
            "OPENAI_API_KEY": "synthetic-host-key",
            "GOOGLE_APPLICATION_CREDENTIALS": "/synthetic/profile",
            "NOTEBOOKLM_HOME": "/synthetic/host-profile",
            "PYTHON_DOTENV_DISABLED": "0",
        },
    )
    assert env["PATH"] == "/synthetic/bin"
    assert "OPENAI_API_KEY" not in env
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in env
    assert env["NOTEBOOKLM_HOME"] == str(tmp_path / "no-google-profile")
    assert env["PYTHON_DOTENV_DISABLED"] == "1"


def test_readiness_fails_closed_on_timeout_or_process_exit():
    from unittest.mock import Mock

    from scripts.v1.run_native import wait_for_service

    with pytest.raises(RuntimeError, match="api exited"):
        wait_for_service("api", Mock(poll=lambda: 1), lambda: True, timeout=0.01)
    with pytest.raises(RuntimeError, match="api readiness timed out"):
        wait_for_service("api", Mock(poll=lambda: None), lambda: False, timeout=0.01)
    wait_for_service("api", Mock(poll=lambda: None), lambda: True, timeout=1)


def test_cleanup_signals_owned_groups_even_after_parent_exit(monkeypatch):
    import signal
    from unittest.mock import Mock

    from scripts.v1.run_native import stop_processes

    calls = []
    monkeypatch.setattr(
        "scripts.v1.run_native.os.killpg", lambda pid, sig: calls.append((pid, sig))
    )
    from scripts.v1 import runtime_lifecycle

    monkeypatch.setattr(
        runtime_lifecycle, "process_identity", lambda pid: (pid, pid, 1)
    )
    proc = runtime_lifecycle.OwnedProcess(Mock(pid=12345))
    stop_processes([proc], grace=0)
    assert (12345, signal.SIGTERM) in calls
    assert (12345, signal.SIGKILL) in calls


def test_loopback_validation_rejects_wildcard_listener(monkeypatch):
    from pathlib import Path

    from scripts.v1.run_native import verify_loopback_listeners

    monkeypatch.setattr(
        Path, "read_text", lambda self: "header\n0: 00000000:13BF 00000000:0000 0A\n"
    )
    with pytest.raises(RuntimeError, match="non-loopback"):
        verify_loopback_listeners()


def test_http_probe_rejects_errors_and_disables_proxy(monkeypatch):
    from unittest.mock import Mock

    from scripts.v1.run_native import http_ready

    get = Mock(return_value=Mock(status_code=401))
    monkeypatch.setattr("scripts.v1.run_native.httpx.get", get)
    assert not http_ready("http://127.0.0.1:5055/health")
    assert get.call_args.kwargs["trust_env"] is False
    get.return_value.status_code = 200
    assert http_ready("http://127.0.0.1:5055/health")


def test_port_preflight_supports_restart_but_rejects_occupied_port(monkeypatch):
    import socket
    from unittest.mock import MagicMock

    from scripts.v1.run_native import require_free_ports

    sock = MagicMock()
    sock.__enter__.return_value = sock
    monkeypatch.setattr("scripts.v1.run_native.socket.socket", lambda: sock)
    require_free_ports()
    sock.setsockopt.assert_called_with(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind.side_effect = OSError("synthetic")
    with pytest.raises(RuntimeError, match="occupied"):
        require_free_ports()


@pytest.mark.parametrize("location", ["root", "ancestor"])
def test_runtime_rejects_source_root_and_ancestors_before_storage_changes(
    tmp_path, location
):
    from scripts.v1.run_native import apply_runtime_defaults

    root = tmp_path / "synthetic-repo"
    selected = root if location == "root" else tmp_path
    with pytest.raises(ValueError, match="source root or ancestor"):
        apply_runtime_defaults({"STUDY_WORKBENCH_RUNTIME_DIR": str(selected)}, root)
    assert not root.exists()


def test_runtime_defaults_preserve_explicit_optional_settings(tmp_path):
    from scripts.v1.run_native import apply_runtime_defaults

    runtime = tmp_path / "selected-runtime"
    env = {
        "STUDY_WORKBENCH_RUNTIME_DIR": str(runtime),
        "STUDY_WORKBENCH_DATA_DIR": "/synthetic/personal",
        "OPEN_NOTEBOOK_DATA_DIR": "/synthetic/upstream",
        "API_URL": "http://127.0.0.1:13000/custom",
    }
    assert apply_runtime_defaults(env, tmp_path / "repo") == runtime
    assert env["STUDY_WORKBENCH_DATA_DIR"] == "/synthetic/personal"
    assert env["OPEN_NOTEBOOK_DATA_DIR"] == "/synthetic/upstream"
    assert env["API_URL"] == "http://127.0.0.1:13000/custom"
