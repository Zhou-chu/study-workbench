"""Browser-mode CLI early returns with tokenizer, artifact and port doubles."""

from unittest.mock import Mock

import pytest

from scripts.v1 import local_check


def test_browser_requires_verified_artifact_before_ports_or_storage(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        "sys.argv",
        [
            "local_check",
            "--browser",
            "--artifact",
            str(tmp_path / "old"),
            "--tiktoken-cache",
            str(tmp_path / "cache"),
        ],
    )
    # This test isolates artifact ordering; cache validation has dedicated tests.
    prepared = Mock(return_value=b"fixture")
    monkeypatch.setattr(local_check, "prepared_tokenizer", prepared)
    verify = Mock(side_effect=RuntimeError("stale artifact"))
    monkeypatch.setattr(local_check, "verify_artifact", verify, raising=False)
    ports = Mock(side_effect=AssertionError("no ports before artifact verification"))
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(RuntimeError, match="stale"):
        local_check.main()
    prepared.assert_called_once_with(tmp_path / "cache")
    verify.assert_called_once()
    ports.assert_not_called()


def test_browser_without_artifact_fails_before_port_selection(monkeypatch):
    monkeypatch.setattr("sys.argv", ["local_check", "--browser"])
    ports = Mock(side_effect=AssertionError("missing artifact must not select ports"))
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
    ports.assert_not_called()
