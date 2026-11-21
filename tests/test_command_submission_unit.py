"""Direct bridge units; fake DB and registry boundary."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from command_submission_fixtures import Input, submit
from surrealdb import RecordID

from open_notebook.exceptions import CommandSubmissionUnknownError
from open_notebook.utils import command_submission as bridge


@pytest.fixture
def backend(monkeypatch):
    db = SimpleNamespace(
        signin=AsyncMock(),
        use=AsyncMock(),
        create=AsyncMock(return_value={"id": RecordID("command", "fixture")}),
        close=AsyncMock(),
    )
    monkeypatch.setattr(bridge, "AsyncSurreal", lambda _: db)
    monkeypatch.setattr(
        bridge.registry,
        "get_command_by_id",
        lambda _: SimpleNamespace(input_schema=Input),
    )
    return db


@pytest.mark.asyncio
async def test_heartbeat_while_create_waits(backend):
    entered, release = asyncio.Event(), asyncio.Event()

    async def create(*args):
        entered.set()
        await release.wait()
        return {"id": "command:once"}

    backend.create.side_effect = create
    task = asyncio.create_task(submit())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        assert await asyncio.sleep(0, result="heartbeat") == "heartbeat"
        assert not task.done()
    finally:
        release.set()
    assert await task == "command:once"
    backend.create.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["signin", "use", "create"])
async def test_errors_preserve_identity_stage_and_do_not_retry(backend, stage):
    error = ConnectionError("fixture")
    getattr(backend, stage).side_effect = error
    backend.close.side_effect = RuntimeError("cleanup must not mask primary")
    with pytest.raises(
        CommandSubmissionUnknownError if stage == "create" else ConnectionError
    ) as caught:
        await submit()
    assert (caught.value.__cause__ if stage == "create" else caught.value) is error
    assert ("outcome may be unknown" in error.__notes__[0]) == (stage == "create")
    assert backend.create.await_count == (1 if stage == "create" else 0)
    backend.close.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["signin", "create"])
async def test_cancellation_does_not_claim_rollback_or_repeat(backend, stage):
    entered = asyncio.Event()

    async def block(*args):
        entered.set()
        await asyncio.Event().wait()

    getattr(backend, stage).side_effect = block
    task = asyncio.create_task(submit())
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError) as caught:
        await task
    assert ("outcome may be unknown" in caught.value.__notes__[0]) == (
        stage == "create"
    )
    backend.close.assert_awaited_once()
    assert backend.create.await_count == (1 if stage == "create" else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["signin", "create"])
async def test_deadline_before_and_after_create(backend, monkeypatch, stage):
    # Fire the real asyncio timeout deterministically at the controlled stage.
    original_timeout = asyncio.timeout
    scope = original_timeout(None)
    calls = 0

    def controlled_timeout(delay):
        nonlocal calls
        calls += 1
        return scope if calls == 2 else original_timeout(None)

    monkeypatch.setattr(bridge.asyncio, "timeout", controlled_timeout)

    async def expire(*args):
        scope.reschedule(asyncio.get_running_loop().time())
        await asyncio.Event().wait()

    getattr(backend, stage).side_effect = expire
    with pytest.raises(
        CommandSubmissionUnknownError if stage == "create" else TimeoutError
    ) as caught:
        await submit()
    primary = caught.value.__cause__ if stage == "create" else caught.value
    assert primary is not None
    assert ("outcome may be unknown" in primary.__notes__[0]) == (stage == "create")
    backend.close.assert_awaited_once()
    assert backend.create.await_count == (1 if stage == "create" else 0)


@pytest.mark.asyncio
async def test_bounded_admission_cancel_and_timeout_never_dispatch(
    backend, monkeypatch
):
    monkeypatch.setattr(bridge, "MAX_IN_FLIGHT", 1)
    entered, release = asyncio.Event(), asyncio.Event()

    async def create(*args):
        entered.set()
        await release.wait()
        return {"id": "command:once"}

    backend.create.side_effect = create
    first = asyncio.create_task(submit())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        second = asyncio.create_task(submit())
        await asyncio.sleep(0)
        assert not second.done()
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second
        monkeypatch.setattr(bridge, "ADMISSION_TIMEOUT", 0)
        with pytest.raises(TimeoutError):
            await submit()
        backend.signin.assert_awaited_once()
        backend.create.assert_awaited_once()
    finally:
        release.set()
        await first
    monkeypatch.setattr(bridge, "ADMISSION_TIMEOUT", 10)
    assert await submit() == "command:once"


@pytest.mark.asyncio
async def test_cleanup_is_bounded_and_does_not_mask_primary(backend, monkeypatch):
    monkeypatch.setattr(bridge, "CLEANUP_TIMEOUT", 0)

    async def stuck():
        await asyncio.Event().wait()

    backend.close.side_effect = stuck
    error = ConnectionError("primary")
    backend.create.side_effect = error
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await submit()
    assert caught.value.__cause__ is error
    backend.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_cleanup_failure_preserves_acknowledged_id(backend):
    error = RuntimeError("cleanup")
    backend.close.side_effect = error
    assert await submit() is backend.create.return_value["id"]
    backend.create.assert_awaited_once()


def test_fresh_loops_have_independent_lifetimes(backend):
    loops = []

    async def create(table, payload):
        loops.append(asyncio.get_running_loop())
        return {"id": RecordID("command", f"fixture-{len(loops)}")}

    backend.create.side_effect = create
    assert asyncio.run(submit()) == RecordID("command", "fixture-1")
    assert asyncio.run(submit()) == RecordID("command", "fixture-2")
    assert len(loops) == 2 and loops[0] is not loops[1]
    assert all(loop.is_closed() for loop in loops)
    assert backend.close.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["vectorize", "add_insight"])
async def test_source_preserves_unknown_outcome(monkeypatch, operation):
    from open_notebook.domain.notebook import Source

    error = CommandSubmissionUnknownError()
    mocked = AsyncMock(side_effect=error)
    monkeypatch.setattr("open_notebook.domain.notebook.submit_command", mocked)
    source = Source(id="source:fixture", full_text="content")
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        if operation == "vectorize":
            await source.vectorize()
        else:
            await source.add_insight("summary", "content")
    assert caught.value is error
    mocked.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [None, {}, [], "malformed"])
async def test_missing_create_acknowledgement_is_unknown(backend, result):
    backend.create.return_value = result
    with pytest.raises(CommandSubmissionUnknownError):
        await submit()
    backend.create.assert_awaited_once()
    backend.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_validation_failure_never_dispatches(backend, monkeypatch):
    monkeypatch.setattr(bridge.registry, "get_command_by_id", lambda _: None)
    with pytest.raises(ValueError, match="Command not found"):
        await submit()
    backend.create.assert_not_called()
    backend.close.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "identity",
    [
        None,
        "",
        123,
        {},
        "note:wrong",
        "command:",
        RecordID("note", "wrong"),
        RecordID("command", ""),
    ],
)
async def test_invalid_receipt_identity_is_unknown(backend, identity):
    backend.create.return_value = {"id": identity}
    with pytest.raises(CommandSubmissionUnknownError):
        await submit()
    backend.create.assert_awaited_once()


@pytest.mark.asyncio
async def test_new_cancellation_during_cleanup_replaces_primary_failure(backend):
    backend.signin.side_effect = ConnectionError("signin")
    closing = asyncio.Event()

    async def close():
        closing.set()
        await asyncio.Event().wait()

    backend.close.side_effect = close
    task = asyncio.create_task(submit())
    await asyncio.wait_for(closing.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()
    backend.create.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "identity",
    [
        RecordID("command", "fixture"),
        RecordID("command", 123),
        "command:fixture",
        "command:123",
        "command:⟨fixture-with-dashes⟩",
    ],
)
async def test_valid_command_receipt_preserved_despite_cleanup_failure(
    backend, identity
):
    backend.create.return_value = {"id": identity}
    backend.close.side_effect = RuntimeError("do not log this fixture detail")
    assert await submit() is identity
    backend.create.assert_awaited_once()


@pytest.mark.asyncio
async def test_cleanup_deadline_preserves_acknowledged_id(backend, monkeypatch):
    monkeypatch.setattr(bridge, "CLEANUP_TIMEOUT", 0)

    async def stuck():
        await asyncio.Event().wait()

    backend.close.side_effect = stuck
    assert await submit() is backend.create.return_value["id"]
    backend.close.assert_awaited_once()
