import httpx
import pytest
from fastapi import FastAPI

from api.routers import source_snapshots
from api.source_snapshot_contracts import SnapshotProblem


@pytest.mark.asyncio
async def test_route_rejects_spoofed_body_requires_revision_and_documents_errors(
    monkeypatch,
):
    async def notebook(_):
        return object()

    monkeypatch.setattr(source_snapshots.Notebook, "get", notebook)

    class Service:
        async def create(self, notebook_id, request):
            assert notebook_id == "notebook:a"
            raise SnapshotProblem("SNAPSHOT_IDEMPOTENCY_CONFLICT", 409)

    monkeypatch.setattr(source_snapshots, "SourceSnapshotService", Service)
    app = FastAPI()
    app.include_router(source_snapshots.router, prefix="/api")
    endpoint = "/api/personal/notebooks/notebook:a/source-snapshots"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        base = {"origin_kind": "note", "note_id": "note:a", "idempotency_key": "one"}
        for body in [
            base,
            {**base, "expected_revision": True},
            {**base, "expected_revision": 1.0},
            {**base, "expected_revision": 1, "content": "spoofed"},
        ]:
            assert (await client.post(endpoint, json=body)).status_code == 422
        response = await client.post(endpoint, json={**base, "expected_revision": 1})
        assert response.status_code == 409
        assert response.json() == {"detail": {"code": "SNAPSHOT_IDEMPOTENCY_CONFLICT"}}
    responses = app.openapi()["paths"][
        "/api/personal/notebooks/{notebook_id}/source-snapshots"
    ]["post"]["responses"]
    assert len(responses["409"]["content"]["application/json"]["schema"]["anyOf"]) == 2
    assert "503" in responses and "410" in responses


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code,status",
    [
        ("SNAPSHOT_COMMIT_UNKNOWN", 503),
        ("SNAPSHOT_UNAVAILABLE", 410),
        ("RESULT_NOT_READY", 409),
    ],
)
async def test_route_preserves_explicit_snapshot_failure(code, status, monkeypatch):
    async def notebook(_):
        return object()

    monkeypatch.setattr(source_snapshots.Notebook, "get", notebook)

    class Service:
        async def create(self, *_):
            raise SnapshotProblem(code, status)

    monkeypatch.setattr(source_snapshots, "SourceSnapshotService", Service)
    app = FastAPI()
    app.include_router(source_snapshots.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/notebooks/notebook:a/source-snapshots",
            json={"origin_kind": "turn", "turn_id": "turn_a", "idempotency_key": "one"},
        )
        assert response.status_code == status
        assert response.json() == {"detail": {"code": code}}
