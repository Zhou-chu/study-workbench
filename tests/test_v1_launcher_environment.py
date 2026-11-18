"""Launcher isolation uses synthetic environments, never live configuration."""

import os
from io import StringIO

import pytest
from dotenv import load_dotenv

from scripts.v1.local_check import build_fixture_environment
from scripts.v1.run_native import build_runtime_environment


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


def test_private_runtime_cannot_disable_database_auth(tmp_path):
    config = tmp_path / "synthetic-config"
    config.write_text("SURREAL_UNAUTHENTICATED=true\nLOGURU_DIAGNOSE=YES\n")
    env = build_runtime_environment(config, {})
    assert env["SURREAL_UNAUTHENTICATED"] == "false"
    assert env["LOGURU_DIAGNOSE"] == "NO"


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
