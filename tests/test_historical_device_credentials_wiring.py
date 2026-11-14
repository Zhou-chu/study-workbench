"""Test-infrastructure wiring checks; actual native tests stop at stub signin."""

import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def native_module():
    path = Path(__file__).with_name("test_v1_device_session_repository.py")
    spec = importlib.util.spec_from_file_location(
        "native_device_credentials_wiring_target", path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SigninReached(BaseException):
    pass


async def invoke(module, entry, monkeypatch):
    if entry == "transactions":
        await module.test_native_surreal_transactions()
    else:
        await module.test_corrupt_schema_fails_readiness_and_issuance(
            monkeypatch, "UNREACHED synthetic corruption"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ["transactions", "schema"])
@pytest.mark.parametrize(
    "password", ["random-synthetic-7a2!", "  synthetic exact whitespace \t"]
)
async def test_actual_native_entry_uses_runner_password_verbatim(
    native_module, monkeypatch, entry, password
):
    seen = []

    class Connection:
        def __init__(self, url):
            seen.append(("construct", url))

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def signin(self, credentials):
            seen.append(("signin", credentials))
            raise SigninReached()

    monkeypatch.setenv("AUTH_TEST_SURREAL_URL", "ws://127.0.0.1:19999")
    monkeypatch.setenv("SURREAL_PASSWORD", password)
    monkeypatch.setattr(native_module, "AsyncSurreal", Connection)
    with pytest.raises(SigninReached):
        await invoke(native_module, entry, monkeypatch)
    assert seen == [
        ("construct", "ws://127.0.0.1:19999"),
        ("signin", {"username": "synthetic", "password": password}),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ["transactions", "schema"])
@pytest.mark.parametrize("password", [None, "", " \t\n", "\u2003"])
async def test_actual_native_entry_rejects_missing_password_before_connection(
    native_module, monkeypatch, entry, password
):
    constructed = []

    def forbidden(url):
        constructed.append(url)
        raise SigninReached()

    monkeypatch.setenv("AUTH_TEST_SURREAL_URL", "ws://127.0.0.1:19999")
    if password is None:
        monkeypatch.delenv("SURREAL_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("SURREAL_PASSWORD", password)
    monkeypatch.setattr(native_module, "AsyncSurreal", forbidden)
    with pytest.raises(RuntimeError, match="SURREAL_PASSWORD"):
        await invoke(native_module, entry, monkeypatch)
    assert constructed == []
