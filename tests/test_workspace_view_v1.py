"""Synthetic, offline public projection and authenticated read contracts."""

import copy

import httpx
import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from workspace_view_fixtures import example


@pytest.mark.asyncio
async def test_routes_keep_old_wire_and_use_same_service_scope_check(monkeypatch):
    from api.routers import evidence
    from open_notebook.exceptions import NotFoundError

    calls = []
    raw = example()["raw_workspace"]

    class Service:
        async def workspace(self, notebook_id):
            calls.append(notebook_id)
            if notebook_id != "notebook:synthetic":
                raise NotFoundError("synthetic missing notebook")
            return copy.deepcopy(raw)

    monkeypatch.setattr(evidence, "PersonalService", Service)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        old = await client.get("/api/personal/notebooks/notebook:synthetic/workspace")
        new = await client.get(
            "/api/personal/notebooks/notebook:synthetic/workspace-view"
        )
    assert old.json() == jsonable_encoder(raw)
    assert new.json() == example()["workspace_view"]
    with pytest.raises(NotFoundError):
        await evidence.workspace_view("notebook:other")
    assert calls == ["notebook:synthetic", "notebook:synthetic", "notebook:other"]


@pytest.mark.asyncio
async def test_client_capabilities_are_authenticated_read_only_real_limits(monkeypatch):
    from api.auth import PasswordAuthMiddleware
    from api.portable_limits import get_portable_limits
    from api.routers import evidence
    from api.source_upload_limits import get_source_upload_max_bytes

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic-password")
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_FILE_MB", "1.5")
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        denied = await client.get("/api/personal/client-capabilities")
        allowed = await client.get(
            "/api/personal/client-capabilities",
            headers={"Authorization": "Bearer synthetic-password"},
        )
    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json() == {
        "contract_version": "client-capabilities-v1",
        "supported_contracts": ["workspace-view-v1"],
        "limits": {
            "source_upload_max_bytes": get_source_upload_max_bytes(),
            "portable": get_portable_limits().public(),
        },
    }
    assert get_source_upload_max_bytes() == 1572864
    monkeypatch.delenv("STUDY_WORKBENCH_MAX_FILE_MB")
    assert get_source_upload_max_bytes() == 50 * 1024 * 1024
