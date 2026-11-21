"""Offline contract checks. No Google credentials or network are used."""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from notebooklm_auth_fixtures import adapter_type


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
async def test_disconnect_closes_gate_before_deleting_owned_session(tmp_path):
    path = tmp_path / "storage.json"
    path.write_text("{}")
    bridge = adapter_type()(storage_path=path)
    await bridge.disconnect()
    assert not path.exists()
    assert bridge.connection_status().state == "disconnected"
    assert (await bridge.verify_connection()).state == "disconnected"
