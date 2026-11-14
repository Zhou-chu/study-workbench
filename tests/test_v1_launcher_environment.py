"""Launcher isolation uses synthetic environments, never live configuration."""

import os
from io import StringIO

import pytest
from dotenv import load_dotenv

from scripts.v1.local_check import build_fixture_environment
from scripts.v1.run_native import build_runtime_environment


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


def test_runtime_environment_uses_explicit_config_then_disables_dotenv(tmp_path):
    config = tmp_path / "synthetic-config"
    config.write_text("CONFIG_ONLY=fixture\nSHARED=config\nPYTHON_DOTENV_DISABLED=0\n")
    env = build_runtime_environment(config, {"SHARED": "host", "HOST_ONLY": "fixture"})
    assert env["SHARED"] == "config"
    assert "HOST_ONLY" not in env
    assert env["CONFIG_ONLY"] == "fixture"
    assert env["PYTHON_DOTENV_DISABLED"] == "1"


@pytest.mark.parametrize("launcher", ["fixture", "runtime"])
def test_child_dotenv_loader_cannot_reintroduce_credentials(
    launcher, tmp_path, monkeypatch
):
    if launcher == "fixture":
        env = build_fixture_environment(tmp_path, {})
    else:
        config = tmp_path / "synthetic-config"
        config.write_text("CONFIG_ONLY=fixture\n")
        env = build_runtime_environment(config, {})
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", env["PYTHON_DOTENV_DISABLED"])
    monkeypatch.delenv("SYNTHETIC_PROVIDER_API_KEY", raising=False)
    assert (
        load_dotenv(stream=StringIO("SYNTHETIC_PROVIDER_API_KEY=should-not-load\n"))
        is False
    )
    import os

    assert "SYNTHETIC_PROVIDER_API_KEY" not in os.environ


def test_runtime_drops_ambient_credentials_and_execution_overrides(tmp_path):
    config = tmp_path / "synthetic-config"
    config.write_text(
        "OPENAI_API_KEY=\nEXPLICIT_TOKEN=synthetic\nREF=${AMBIENT_TOKEN}\n"
    )
    env = build_runtime_environment(
        config,
        {
            "PATH": "/synthetic/bin",
            "LANG": "C.UTF-8",
            "OPENAI_API_KEY": "ambient",
            "AMBIENT_TOKEN": "ambient",
            "SURREAL_PASSWORD_FILE": "/synthetic/secret",
            "GOOGLE_APPLICATION_CREDENTIALS": "/synthetic/profile",
            "SURREAL_UNAUTHENTICATED": "true",
            "HTTPS_PROXY": "http://synthetic",
            "NODE_OPTIONS": "--require=/synthetic",
            "PYTHONPATH": "/synthetic",
        },
    )
    assert env["PATH"] == "/synthetic/bin"
    assert env["LANG"] == "C.UTF-8"
    assert env["OPENAI_API_KEY"] == ""
    assert env["EXPLICIT_TOKEN"] == "synthetic"
    assert env["REF"] == "${AMBIENT_TOKEN}"
    assert env["LOGURU_DIAGNOSE"] == "NO"
    for name in (
        "AMBIENT_TOKEN",
        "SURREAL_PASSWORD_FILE",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "HTTPS_PROXY",
        "NODE_OPTIONS",
        "PYTHONPATH",
    ):
        assert name not in env


def test_private_config_rejects_symlink_permissions_and_repo_location(tmp_path):
    from scripts.v1.run_native import validate_private_config

    config = tmp_path / "synthetic-config"
    config.write_text("SYNTHETIC=value")
    config.chmod(0o600)
    assert validate_private_config(config, tmp_path / "repo") == config
    link = tmp_path / "link"
    link.symlink_to(config)
    with pytest.raises(ValueError):
        validate_private_config(link, tmp_path / "repo")
    with pytest.raises(ValueError):
        validate_private_config(config, tmp_path)
    config.chmod(0o644)
    with pytest.raises(ValueError):
        validate_private_config(config, tmp_path / "repo")


