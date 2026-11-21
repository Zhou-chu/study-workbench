"""Environment-only SSL option mapping; no filesystem probing."""

import pytest

from open_notebook.utils.ssl_config import httpx_verify_setting


@pytest.fixture(autouse=True)
def _clear_ssl_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ESPERANTO_SSL_VERIFY", raising=False)
    monkeypatch.delenv("ESPERANTO_SSL_CA_BUNDLE", raising=False)


def test_default_verify_enabled() -> None:
    assert httpx_verify_setting() is True


@pytest.mark.parametrize("value", ["false", "0", "no", "FALSE", "No"])
def test_verify_disabled_via_env(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ESPERANTO_SSL_VERIFY", value)
    assert httpx_verify_setting() is False
