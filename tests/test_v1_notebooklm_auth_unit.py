"""Unavailable visible-browser login is an in-memory adapter state transition."""

import pytest
from notebooklm_auth_fixtures import adapter_type


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
