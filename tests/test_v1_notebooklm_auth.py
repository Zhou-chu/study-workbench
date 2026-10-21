"""Offline contract checks. No Google credentials or network are used."""

import importlib
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest


def adapter_type():
    try:
        module = importlib.import_module(
            "open_notebook.integrations.notebooklm.sdk_adapter"
        )
    except ModuleNotFoundError:
        pytest.fail("NotebookLM public SDK adapter has not been implemented")
    return module.SDKNotebookLMBridge


@pytest.mark.asyncio
async def test_cookie_file_alone_never_means_connected(tmp_path):
    path = tmp_path / "profile" / "storage_state.json"
    path.parent.mkdir()
    path.write_text("{}")
    bridge = adapter_type()(storage_path=path)
    status = bridge.connection_status()
    assert status.state != "connected"
    assert status.last_verified_at is None


@pytest.mark.asyncio
async def test_missing_profile_is_disconnected_without_constructing_sdk(tmp_path):
    bridge = adapter_type()(storage_path=tmp_path / "missing.json")
    status = await bridge.verify_connection()
    assert status.state == "disconnected"
    assert status.quota is None


@pytest.mark.asyncio
async def test_only_successful_read_marks_connected(tmp_path):
    path = tmp_path / "storage.json"
    path.write_text("{}")

    @asynccontextmanager
    async def factory(path):
        async def notebooks():
            return []

        yield SimpleNamespace(notebooks=SimpleNamespace(list=notebooks))

    bridge = adapter_type()(storage_path=path, client_factory=factory)
    status = await bridge.verify_connection()
    assert status.state == "connected"
    assert status.last_verified_at
    assert status.quota is None


@pytest.mark.asyncio
async def test_unexpected_schema_does_not_claim_connected(tmp_path):
    path = tmp_path / "storage.json"
    path.write_text("{}")

    @asynccontextmanager
    async def factory(path):
        async def notebooks():
            return {"unknown": "format"}

        yield SimpleNamespace(notebooks=SimpleNamespace(list=notebooks))

    bridge = adapter_type()(storage_path=path, client_factory=factory)
    status = await bridge.verify_connection()
    assert status.state == "unavailable"
    assert status.reason == "REMOTE_SCHEMA_CHANGED"


@pytest.mark.asyncio
async def test_login_flow_honestly_unavailable_without_visible_runtime_browser(
    tmp_path,
):
    bridge = adapter_type()(storage_path=tmp_path / "storage.json")
    flow = await bridge.start_login()
    assert flow["state"] == "unavailable"
    assert flow["flow_id"]
    assert flow["expires_at"]
    assert "visible" in flow["reason"].lower()
    assert await bridge.start_login() == flow


@pytest.mark.asyncio
async def test_disconnect_closes_gate_before_deleting_owned_session(tmp_path):
    path = tmp_path / "storage.json"
    path.write_text("{}")
    bridge = adapter_type()(storage_path=path)
    await bridge.disconnect()
    assert not path.exists()
    assert bridge.connection_status().state == "disconnected"
    assert (await bridge.verify_connection()).state == "disconnected"


@pytest.mark.asyncio
async def test_test_adapter_requires_explicit_responses_and_injection(monkeypatch):
    try:
        module = importlib.import_module(
            "open_notebook.integrations.notebooklm.fake_adapter"
        )
    except ModuleNotFoundError:
        pytest.fail("Explicit injection-only test adapter not implemented")
    from api.notebooklm_service import NotebookLMService
    from open_notebook.integrations.notebooklm.contracts import (
        BridgeError,
        ConnectionStatus,
    )

    monkeypatch.setenv("NOTEBOOKLM_FAKE", "true")
    assert isinstance(NotebookLMService().bridge, adapter_type())
    fake = module.FakeNotebookLMBridge({})
    with pytest.raises(BridgeError):
        await fake.verify_connection()
    fake = module.FakeNotebookLMBridge(
        {"verify_connection": ConnectionStatus(state="connected")}
    )
    assert (await fake.verify_connection()).state == "connected"
    assert NotebookLMService(bridge=fake).bridge is fake
