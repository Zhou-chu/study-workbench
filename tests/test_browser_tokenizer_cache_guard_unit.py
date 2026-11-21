"""The browser check rejects missing prepared input before artifact validation."""

import pytest

from scripts.v1 import local_check


def test_browser_requires_explicit_cache_before_artifact_or_services(monkeypatch):
    monkeypatch.setattr(
        "sys.argv", ["local_check.py", "--browser", "--artifact", "/missing"]
    )
    monkeypatch.setattr(
        local_check,
        "verify_artifact",
        lambda *_: pytest.fail("verification must not precede missing-cache rejection"),
    )
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
