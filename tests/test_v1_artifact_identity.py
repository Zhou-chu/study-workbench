"""Read-only artifact verification wiring; fake subprocesses, no services/browser."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts.v1 import local_check


def test_browser_requires_verified_artifact_before_ports_or_storage(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        "sys.argv", ["local_check", "--browser", "--artifact", str(tmp_path / "old")]
    )
    verify = Mock(side_effect=RuntimeError("stale artifact"))
    monkeypatch.setattr(local_check, "verify_artifact", verify, raising=False)
    ports = Mock(side_effect=AssertionError("no ports before artifact verification"))
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(RuntimeError, match="stale"):
        local_check.main()
    verify.assert_called_once()
    ports.assert_not_called()


def test_verifier_uses_sanitized_environment_and_does_not_echo_child_errors(
    tmp_path, monkeypatch
):
    from scripts.v1 import artifact_identity

    (tmp_path / "frontend/scripts").mkdir(parents=True)
    (tmp_path / "frontend/scripts/build-artifact.mjs").write_text("// fixture")
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    monkeypatch.setenv("NODE_OPTIONS", "--require=/poison")
    monkeypatch.setenv("OPENAI_API_KEY", "private")
    run = Mock(return_value=SimpleNamespace(returncode=1, stderr="private", stdout=""))
    monkeypatch.setattr(artifact_identity.subprocess, "run", run)
    with pytest.raises(RuntimeError) as error:
        artifact_identity.verify_artifact(tmp_path, artifact)
    assert "private" not in str(error.value)
    assert "NODE_OPTIONS" not in run.call_args.kwargs["env"]
    assert "OPENAI_API_KEY" not in run.call_args.kwargs["env"]
    assert run.call_args.kwargs["cwd"] == tmp_path / "frontend"


def test_symlink_artifact_rejected_before_process(tmp_path, monkeypatch):
    from scripts.v1 import artifact_identity

    link = tmp_path / "artifact"
    link.symlink_to(tmp_path / "unread-private")
    run = Mock(side_effect=AssertionError("no process for invalid path"))
    monkeypatch.setattr(artifact_identity.subprocess, "run", run)
    with pytest.raises(ValueError, match="symlink"):
        artifact_identity.verify_artifact(tmp_path, link)
    run.assert_not_called()


def test_browser_without_artifact_fails_before_port_selection(monkeypatch):
    monkeypatch.setattr("sys.argv", ["local_check", "--browser"])
    ports = Mock(side_effect=AssertionError("missing artifact must not select ports"))
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
    ports.assert_not_called()
