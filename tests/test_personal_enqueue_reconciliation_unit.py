"""Isolated logical business units; external boundaries are synthetic."""

import asyncio
from copy import deepcopy

import pytest
from personal_enqueue_fixtures import MemoryStore

from api.personal_service import PersonalService
from open_notebook.exceptions import InvalidInputError, NotFoundError


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