def test_private_log_permissions_and_symlink_rejection(tmp_path):
    import os

    from scripts.v1.run_native import open_private_log

    log = tmp_path / "synthetic.log"
    log.write_text("old")
    log.chmod(0o644)
    with open_private_log(log) as handle:
        handle.write("new")
    assert log.stat().st_mode & 0o777 == 0o600
    link = tmp_path / "link"
    link.symlink_to(log)
    with pytest.raises(OSError):
        open_private_log(link)
    assert os.path.isfile(log)


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


def test_private_runtime_cannot_disable_database_auth(tmp_path):
    config = tmp_path / "synthetic-config"
    config.write_text("SURREAL_UNAUTHENTICATED=true\nLOGURU_DIAGNOSE=YES\n")
    env = build_runtime_environment(config, {})
    assert env["SURREAL_UNAUTHENTICATED"] == "false"
    assert env["LOGURU_DIAGNOSE"] == "NO"


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


@pytest.mark.skipif(
    os.environ.get("STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE") != "1",
    reason="Set STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1 for owned disposable OS tests",
)
def test_cleanup_kills_real_owned_descendant_after_leader_exits(tmp_path):
    """Opt in with STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1; owned dummy processes only."""
    import sys
    import time
    from pathlib import Path

    from scripts.v1.run_native import stop_processes

    pidfile = tmp_path / "synthetic-child-pid"
    child = "import time; time.sleep(60)"
    code = (
        "import subprocess,sys; from pathlib import Path; "
        f'p=subprocess.Popen([sys.executable,"-c",{child!r}]); '
        f"Path({str(pidfile)!r}).write_text(str(p.pid))"
    )
    from scripts.v1.runtime_lifecycle import start_owned

    parent = start_owned([sys.executable, "-c", code])
    try:
        deadline = time.monotonic() + 5
        while parent.poll() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        assert parent.poll() == 0
        pid = int(pidfile.read_text())
        stop_processes([parent], grace=0.01)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = Path(f"/proc/{pid}/stat")
            if not status.exists() or status.read_text().split()[2] == "Z":
                break
            time.sleep(0.05)
        else:
            pytest.fail("Owned descendant survived group cleanup")
    finally:
        try:
            if not parent.closed:
                stop_processes([parent], grace=0)
        except ProcessLookupError:
            pass


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


def test_blank_optional_runtime_settings_use_defaults_without_ambient_secrets(tmp_path):
    from scripts.v1.run_native import apply_runtime_defaults

    config = tmp_path / "synthetic-config"
    keys = (
        "STUDY_WORKBENCH_RUNTIME_DIR",
        "STUDY_WORKBENCH_DATA_DIR",
        "OPEN_NOTEBOOK_DATA_DIR",
        "SURREAL_USER",
        "SURREAL_URL",
        "SURREAL_NAMESPACE",
        "SURREAL_DATABASE",
        "INTERNAL_API_URL",
        "API_URL",
        "CORS_ORIGINS",
        "OPENAI_API_KEY",
        "OPEN_NOTEBOOK_PASSWORD",
    )
    config.write_text("".join(f"{key}=\n" for key in keys))
    env = build_runtime_environment(config, {key: "ambient" for key in keys})
    root = tmp_path / "synthetic-repo"
    runtime = apply_runtime_defaults(env, root)
    assert runtime == root / ".runtime/data"
    assert env["STUDY_WORKBENCH_RUNTIME_DIR"] == str(runtime)
    assert env["STUDY_WORKBENCH_DATA_DIR"] == str(root / ".runtime/data/personal")
    assert env["OPEN_NOTEBOOK_DATA_DIR"] == str(runtime / "upstream-data")
    assert env["SURREAL_USER"] == "root"
    assert env["SURREAL_URL"] == "ws://127.0.0.1:18000/rpc"
    assert env["SURREAL_NAMESPACE"] == env["SURREAL_DATABASE"] == "study_workbench"
    assert env["INTERNAL_API_URL"] == "http://127.0.0.1:5055"
    assert env["API_URL"] == env["CORS_ORIGINS"] == "http://127.0.0.1:13000"
    assert env["OPENAI_API_KEY"] == env["OPEN_NOTEBOOK_PASSWORD"] == ""
    assert not runtime.exists()  # Defaulting/validation must not touch storage.


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
