"""Durable queue recovery policy with memory storage and no remote transport."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from api import notebooklm_service as m

pytestmark = pytest.mark.asyncio
NOW = "2026-01-01T00:00:00+00:00"
FUTURE = "2026-01-01T00:01:00+00:00"


@pytest.fixture
def harness(monkeypatch):
    rows, events, held = {}, [], []

    @asynccontextmanager
    async def lock(key):
        assert not held
        held.append(key)
        events.append(("lock", key))
        try:
            yield
        finally:
            held.pop()
            events.append(("unlock", key))

    async def get(kind, identity):
        return deepcopy(rows.get((kind, identity)))

    async def put(kind, identity, value, **kwargs):
        assert held == [value["notebook_id"]]
        rows[kind, identity] = deepcopy(value)
        events.append(("save", deepcopy(value)))

    async def listing(kind, **filters):
        return [
            deepcopy(v)
            for (k, _), v in rows.items()
            if k == kind and all(v.get(f) == x for f, x in filters.items())
        ]

    async def enqueue(identity, poll=False):
        assert not held
        events.append(("enqueue", identity, poll))
        return "worker-synthetic"

    store = NS(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        list=AsyncMock(side_effect=listing),
        project_lock=lock,
    )
    queue = AsyncMock(side_effect=enqueue)
    monkeypatch.setattr(m, "now", lambda: NOW)
    monkeypatch.setattr(
        m, "later", lambda seconds: FUTURE if seconds == 60 else "lease"
    )
    service = m.NotebookLMService(
        store=store, bridge=object(), enqueue=queue, evidence=object()
    )
    return NS(
        service=service, rows=rows, events=events, held=held, store=store, queue=queue
    )


def seed(h, **changes):
    job = dict(
        job_id="job",
        provider="notebooklm",
        notebook_id="book",
        state="queued",
        submission_state="not_submitted",
        attempts=2,
        poll_attempts=3,
        dispatch_after=NOW,
        next_poll_at=NOW,
        remote_task_id=None,
        error={"code": "old"},
    )
    job.update(changes)
    h.rows["job", "job"] = deepcopy(job)
    return job


@pytest.mark.parametrize("state", ["queued", "waiting_remote"])
async def test_claim_is_saved_before_enqueue_and_ack_has_separate_lock(harness, state):
    h = harness
    job = seed(h, state=state)
    await h.service._dispatch(job)
    saved = h.rows["job", "job"]
    assert saved["dispatch_after"] == FUTURE
    assert saved["next_poll_at"] == (FUTURE if state == "waiting_remote" else NOW)
    assert saved["worker_job_id"] == "worker-synthetic" and saved["error"] is None
    assert (saved["attempts"], saved["poll_attempts"]) == (2, 3)
    assert [e[0] for e in h.events] == [
        "lock",
        "save",
        "unlock",
        "enqueue",
        "lock",
        "save",
        "unlock",
    ]
    assert h.events[1][1].get("worker_job_id") is None
    h.queue.assert_awaited_once_with("job", poll=state == "waiting_remote")
    await h.service._dispatch(job)  # stale caller cannot bypass the stored claim
    assert h.queue.await_count == 1
    assert h.store.put.await_count == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"replay_allowed": False},
        {"state": "succeeded"},
        {"state": "submission_unknown"},
        {"state": "cancelled_local"},
        {"dispatch_after": FUTURE},
        {"state": "waiting_remote", "next_poll_at": FUTURE},
    ],
)
async def test_latest_state_or_due_time_blocks_queue(harness, changes):
    h = harness
    stale = seed(h)
    h.rows["job", "job"].update(changes)
    await h.service._dispatch(stale)
    h.queue.assert_not_awaited()
    h.store.put.assert_not_awaited()


async def test_disabled_queue_does_not_access_storage(harness):
    harness.service.enqueue = None
    await harness.service._dispatch({})
    harness.store.get.assert_not_awaited()
    harness.store.put.assert_not_awaited()


@pytest.mark.parametrize("cancelled", [False, True])
async def test_queue_ack_loss_preserves_durable_claim_and_local_cancellation(
    harness, cancelled
):
    h = harness
    job = seed(h, submission_state="confirmed", remote_task_id="remote-task")

    async def lose_ack(*args, **kwargs):
        assert not h.held
        if cancelled:
            h.rows["job", "job"].update(cancel_requested=True, state="cancelled_local")
        raise RuntimeError("synthetic private transport detail")

    h.queue.side_effect = lose_ack
    await h.service._dispatch(job)
    saved = h.rows["job", "job"]
    assert saved["state"] == ("cancelled_local" if cancelled else "queued")
    assert saved["dispatch_after"] == FUTURE
    assert (
        saved["remote_task_id"] == "remote-task"
        and saved["submission_state"] == "confirmed"
    )
    assert saved["error"] == {
        "code": "WORKER_UNAVAILABLE",
        "message": "Background worker enqueue is unavailable; this saved job can resume.",
    }
    if cancelled:
        assert saved["remote_may_continue"] is True
    h.queue.assert_awaited_once()


async def test_cancelled_queue_wait_propagates_without_overwriting_claim(harness):
    h = harness
    job = seed(h)
    failure = asyncio.CancelledError()
    h.queue.side_effect = failure
    with pytest.raises(asyncio.CancelledError) as caught:
        await h.service._dispatch(job)
    assert caught.value is failure
    assert h.rows["job", "job"]["dispatch_after"] == FUTURE
    assert h.rows["job", "job"]["error"] == {"code": "old"}
    assert h.store.put.await_count == 1 and not h.held


async def test_late_success_ack_preserves_local_cancel(harness):
    h = harness
    job = seed(h, submission_state="unknown")

    async def ack(*args, **kwargs):
        h.rows["job", "job"].update(cancel_requested=True, state="cancelled_local")
        return 123

    h.queue.side_effect = ack
    await h.service._dispatch(job)
    assert h.rows["job", "job"]["state"] == "cancelled_local"
    assert h.rows["job", "job"]["remote_may_continue"] is True
    assert h.rows["job", "job"]["worker_job_id"] == "123"


@pytest.mark.parametrize(
    "submission,remote,expected,poll",
    [
        ("unknown", None, "submission_unknown", None),
        ("confirmed", "remote-task", "waiting_remote", True),
        ("confirmed", None, "queued", False),
        ("not_submitted", None, "queued", False),
    ],
)
async def test_expired_worker_recovery_never_replays_unknown_remote_intent(
    harness, submission, remote, expected, poll
):
    h = harness
    seed(
        h,
        state="running",
        submission_state=submission,
        remote_task_id=remote,
        lease_until="2025-12-31T23:59:59+00:00",
    )
    await h.service.dispatch_due_jobs()
    h.store.list.assert_awaited_once_with("job", provider="notebooklm")
    saved = h.rows["job", "job"]
    assert saved["state"] == expected
    assert saved["submission_state"] == submission and saved["remote_task_id"] == remote
    assert (saved["attempts"], saved["poll_attempts"]) == (2, 3)
    if poll is None:
        h.queue.assert_not_awaited()
        assert saved["error"]["code"] == "SUBMISSION_UNKNOWN"
    else:
        h.queue.assert_awaited_once_with("job", poll=poll)
        assert saved["dispatch_after"] == FUTURE
        if poll:
            assert saved["next_poll_at"] == FUTURE


@pytest.mark.parametrize("lease", [NOW, FUTURE])
async def test_nonexpired_worker_remains_untouched(harness, lease):
    h = harness
    before = seed(h, state="running", submission_state="unknown", lease_until=lease)
    await h.service.dispatch_due_jobs()
    assert h.rows["job", "job"] == before
    h.queue.assert_not_awaited()
    h.store.put.assert_not_awaited()


async def test_ticker_ignores_other_provider_and_does_not_dispatch_cancelled_recovery(
    harness,
):
    h = harness
    seed(
        h,
        state="running",
        submission_state="confirmed",
        remote_task_id="remote-task",
        cancel_requested=True,
        lease_until="",
    )
    h.rows["job", "foreign"] = dict(
        h.rows["job", "job"], job_id="foreign", provider="local"
    )
    foreign = deepcopy(h.rows["job", "foreign"])
    await h.service.dispatch_due_jobs()
    assert h.rows["job", "job"]["state"] == "cancelled_local"
    assert h.rows["job", "job"]["remote_may_continue"] is True
    assert h.rows["job", "foreign"] == foreign
    h.queue.assert_not_awaited()
