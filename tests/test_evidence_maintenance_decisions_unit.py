"""Durable maintenance decisions; storage, queue and extraction are external doubles."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.evidence_maintenance import EvidenceMaintenanceService
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    monkeypatch.setenv("STUDY_WORKBENCH_EXTRACT_TIMEOUT_SECONDS", "30")
    job: dict[str, object] = {
        "job_id": "job_one",
        "notebook_id": "notebook:one",
        "source_version_id": "sv_one",
        "operation": "reparse",
        "extraction_id": "ex_old",
        "fresh_extraction_id": "ex_fresh",
        "state": "queued",
        "attempts": 2,
        "next_dispatch_at": "2000-01-01T00:00:00+00:00",
    }
    rows = {"job_one": job}
    events: list[str] = []

    @asynccontextmanager
    async def lock(identity: str):
        events.append("lock:" + identity)
        try:
            yield
        finally:
            events.append("unlock:" + identity)

    async def get(kind: str, identity: str):
        assert kind == "job"
        return deepcopy(rows.get(identity))

    async def put(kind: str, identity: str, value: dict[str, object]):
        assert kind == "job"
        rows[identity] = deepcopy(value)
        events.append("put:" + str(value["state"]))

    store = SimpleNamespace(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        project_lock=lock,
    )
    version = {
        "notebook_id": "notebook:one",
        "original_status": "available",
        "origin": "upload",
    }
    evidence = SimpleNamespace(
        store=store,
        _version=AsyncMock(return_value=version),
        extract=AsyncMock(
            return_value={
                "status": "ready",
                "extraction_id": "ex_fresh",
                "evidence_ids": ["e1", "e2"],
            }
        ),
        revalidate=AsyncMock(return_value={"verified_count": 2}),
    )
    enqueue = AsyncMock(return_value="worker_one")
    return SimpleNamespace(
        service=EvidenceMaintenanceService(evidence, enqueue),
        rows=rows,
        job=job,
        events=events,
        store=store,
        evidence=evidence,
        version=version,
        enqueue=enqueue,
    )


def no_processing(s: SimpleNamespace) -> None:
    s.evidence.extract.assert_not_awaited()
    s.evidence.revalidate.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["run", "dispatch"])
async def test_missing_job_raises_and_releases_lock(
    setup: SimpleNamespace, method: str
) -> None:
    s = setup
    s.rows.clear()
    with pytest.raises(NotFoundError, match="Maintenance job not found"):
        await getattr(s.service, method)("job_one")
    assert s.events == [
        f"lock:maintenance-{method}:job_one",
        f"unlock:maintenance-{method}:job_one",
    ]
    s.store.put.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["succeeded", "failed", "cancelled_local"])
async def test_terminal_jobs_neither_dispatch_nor_run(
    setup: SimpleNamespace, state: str
) -> None:
    s = setup
    s.job["state"] = state
    expected = deepcopy(s.job)
    assert await s.service.dispatch("job_one") == expected
    assert await s.service.run("job_one") == expected
    s.enqueue.assert_not_awaited()
    s.store.put.assert_not_awaited()
    s.evidence._version.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "flag,value", [("restored_history", True), ("replay_allowed", False)]
)
async def test_history_never_replays_and_run_marks_local_cancellation(
    setup: SimpleNamespace, flag: str, value: bool
) -> None:
    s = setup
    s.job[flag] = value
    assert (await s.service.dispatch("job_one"))["state"] == "queued"
    result = await s.service.run("job_one")
    assert result["state"] == "cancelled_local"
    assert result["cancel_requested"] is True and result["remote_may_continue"] is False
    s.enqueue.assert_not_awaited()
    s.evidence._version.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
async def test_unknown_operation_cannot_execute_or_dispatch(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.job["operation"] = "other"
    assert await s.service.dispatch("job_one") == s.job
    with pytest.raises(InvalidInputError, match="INVALID_MAINTENANCE_OPERATION"):
        await s.service.run("job_one")
    s.store.put.assert_not_awaited()
    s.enqueue.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
async def test_future_dispatch_does_not_enqueue_or_write(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.job["next_dispatch_at"] = "2999-01-01T00:00:00+00:00"
    assert await s.service.dispatch("job_one") == s.job
    s.store.put.assert_not_awaited()
    s.enqueue.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["queued", "running"])
async def test_recovery_keeps_job_identity_and_sets_real_future_lease(
    setup: SimpleNamespace, state: str
) -> None:
    s = setup
    s.job["state"] = state
    before = datetime.now(timezone.utc)
    result = await s.service.dispatch("job_one")
    after = datetime.now(timezone.utc)
    lease = datetime.fromisoformat(result["next_dispatch_at"])
    assert 90 <= (lease - before).total_seconds()
    assert (lease - after).total_seconds() <= 90
    assert result["job_id"] == "job_one" and result["fresh_extraction_id"] == "ex_fresh"
    assert result["state"] == state and result["attempts"] == 2
    assert result["worker_job_id"] == "worker_one" and result["recovery_error"] is None
    s.enqueue.assert_awaited_once_with("maintain_evidence", {"job_id": "job_one"})
    await s.service.dispatch("job_one")
    assert s.enqueue.await_count == 1
    no_processing(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("fails", [False, True])
async def test_enqueue_race_keeps_worker_terminal_result(
    setup: SimpleNamespace, fails: bool
) -> None:
    s = setup

    async def enqueue(*args):
        s.rows["job_one"].update(state="succeeded", result={"preserved": True})
        if fails:
            raise OSError("sensitive backend details")
        return "worker_one"

    s.enqueue.side_effect = enqueue
    result = await s.service.dispatch("job_one")
    assert result["state"] == "succeeded" and result["result"] == {"preserved": True}
    assert "sensitive" not in repr(result)
    if fails:
        assert (
            result["recovery_error"]
            == "Worker unavailable; the existing task will be checked again without creating a new operation"
        )
    else:
        assert result["worker_job_id"] == "worker_one"


@pytest.mark.asyncio
async def test_dispatch_rereads_terminal_state_inside_project_lock(
    setup: SimpleNamespace,
) -> None:
    s = setup
    terminal = {**s.job, "state": "failed"}
    s.store.get.side_effect = [deepcopy(s.job), terminal]
    assert await s.service.dispatch("job_one") == terminal
    s.store.put.assert_not_awaited()
    s.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_foreign_version_rejected_before_marking_running(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.version["notebook_id"] = "foreign"
    with pytest.raises(InvalidInputError, match="SOURCE_OUT_OF_SCOPE"):
        await s.service.run("job_one")
    s.store.put.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
async def test_cancel_request_seen_on_locked_reread_skips_processing(
    setup: SimpleNamespace,
) -> None:
    s = setup
    cancelled = {**s.job, "cancel_requested": True}
    s.store.get.side_effect = [deepcopy(s.job), cancelled]
    assert await s.service.run("job_one") == cancelled
    s.store.put.assert_not_awaited()
    no_processing(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["reparse", "revalidate"])
async def test_success_records_original_extraction_identity_and_attempt(
    setup: SimpleNamespace, operation: str
) -> None:
    s = setup
    s.job["operation"] = operation
    result = await s.service.run("job_one")
    assert result["state"] == "succeeded" and result["attempts"] == 3
    assert result["started_at"] <= result["completed_at"]
    if operation == "revalidate":
        s.evidence.revalidate.assert_awaited_once_with("sv_one", "ex_old", "ex_fresh")
        assert result["result"] == {"verified_count": 2}
        s.evidence.extract.assert_not_awaited()
    else:
        s.evidence.extract.assert_awaited_once_with("sv_one", extraction_id="ex_fresh")
        assert result["result"] == {
            "source_version_id": "sv_one",
            "extraction_id": "ex_fresh",
            "status": "ready",
            "evidence_count": 2,
        }
        s.evidence.revalidate.assert_not_awaited()
    assert [c.args[2]["state"] for c in s.store.put.await_args_list] == [
        "running",
        "succeeded",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reason", ["missing_original", "remote", "failed_parse", "revalidate_error"]
)
async def test_failures_are_sanitized_not_success(
    setup: SimpleNamespace, reason: str
) -> None:
    s = setup
    if reason == "missing_original":
        s.version["original_status"] = "missing"
    elif reason == "remote":
        s.version["origin"] = "remote_text_snapshot"
    elif reason == "failed_parse":
        s.evidence.extract.return_value = {"status": "failed"}
    else:
        s.job["operation"] = "revalidate"
        s.evidence.revalidate.side_effect = OSError("secret backend details")
    result = await s.service.run("job_one")
    assert result["state"] == "failed" and "result" not in result
    assert result["error"] == {
        "code": "EVIDENCE_MAINTENANCE_FAILED",
        "message": "Evidence maintenance could not be completed.",
    }
    assert "secret" not in repr(result)
    if reason in {"missing_original", "remote"}:
        no_processing(s)


@pytest.mark.asyncio
async def test_retained_web_markdown_can_be_reparsed_without_original_html(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.version.update(
        origin="web_snapshot",
        original_status="missing",
        mime_type="text/markdown",
        file_path="retained.md",
    )
    assert (await s.service.run("job_one"))["state"] == "succeeded"
    s.evidence.extract.assert_awaited_once_with("sv_one", extraction_id="ex_fresh")


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["run", "dispatch"])
async def test_cancelled_boundary_preserves_exception_and_recovery_state(
    setup: SimpleNamespace, method: str
) -> None:
    s = setup
    error = asyncio.CancelledError("cancelled")
    target = s.evidence.extract if method == "run" else s.enqueue
    target.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await getattr(s.service, method)("job_one")
    assert caught.value is error
    assert s.rows["job_one"]["state"] == ("running" if method == "run" else "queued")
    assert "error" not in s.rows["job_one"]
    assert s.events[-1] == f"unlock:maintenance-{method}:job_one"
    assert sorted(e[5:] for e in s.events if e.startswith("lock:")) == sorted(
        e[7:] for e in s.events if e.startswith("unlock:")
    )
