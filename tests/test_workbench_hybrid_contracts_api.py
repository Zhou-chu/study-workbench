"""Actual ASGI search, job/events and turn routes over a disposable hybrid index."""

import json
from types import SimpleNamespace

import pytest
from hybrid_contracts_fixtures import h as _h
from hybrid_contracts_fixtures import hybrid
from test_workbench_hybrid_retrieval import NB

from api.personal_service import PersonalService
from api.routers import evidence as routes
from open_notebook.graphs.grounded_chat import GroundedChatService

h = _h


@pytest.mark.asyncio
async def test_http_search_retains_metadata_and_explicit_lexical_has_no_embeddings(h):
    import httpx
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        body = {
            "notebook_id": NB,
            "query": "electricity",
            "source_version_ids": ["v1"],
            "retrieval_mode": "lexical",
        }
        response = await client.post("/api/personal/search", json=body)
        assert response.status_code == 200
        assert response.json()["retrieval"]["retrieval_method"] == "lexical"
        bad = hybrid(h)
        bad.pop("disclosed_profile_fingerprint")
        assert (await client.post("/api/personal/search", json=bad)).status_code == 422
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_fallback_and_pinned_disclosure_survive_actual_job_and_events_response(
    h, monkeypatch
):
    from types import SimpleNamespace

    import httpx
    from fastapi import FastAPI

    from api.routers import notebooklm

    h.enabled = False

    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    body = hybrid(h, message="electricity")
    turn = await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(NB, "wire", body)
    job = {
        "job_id": "job",
        "notebook_id": NB,
        "turn_id": turn["turn_id"],
        "operation": "chat",
        "state": "succeeded",
        "result": turn,
    }
    await h.store.put("job", "job", job)
    monkeypatch.setattr(routes, "get_store", lambda: h.store)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.include_router(notebooklm.router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = (
        lambda: SimpleNamespace(store=h.store)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/personal/jobs/job")
        assert response.status_code == 200
        assert response.json()["result"]["retrieval"] == turn["retrieval"]
        assert (
            response.json()["result"]["retrieval_request"] == turn["retrieval_request"]
        )
        response = await client.get(f"/api/personal/turns/{turn['turn_id']}/events")
        assert "event: final" in response.text
        payload = json.loads(response.text.split("data: ", 1)[1])
        assert payload["retrieval_request"] == turn["retrieval_request"]
        assert payload["retrieval"]["retrieval_method"] == "lexical_fallback"
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_frontend_serialized_turn_dtos_reach_actual_route(
    h, monkeypatch, enabled
):
    from pathlib import Path

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    fixture = json.loads(
        Path("contracts/v1/fixtures/hybrid-turn-requests.json").read_text()
    )
    assert fixture["profile"] == h.provider.profile.model_dump(mode="json")
    h.enabled = enabled

    async def exists(identity):
        return SimpleNamespace(id=identity)

    monkeypatch.setattr(routes.Notebook, "get", exists)
    monkeypatch.setattr(routes, "EvidenceService", lambda: h.evidence)
    queued = []

    async def enqueue(command, args):
        queued.append((command, args))
        return "command:offline"

    personal = PersonalService(store=h.store, submit=enqueue)
    monkeypatch.setattr(routes, "PersonalService", lambda: personal)
    app = FastAPI()
    app.include_router(routes.router)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://offline.test"
    ) as client:
        for name, body in fixture["cases"].items():
            body = {**body, "idempotency_key": name}
            response = await client.post(
                "/personal/chats/session:wire/turns", json=body
            )
            assert response.status_code == 200, response.text
            request = routes.TurnRequest(**body).dispatch_payload()
            receipt = await personal.turn_receipt("session:wire", request)
            assert receipt["state"] == "queued"
            assert receipt["request_snapshot"] == request
        for name in ["remote_question", "remote_outline", "local_outline"]:
            body = {
                **fixture["cases"]["local_hybrid"],
                **fixture["cases"][name],
                "retrieval_mode": "hybrid",
                "idempotency_key": "invalid_" + name,
            }
            response = await client.post(
                "/personal/chats/session:wire/turns", json=body
            )
            assert response.status_code == 422
    assert len(queued) == len(fixture["cases"])
    assert h.provider.calls == []
