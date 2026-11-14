"""Queue ACK failures must not replace newer durable personal job records."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from api.personal_service import PersonalService
from open_notebook.exceptions import InvalidInputError, NotFoundError


class MemoryStore:
    """Local-only store double with independent snapshots and real exclusion."""

    def __init__(self):
        self.data = {}
        self.writes = []
        self.locks = {}
        self.lock_waiting = asyncio.Event()

    async def get(self, kind, identity):
        return deepcopy(self.data.get((kind, identity)))

    async def put(self, kind, identity, value, create_only=False):
        key = (kind, identity)
        if create_only and key in self.data:
            raise ValueError("Record already exists")
        self.data[key] = deepcopy(value)
        self.writes.append((key, deepcopy(value), create_only))
        return deepcopy(value)

    async def delete(self, kind, identity):
        self.data.pop((kind, identity), None)

    @asynccontextmanager
    async def project_lock(self, notebook_id):
        lock = self.locks.setdefault(notebook_id, asyncio.Lock())
        if lock.locked():
            self.lock_waiting.set()
        async with lock:
            yield


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
async def test_store_snapshots_and_create_only_are_independent():
    store = MemoryStore()
    initial = {"nested": {"values": ["original"]}}
    returned = await store.put("job", "job:synthetic", initial, create_only=True)
    initial["nested"]["values"].append("caller mutation")
    returned["nested"]["values"].append("return mutation")
    read = await store.get("job", "job:synthetic")
    read["nested"]["values"].append("reader mutation")
    with pytest.raises(ValueError, match="Record already exists"):
        await store.put("job", "job:synthetic", {"replacement": True}, create_only=True)
    assert await store.get("job", "job:synthetic") == {
        "nested": {"values": ["original"]}
    }
    assert len(store.writes) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state",
    [
        "succeeded",
        "running",
        "cancelled_local",
        "submission_unknown",
        "failed",
        "future_worker_state",
        "queued",  # Metadata can advance without changing the state string.
    ],
)
async def test_enqueue_error_preserves_advanced_job(state, request_payload):
    store = MemoryStore()
    submitted = []
    expected = None

    async def submit(command, args):
        nonlocal expected
        submitted.append((command, deepcopy(args)))
        async with store.project_lock(request_payload["notebook_id"]):
            latest = await store.get("job", args["job_id"])
            latest.update(
                state=state,
                result={"turn_id": "turn:finished", "answer": "Retained answer"},
                attempts=3,
                worker_job_id="command:accepted",
                submission_state="unknown",
                cancel_requested=True,
                remote_may_continue=True,
                error={"code": "RETAINED", "message": "Existing worker diagnostic"},
                extension={"opaque": [None, {"retained": "unchanged"}]},
            )
            await store.put("job", args["job_id"], latest)
            expected = deepcopy(latest)
        raise TimeoutError("Synthetic queue ACK lost")

    service = PersonalService(store, submit)
    result = await service.submit_turn("chat:synthetic", request_payload)
    assert result == expected
    assert await store.get("job", result["job_id"]) == expected
    assert (
        len(store.writes) == 2
    )  # Initial CREATE and worker write, no reconciliation write.
    assert await service.submit_turn("chat:synthetic", request_payload) == expected
    assert submitted == [("personal_turn", {"job_id": result["job_id"]})]
    assert len(store.writes) == 2


@pytest.mark.asyncio
async def test_enqueue_failure_rereads_after_project_lock(request_payload):
    store = MemoryStore()
    enqueue_started = asyncio.Event()
    fail_enqueue = asyncio.Event()
    identity = None

    async def submit(command, args):
        nonlocal identity
        identity = args["job_id"]
        enqueue_started.set()
        await fail_enqueue.wait()
        raise TimeoutError("Synthetic queue ACK lost")

    service = PersonalService(store, submit)
    submission = asyncio.create_task(
        service.submit_turn("chat:synthetic", request_payload)
    )
    waiting = asyncio.create_task(store.lock_waiting.wait())
    try:
        await asyncio.wait_for(enqueue_started.wait(), timeout=5)
        async with store.project_lock(request_payload["notebook_id"]):
            running = await store.get("job", identity)
            running.update(
                state="running", attempts=1, worker_job_id="command:accepted"
            )
            await store.put("job", identity, running)
            fail_enqueue.set()
            done, _ = await asyncio.wait(
                {submission, waiting}, timeout=5, return_when=asyncio.FIRST_COMPLETED
            )
            assert waiting in done, "enqueue failure must wait for the project lock"
            assert not submission.done()
            # Advance again after the exception handler is waiting: a pre-lock
            # read would incorrectly return the earlier running snapshot.
            expected = {
                **running,
                "state": "cancelled_local",
                "cancel_requested": True,
                "remote_may_continue": True,
                "extension": {"written_while_reconciliation_waited": True},
            }
            await store.put("job", identity, expected)
        assert await asyncio.wait_for(submission, timeout=5) == expected
        assert await store.get("job", identity) == expected
        assert len(store.writes) == 3
    finally:
        for task in (submission, waiting):
            if not task.done():
                task.cancel()
        await asyncio.gather(submission, waiting, return_exceptions=True)


@pytest.mark.asyncio
async def test_enqueue_failure_does_not_recreate_deleted_job(request_payload):
    store = MemoryStore()

    async def submit(command, args):
        async with store.project_lock(request_payload["notebook_id"]):
            await store.delete("job", args["job_id"])
        raise TimeoutError("Synthetic queue ACK lost after deletion")

    with pytest.raises(NotFoundError, match="Job not found"):
        await PersonalService(store, submit).submit_turn(
            "chat:synthetic", request_payload
        )
    assert store.data == {}
    assert len(store.writes) == 1


@pytest.mark.asyncio
async def test_unadvanced_enqueue_error_keeps_existing_failure_contract(
    request_payload,
):
    store = MemoryStore()
    failure = TimeoutError("Synthetic queue unavailable")

    async def submit(command, args):
        raise failure

    with pytest.raises(InvalidInputError, match="^WORKER_UNAVAILABLE$") as raised:
        await PersonalService(store, submit).submit_turn(
            "chat:synthetic", request_payload
        )
    assert raised.value.__cause__ is failure
    initial = store.writes[0][1]
    assert type(raised.value).__name__ == "PersonalTurnDispatchUnknownError"
    assert getattr(raised.value, "job_id", None) == initial["job_id"]
    assert getattr(raised.value, "turn_id", None) == initial["turn_id"]
    persisted = await store.get("job", initial["job_id"])
    assert persisted == {
        **initial,
        "state": "failed",
        "error": {
            "code": "WORKER_UNAVAILABLE",
            "message": "Could not enqueue answer; worker/database availability must be checked",
        },
        "dispatch_receipt": {
            "dispatch_ack": "unknown",
            "job_id": initial["job_id"],
            "turn_id": initial["turn_id"],
            "retry_safe": False,
        },
    }
    assert persisted["submission_state"] == "not_submitted"
    assert len(store.writes) == 2


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
