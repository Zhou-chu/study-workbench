"""Locked SDK and multi-component submission compatibility."""

import asyncio
from collections.abc import Callable, Coroutine
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from command_submission_fixtures import Choice, Input, submit
from pydantic import BaseModel
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
