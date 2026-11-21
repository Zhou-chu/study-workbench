"""Lossless public operation responses, using real routers and synthetic storage."""

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore

from api.routers import evidence, notebooklm

FIXTURES = Path(__file__).resolve().parents[1] / "contracts/v1/fixtures"


def cases():
    return json.loads((FIXTURES / "job-states.json").read_text())


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", cases())
async def test_get_and_explicit_cancel_preserve_real_route_serialization(payload):
    store = MemoryStore()
    await store.put("job", payload["job_id"], copy.deepcopy(payload))
    service = SimpleNamespace(store=store)
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = lambda: service
    # Baseline is the exact unfiltered route value, not a hand-written projection.
    before = await notebooklm.job_status(payload["job_id"], service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/personal/jobs/{payload['job_id']}")
        assert response.status_code == 200
        assert response.json() == before == payload
        before_cancel = await notebooklm.cancel_job(payload["job_id"], service)
        # Restore the initial state to exercise exactly the same transition over HTTP.
        await store.put("job", payload["job_id"], copy.deepcopy(payload))
        response = await client.post(f"/api/personal/jobs/{payload['job_id']}/cancel")
        assert response.status_code == 200
        assert response.json() == before_cancel
        if payload["state"] not in ("queued", "running"):
            assert (
                response.json() == payload
            )  # unknown states never authorize cancellation
        else:
            assert response.json()["state"] == "cancelled_local"
            assert response.json()["remote_may_continue"] == (
                payload["state"] == "running"
            )


@pytest.mark.asyncio
async def test_turn_acknowledgement_matches_actual_service(monkeypatch):
    from api.personal_service import PersonalService

    store = MemoryStore()

    async def submit(*_):
        return "command:synthetic"

    async def notebook_get(_):
        return SimpleNamespace(id="notebook:synthetic")

    service = PersonalService(store=store, submit=submit)
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    monkeypatch.setattr(evidence.Notebook, "get", notebook_get)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    fixture = json.loads((FIXTURES / "turn-submission.json").read_text())
    request = evidence.TurnRequest(**fixture["request"])
    before = await evidence.turn("chat:synthetic", request)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=fixture["request"]
        )
    assert response.status_code == 200
    assert response.json() == before == fixture["response"]


@pytest.mark.asyncio
async def test_get_serializes_dispatch_result_not_a_stale_snapshot():
    store = MemoryStore()
    await store.put(
        "job",
        "job_remote",
        {
            "job_id": "job_remote",
            "notebook_id": "notebook:synthetic",
            "provider": "notebooklm",
            "operation": "audio",
            "state": "queued",
            "submission_state": "confirmed",
            "remote_task_id": "remote:opaque",
        },
    )

    async def dispatch(job):
        await store.put(
            "job",
            job["job_id"],
            {
                **job,
                "state": "waiting_remote",
                "extension": {"dispatch_observed": True},
            },
        )

    async def read(identity):
        return await store.get("job", identity)

    service = SimpleNamespace(store=store, _dispatch=dispatch, job=read)
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = lambda: service
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/personal/jobs/job_remote")
    assert response.status_code == 200
    assert response.json() == await store.get("job", "job_remote")
    assert response.json()["state"] == "waiting_remote"
    assert response.json()["extension"] == {"dispatch_observed": True}
