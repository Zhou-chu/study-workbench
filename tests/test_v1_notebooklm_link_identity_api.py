"""Real ASGI notebook-link and workspace routes with a synthetic SQL seam."""

from copy import deepcopy

import httpx
import pytest
from notebooklm_link_identity_fixtures import LINK, NOTEBOOK, STAMP
from notebooklm_link_identity_fixtures import physical as _physical

from api.personal_store import record_key

physical = _physical


@pytest.mark.asyncio
async def test_actual_link_route_is_visible_through_physical_store_and_workspace_wire(
    physical,
):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=physical.app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/personal/notebooks/{NOTEBOOK}/notebooklm-link",
            json={"remote_notebook_id": "remote-current"},
        )
        assert response.status_code == 200
        record = response.json()
        assert record == {
            "link_id": LINK,
            "notebook_id": NOTEBOOK,
            "connection_id": "notebooklm",
            "remote_notebook_id": "remote-current",
            "last_checked_at": STAMP,
        }
        assert physical.events == [
            ("notebook", NOTEBOOK),
            ("connection", "notebooklm"),
            ("remote", "remote-current"),
            ("lock", NOTEBOOK),
            ("put", record_key("link", LINK)),
            ("unlock", NOTEBOOK),
        ]
        assert physical.rows[record_key("link", LINK)] == {
            "app_id": LINK,
            "payload": record,
        }
        assert record_key("link", NOTEBOOK) not in physical.rows
        record["future_metadata"] = {"opaque": [None, "retained"]}
        await physical.store.put("link", LINK, record)
        before = deepcopy(physical.rows)
        response = await client.get(f"/api/personal/notebooks/{NOTEBOOK}/workspace")
    assert response.status_code == 200
    assert response.json()["link"] == record
    assert physical.rows == before
