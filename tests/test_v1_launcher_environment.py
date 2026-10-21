"""Launcher isolation uses synthetic environments, never live configuration."""

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
    assert env["HOST_ONLY"] == env["CONFIG_ONLY"] == "fixture"
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
