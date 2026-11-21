"""Read-only artifact verification wiring; fake subprocesses, no services/browser."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest


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
