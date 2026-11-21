"""Pure OS-boundary doubles for the synthetic runner's public-parent custody."""

import stat
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import historical_database_pytest as runner


@pytest.mark.parametrize(
    "owner,mode",
    [(1, stat.S_IFDIR | 0o1777), (0, stat.S_IFDIR | 0o777), (0, stat.S_IFREG | 0o1777)],
)
def test_untrusted_parent_is_rejected_and_descriptor_closed(monkeypatch, owner, mode):
    opened = Mock(return_value=42)
    closed = Mock()
    monkeypatch.setattr(runner.os, "open", opened)
    monkeypatch.setattr(
        runner.os,
        "fstat",
        Mock(return_value=SimpleNamespace(st_uid=owner, st_mode=mode)),
    )
    monkeypatch.setattr(runner.os, "close", closed)
    with pytest.raises(ValueError, match="parent custody"):
        runner.open_temporary_parent()
    closed.assert_called_once_with(42)
    assert opened.call_args.args == (
        "/tmp",
        runner.os.O_RDONLY | runner.os.O_DIRECTORY | runner.os.O_NOFOLLOW,
    )


def test_trusted_parent_returns_open_descriptor_to_caller(monkeypatch):
    monkeypatch.setattr(runner.os, "open", Mock(return_value=42))
    monkeypatch.setattr(
        runner.os,
        "fstat",
        Mock(return_value=SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o1777)),
    )
    closed = Mock()
    monkeypatch.setattr(runner.os, "close", closed)
    assert runner.open_temporary_parent() == 42
    closed.assert_not_called()


def test_parent_open_failure_is_bounded(monkeypatch):
    monkeypatch.setattr(runner.os, "open", Mock(side_effect=OSError("synthetic")))
    closed = Mock()
    monkeypatch.setattr(runner.os, "close", closed)
    with pytest.raises(ValueError, match="parent custody"):
        runner.open_temporary_parent()
    closed.assert_not_called()


@pytest.mark.parametrize("failure", [OSError, KeyboardInterrupt, SystemExit])
def test_parent_inspection_failure_releases_descriptor(monkeypatch, failure):
    monkeypatch.setattr(runner.os, "open", Mock(return_value=42))
    monkeypatch.setattr(runner.os, "fstat", Mock(side_effect=failure("synthetic")))
    closed = Mock()
    monkeypatch.setattr(runner.os, "close", closed)
    with pytest.raises(ValueError if failure is OSError else failure):
        runner.open_temporary_parent()
    closed.assert_called_once_with(42)
