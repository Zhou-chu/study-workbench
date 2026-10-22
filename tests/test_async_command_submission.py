"""Native async submission verification: no database, network or providers."""

import asyncio
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from enum import Enum
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel
from surrealdb import RecordID

from open_notebook.exceptions import CommandSubmissionUnknownError
from open_notebook.utils import command_submission as bridge


class Choice(Enum):
    FIRST = "first"


class Input(BaseModel):
    when: datetime
    choice: Choice


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


def submit():
    return bridge.submit_command(
        "app",
        "name",
        {"when": datetime(2026, 10, 22, tzinfo=timezone.utc), "choice": Choice.FIRST},
        context={"trace": "fixture", "nested": {"values": [1, None]}},
    )


@pytest.mark.asyncio
async def test_exact_locked_sdk_json_wire_and_id_parity(backend, monkeypatch):
    import importlib

    from surreal_commands import submit_command

    sdk = importlib.import_module("surreal_commands.core.service")
    writes = []

    class FakeSyncDB:
        def __init__(self, url):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def signin(self, auth):
            pass

        def use(self, namespace, database):
            pass

        def create(self, table, data):
            writes.append((table, data))
            return backend.create.return_value

    monkeypatch.setattr(sdk, "Surreal", FakeSyncDB)
    baseline = submit_command(
        "app",
        "name",
        {"when": datetime(2026, 10, 22, tzinfo=timezone.utc), "choice": Choice.FIRST},
        context={"trace": "fixture", "nested": {"values": [1, None]}},
    )
    assert await submit() is baseline
    backend.create.assert_awaited_once_with(*writes[0])
    assert writes[0][1]["args"] == {"when": "2026-10-22T00:00:00Z", "choice": "first"}
    backend.close.assert_awaited_once()


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
    assert asyncio.run(submit()) == asyncio.run(submit())
    assert backend.create.await_count == 2


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
@pytest.mark.parametrize(
    "command", ["process_source", "run_transformation", "create_insight"]
)
async def test_real_sdk_retry_predicate_never_replays_unknown_create(backend, command):
    from surreal_commands import registry
    from surreal_commands.core.retry import build_async_retry_instance

    import commands  # noqa: F401

    # backend patches lookup for schema validation; obtain command via registry list.
    item = next(item for item in registry.get_all_commands() if item.name == command)
    config = item.retry_config.model_copy(
        update={"wait_strategy": "fixed", "wait_time": 0, "wait_min": 0, "wait_max": 0}
    )
    backend.create.side_effect = ConnectionError("lost acknowledgement")
    with pytest.raises(CommandSubmissionUnknownError):
        async for attempt in build_async_retry_instance(config):
            with attempt:
                await submit()
    backend.create.assert_awaited_once()


@pytest.mark.asyncio
async def test_note_commit_and_command_service_remain_responsive(backend, monkeypatch):
    from api.command_service import CommandService
    from open_notebook.database.note_repository import NoteWriteResult
    from open_notebook.domain.notebook import Note

    class AnyInput(BaseModel):
        note_id: str | None = None

    monkeypatch.setattr(
        bridge.registry,
        "get_command_by_id",
        lambda _: SimpleNamespace(input_schema=AnyInput),
    )
    committed = []

    async def commit(**kwargs):
        committed.append(True)
        return NoteWriteResult(
            native={"id": "note:fixture", "content": "body", "revision": 2},
            snapshot=None,
        )

    monkeypatch.setattr("open_notebook.database.note_repository.update_note", commit)
    actions: list[Callable[[], Coroutine[Any, Any, Any]]] = [
        Note(id="note:fixture", content="body").save,
        lambda: CommandService.submit_command_job(
            "app", "name", {}, context={"trace": "kept"}
        ),
    ]
    for action in actions:
        entered, release = asyncio.Event(), asyncio.Event()

        async def create(*args):
            entered.set()
            await release.wait()
            return {"id": "command:fixture"}

        backend.create.side_effect = create
        task = asyncio.create_task(action())
        try:
            await asyncio.wait_for(entered.wait(), 1)
            assert await asyncio.sleep(0, result="alive") == "alive"
            assert not task.done()
        finally:
            release.set()
        assert await task == "command:fixture"
    assert committed == [True]
    assert backend.create.call_args.args[1]["context"] == {"trace": "kept"}


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
    "command", ["process_source", "run_transformation", "create_insight"]
)
@pytest.mark.parametrize("failure", ["invalid_receipt", "cancelled"])
async def test_real_sdk_does_not_replay_invalid_receipt_or_cancellation(
    backend, command, failure
):
    from surreal_commands import registry
    from surreal_commands.core.retry import build_async_retry_instance

    import commands  # noqa: F401

    item = next(item for item in registry.get_all_commands() if item.name == command)
    config = item.retry_config.model_copy(
        update={
            "max_attempts": 2,
            "wait_strategy": "fixed",
            "wait_time": 0,
            "wait_min": 0,
            "wait_max": 0,
        }
    )
    if failure == "cancelled":
        backend.create.side_effect = asyncio.CancelledError()
    else:
        backend.create.return_value = {"id": None}
    expected = (
        asyncio.CancelledError
        if failure == "cancelled"
        else CommandSubmissionUnknownError
    )
    with pytest.raises(expected):
        async for attempt in build_async_retry_instance(config):
            with attempt:
                await submit()
    backend.create.assert_awaited_once()


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


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["success", "signin", "create"])
async def test_external_cleanup_cancellation_does_not_replay_real_sdk_attempt(
    backend, stage
):
    from surreal_commands import registry
    from surreal_commands.core.retry import build_async_retry_instance

    import commands  # noqa: F401

    if stage != "success":
        getattr(backend, stage).side_effect = ConnectionError("primary")
    closing = asyncio.Event()

    async def close():
        closing.set()
        await asyncio.Event().wait()

    backend.close.side_effect = close
    item = next(
        item for item in registry.get_all_commands() if item.name == "process_source"
    )
    config = item.retry_config.model_copy(
        update={
            "max_attempts": 2,
            "wait_strategy": "fixed",
            "wait_time": 0,
            "wait_min": 0,
            "wait_max": 0,
        }
    )

    async def run():
        async for attempt in build_async_retry_instance(config):
            with attempt:
                await submit()

    task = asyncio.create_task(run())
    await asyncio.wait_for(closing.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()
    backend.signin.assert_awaited_once()
    assert backend.create.await_count == (0 if stage == "signin" else 1)
