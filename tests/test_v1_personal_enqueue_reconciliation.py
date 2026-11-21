"""Queue ACK failures must not replace newer durable personal job records."""

from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from personal_enqueue_fixtures import MemoryStore

from api.personal_service import PersonalService
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def request_payload():
    return {
        "notebook_id": "notebook:synthetic",
        "engine": "independent",
        "message": "A synthetic question",
        "source_version_ids": [],
        "idempotency_key": "same-operation",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("acceptance_observed", [False, True])
async def test_unchanged_queued_ack_loss_reports_unknown_without_reenqueue(
    monkeypatch, request_payload, acceptance_observed
):
    """Acceptance without a durable update is indistinguishable from rejection.

    This preserves the existing 400/failed policy, not reliable queue recovery.
    Dispatch ACK uncertainty must not be relabeled as provider submission_unknown.
    """
    from api.main import invalid_input_error_handler
    from api.routers import evidence

    store = MemoryStore()
    submitted = []
    accepted = []

    async def submit(command, args):
        submitted.append((command, deepcopy(args)))
        if acceptance_observed:
            accepted.append(deepcopy(args))  # Accepted, but worker has not started.
        raise TimeoutError("SYNTHETIC_PRIVATE_QUEUE_CAUSE_DO_NOT_EXPOSE")

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    service = PersonalService(store, submit)
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    monkeypatch.setattr(evidence.Notebook, "get", notebook_get)
    app = FastAPI()
    app.exception_handler(InvalidInputError)(invalid_input_error_handler)
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=request_payload
        )
        assert response.status_code == 400
        initial = store.writes[0][1]
        receipt = {
            "dispatch_ack": "unknown",
            "job_id": initial["job_id"],
            "turn_id": initial["turn_id"],
            "retry_safe": False,
        }
        assert response.json() == {
            "detail": "WORKER_UNAVAILABLE",
            "dispatch_receipt": receipt,
        }
        assert "SYNTHETIC_PRIVATE" not in response.text
        persisted = await store.get("job", initial["job_id"])
        assert persisted["dispatch_receipt"] == receipt
        assert persisted["state"] == "failed"
        assert persisted["submission_state"] == "not_submitted"
        assert persisted["attempts"] == 0
        repeated = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=request_payload
        )
        changed = await client.post(
            "/api/personal/chats/chat:synthetic/turns",
            json={**request_payload, "message": "A changed synthetic question"},
        )
    assert repeated.status_code == 200
    assert repeated.json() == {
        "job_id": persisted["job_id"],
        "turn_id": persisted["turn_id"],
        "state": "failed",
        "dispatch_receipt": receipt,
    }
    assert changed.status_code == 400
    assert changed.json() == {"detail": "IDEMPOTENCY_CONFLICT"}
    assert submitted == [("personal_turn", {"job_id": persisted["job_id"]})]
    assert len(accepted) == int(acceptance_observed)
    assert await service.run_turn(persisted["job_id"]) == persisted
    assert await store.get("job", persisted["job_id"]) == persisted
    assert len(store.writes) == 2
