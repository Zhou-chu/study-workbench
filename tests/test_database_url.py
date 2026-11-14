"""get_database_url() fallback to the legacy SURREAL_ADDRESS / SURREAL_PORT variables."""

import pytest

from open_notebook.database.repository import get_database_url


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for name in (
        "SURREAL_URL",
        "SURREAL_ADDRESS",
        "SURREAL_PORT",
        "SURREAL_INSECURE_ALLOW_URL",
    ):
        monkeypatch.delenv(name, raising=False)


def test_surreal_url_wins(monkeypatch):
    monkeypatch.setenv("SURREAL_URL", "wss://db:8000/rpc")
    monkeypatch.setenv("SURREAL_ADDRESS", "other")
    assert get_database_url() == "wss://db:8000/rpc"


def test_defaults():
    assert get_database_url() == "ws://localhost:8000/rpc"


def test_address_and_port(monkeypatch):
    monkeypatch.setenv("SURREAL_ADDRESS", "db.internal")
    monkeypatch.setenv("SURREAL_PORT", "8018")
    monkeypatch.setenv("SURREAL_INSECURE_ALLOW_URL", "ws://db.internal:8018/rpc")
    assert get_database_url() == "ws://db.internal:8018/rpc"


def test_bracketed_ipv6_without_port_gets_surreal_port(monkeypatch):
    monkeypatch.setenv("SURREAL_ADDRESS", "[::1]")
    monkeypatch.setenv("SURREAL_PORT", "8018")
    assert get_database_url() == "ws://[::1]:8018/rpc"


def test_bracketed_ipv6_with_port(monkeypatch):
    monkeypatch.setenv("SURREAL_ADDRESS", "[::1]:8000")
    assert get_database_url() == "ws://[::1]:8000/rpc"


def test_address_with_port_ignores_surreal_port(monkeypatch):
    monkeypatch.setenv("SURREAL_ADDRESS", "10.1.2.3:8000")
    monkeypatch.setenv("SURREAL_PORT", "9999")
    monkeypatch.setenv("SURREAL_INSECURE_ALLOW_URL", "ws://10.1.2.3:8000/rpc")
    assert get_database_url() == "ws://10.1.2.3:8000/rpc"


@pytest.mark.parametrize(
    "url",
    [
        "ws://db:8000/rpc",
        "http://10.0.0.1:8000",
        "ws://0.0.0.0:8000",
        "ws://localhost.example/rpc",
        "ws://127.0.0.1.example/rpc",
        "ws://[::ffff:127.0.0.1]:8000/rpc",
    ],
)
def test_remote_plaintext_is_rejected(monkeypatch, url):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setenv("SURREAL_URL", url)
    with pytest.raises(ConfigurationError):
        get_database_url()


@pytest.mark.parametrize(
    "url",
    [
        "ws://127.0.0.1:8000/rpc",
        "http://localhost:8000",
        "ws://[::1]:8000/rpc",
        "wss://db.example:443/rpc",
        "https://db.example",
        "mem://",
        "memory://",
        "file:///tmp/synthetic.db",
        "surrealkv://test",
    ],
)
def test_supported_endpoints_preserved_without_connection(monkeypatch, url):
    monkeypatch.setenv("SURREAL_URL", url)
    assert get_database_url() == url


@pytest.mark.parametrize(
    "url",
    [
        " ws://localhost/rpc",
        "ws://local\thost/rpc",
        "ws://user:secret@localhost/rpc",
        "wss://db:secret@host/rpc",
        "wss://db:99999/rpc",
        "ws:///rpc",
        "ws://localhost/rpc?secret=x",
        "ws://localhost/rpc#secret",
        "ws://[::1]evil/rpc",
        "ws://[::1]:80junk/rpc",
        "ws://[::1][x]/rpc",
        "https://-host/rpc",
        "https://host-/rpc",
        "https://-/rpc",
        "https://host!example/rpc",
        "ftp://localhost",
        "memory",
        "ws://127.1/rpc",
        "ws://localhost./rpc",
        "ws://%6cocalhost/rpc",
        "ws://localhost\\evil/rpc",
        "file://",
        "memory://unexpected",
        "mem:unexpected",
    ],
)
def test_invalid_url_never_echoes_input_or_bypasses_exception(monkeypatch, url):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setenv("SURREAL_URL", url)
    monkeypatch.setenv("SURREAL_INSECURE_ALLOW_URL", url)
    with pytest.raises(ConfigurationError) as exc:
        get_database_url()
    assert url not in str(exc.value)
    assert "secret" not in str(exc.value)
    assert exc.value.__cause__ is None


def test_exception_is_exact_endpoint_only(monkeypatch):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setenv("SURREAL_URL", "ws://db:8000/rpc")
    monkeypatch.setenv("SURREAL_INSECURE_ALLOW_URL", "ws://db:8000/rpc")
    assert get_database_url() == "ws://db:8000/rpc"
    for exception in ("true", "*", "ws://db:8000", "ws://other:8000/rpc"):
        monkeypatch.setenv("SURREAL_INSECURE_ALLOW_URL", exception)
        with pytest.raises(ConfigurationError):
            get_database_url()


def test_legacy_remote_default_denied(monkeypatch):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setenv("SURREAL_ADDRESS", "db.internal")
    with pytest.raises(ConfigurationError):
        get_database_url()


@pytest.mark.asyncio
async def test_rejected_before_sdk_construction(monkeypatch):
    from open_notebook.database import repository
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setenv("SURREAL_URL", "ws://db:8000/rpc")

    def forbidden(*args, **kwargs):
        pytest.fail("SDK must not be constructed for rejected URL")

    monkeypatch.setattr(repository, "AsyncSurreal", forbidden)
    with pytest.raises(ConfigurationError):
        async with repository.db_connection():
            pytest.fail("must not yield")
