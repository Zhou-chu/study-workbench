"""Authenticated route wiring and local-only job handling."""

from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from test_evidence_indexing_jobs import NB, request_for
from test_evidence_indexing_jobs import indexing as indexing_fixture

from api.routers import evidence, notebooklm

indexing = indexing_fixture


@pytest.mark.asyncio
async def test_semantic_routes_delegate_explicitly_and_never_embed(
    indexing, monkeypatch
):
    f = indexing
    monkeypatch.setattr(evidence, "EvidenceIndexingService", lambda: f.service)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = f"/api/personal/notebooks/{NB}/semantic-index"
        response = await client.post(
            base + "/preview",
            json={"source_version_ids": ["v1"], "profile_id": "chosen"},
        )
        assert response.status_code == 200
        preview = response.json()
        assert preview["evidence_count"] == 1
        status = await client.get(base, params={"source_version_ids": "v1"})
        assert status.status_code == 200
        build = await client.post(
            base,
            json={
                "source_version_ids": ["v1"],
                "profile_id": "chosen",
                "preview_hash": preview["preview_hash"],
                "acknowledge_external_processing": True,
                "idempotency_key": "route",
            },
        )
        assert build.status_code == 200
        assert len(build.json()["jobs"]) == 1
        invalid = await client.post(
            base, json={"source_version_ids": [], "profile_id": "chosen"}
        )
        assert invalid.status_code == 422
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_index_status_cancel_do_not_construct_legacy_bridge(
    indexing, monkeypatch
):
    from api import notebooklm_service

    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    monkeypatch.setattr(
        notebooklm, "EvidenceIndexingService", lambda **kwargs: f.service
    )
    monkeypatch.setattr(notebooklm_service, "get_store", lambda: f.store)
    monkeypatch.setattr(notebooklm_service, "_service", None)
    bridge = AsyncMock(side_effect=AssertionError("legacy bridge constructed"))
    monkeypatch.setattr(notebooklm_service, "SDKNotebookLMBridge", bridge)
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        url = f"/api/personal/jobs/{receipt.job_ids[0]}"
        assert (await client.get(url)).status_code == 200
        assert (await client.post(url + "/cancel")).json()["state"] == "cancelled_local"
        group = (await client.get(f"/api/personal/jobs/{receipt.group_id}")).json()
        assert len(group["jobs"]) == 1
    bridge.assert_not_called()
    assert f.provider.calls == []


def test_request_contract_keeps_exact_retry_fields_and_strict_booleans():
    from api.evidence_indexing import IndexRequest

    assert set(IndexRequest.model_fields) == {
        "source_version_ids",
        "profile_id",
        "preview_hash",
        "acknowledge_external_processing",
        "idempotency_key",
        "retry_of_job_id",
        "acknowledge_duplicate_embedding_cost",
    }
    with pytest.raises(ValueError):
        IndexRequest.model_validate(
            dict(
                source_version_ids=["v1"],
                profile_id="chosen",
                preview_hash="a" * 64,
                acknowledge_external_processing="true",
                idempotency_key="one",
            )
        )


@pytest.mark.asyncio
async def test_authenticated_semantic_endpoints_reject_before_service(monkeypatch):
    from api.auth import PasswordAuthMiddleware

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "offline-test-only")
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "legacy_password")
    service = AsyncMock(side_effect=AssertionError("unauthenticated handler executed"))
    monkeypatch.setattr(evidence, "EvidenceIndexingService", service)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = f"/api/personal/notebooks/{NB}/semantic-index"
        for method, path in [
            ("GET", base),
            ("POST", base),
            ("POST", base + "/preview"),
        ]:
            assert (await client.request(method, path, json={})).status_code == 401
    service.assert_not_called()


def test_lazy_bridge_preserves_injected_and_legacy_assignment(monkeypatch):
    from api import notebooklm_service

    bridge = object()
    builds = []

    def build():
        builds.append(bridge)
        return bridge

    monkeypatch.setattr(notebooklm_service, "SDKNotebookLMBridge", build)
    service = notebooklm_service.NotebookLMService(store=object())
    assert builds == []
    assert service.bridge is bridge
    assert service.bridge is bridge
    assert builds == [bridge]
    replacement = object()
    service.bridge = replacement
    assert service.bridge is replacement
    explicit = notebooklm_service.NotebookLMService(store=object(), bridge=replacement)
    assert explicit.bridge is replacement
    assert builds == [bridge]
