"""Deterministic original admission/replay decisions, not filesystem durability."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import PurePosixPath
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import evidence_service as subject
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def replay(monkeypatch):
    events = []

    @asynccontextmanager
    async def lock(notebook):
        events.append(("lock", notebook))
        try:
            yield
        finally:
            events.append(("unlock", notebook))

    store = SimpleNamespace(
        get=AsyncMock(return_value=None), put=AsyncMock(), project_lock=lock
    )
    service = object.__new__(subject.EvidenceService)
    service.store = store
    monkeypatch.setattr(
        service, "data_root", PurePosixPath("/synthetic/originals"), raising=False
    )
    resolve = AsyncMock(return_value=PurePosixPath("/synthetic/retained.txt"))
    monkeypatch.setattr(service, "resolve_file", resolve)
    thread = AsyncMock(return_value=None)
    monkeypatch.setattr(subject, "asyncio", SimpleNamespace(to_thread=thread))
    monkeypatch.setattr(subject, "_now", lambda: "2030-01-01T00:00:00Z")
    return SimpleNamespace(
        service=service, store=store, resolve=resolve, thread=thread, events=events
    )


async def ingest(replay, **overrides):
    args = dict(
        notebook_id="notebook:one",
        source_id="source:one",
        title="原文.txt",
        data="原文内容".encode(),
        mime_type="text/plain",
        source_version_id="sv_retained",
    )
    args.update(overrides)
    return await replay.service.ingest(**args)


async def seed(replay):
    retained = await ingest(replay)
    replay.store.get.return_value = deepcopy(retained)
    replay.store.put.reset_mock()
    replay.thread.reset_mock()
    replay.events.clear()
    return retained


@pytest.mark.asyncio
async def test_exact_replay_returns_retained_metadata_without_republication(replay):
    retained = await seed(replay)
    replay.store.get.return_value["created_at"] = "2020-01-01T00:00:00Z"
    replay.store.get.return_value["current_extraction_id"] = "ex_historical"
    result = await ingest(replay, preserve_on_error=True)
    assert result["sha256"] == retained["sha256"]
    assert result["created_at"] == "2020-01-01T00:00:00Z"
    assert result["current_extraction_id"] == "ex_historical"
    replay.resolve.assert_awaited_once_with("sv_retained")
    replay.thread.assert_not_awaited()
    replay.store.put.assert_not_awaited()
    assert replay.events == [("lock", "notebook:one"), ("unlock", "notebook:one")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("notebook_id", "notebook:other"),
        ("source_id", "source:other"),
        ("source_title", "另一个标题"),
        ("origin", "web_snapshot"),
        ("original_status", "missing"),
        ("sha256", "0" * 64),
        ("mime_type", "text/markdown"),
        ("byte_size", 999),
        ("file_path", "originals/other/original.txt"),
        ("provenance", {"source_url": "https://example.invalid/historical"}),
    ],
)
async def test_changed_retained_identity_rejects_before_file_resolution(
    replay, field, value
):
    await seed(replay)
    replay.store.get.return_value[field] = value
    before = deepcopy(replay.store.get.return_value)
    with pytest.raises(InvalidInputError, match="SNAPSHOT_CONFLICT"):
        await ingest(replay)
    assert replay.store.get.return_value == before
    replay.resolve.assert_not_awaited()
    replay.thread.assert_not_awaited()
    replay.store.put.assert_not_awaited()
    assert replay.events[-1] == ("unlock", "notebook:one")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure_type", [NotFoundError, InvalidInputError, asyncio.CancelledError]
)
async def test_replay_does_not_acknowledge_unavailable_or_corrupt_original(
    replay, failure_type
):
    await seed(replay)
    failure = failure_type("synthetic original boundary")
    replay.resolve.side_effect = failure
    with pytest.raises(failure_type) as caught:
        await ingest(replay)
    assert caught.value is failure
    replay.resolve.assert_awaited_once_with("sv_retained")
    replay.thread.assert_not_awaited()
    replay.store.put.assert_not_awaited()
    assert replay.events[-1] == ("unlock", "notebook:one")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mime,filename,expected",
    [
        ("TEXT/PLAIN; charset=utf-8", "a.txt", "text/plain"),
        ("application/octet-stream", "a.md", "text/markdown"),
        (None, "a.txt", "text/plain"),
    ],
)
async def test_normalized_input_has_exact_version_receipt_before_persistence(
    replay, mime, filename, expected
):
    result = await ingest(replay, mime_type=mime, filename=filename)
    assert result["mime_type"] == expected
    assert result["source_version_id"] == "sv_retained"
    assert result["byte_size"] == len("原文内容".encode())
    assert result["source_title"] == "原文.txt"
    replay.store.put.assert_awaited_once_with(
        "version", "sv_retained", result, create_only=True
    )
    replay.thread.assert_awaited_once_with(
        subject.publish_snapshot_bytes,
        replay.service.data_root / result["file_path"],
        "原文内容".encode(),
        durability_root=replay.service.data_root,
    )
    replay.resolve.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_type", [RuntimeError, asyncio.CancelledError])
async def test_deterministic_metadata_failure_keeps_original_failure_and_no_retry(
    replay, failure_type
):
    failure = failure_type("synthetic persistence boundary")
    replay.store.put.side_effect = failure
    with pytest.raises(failure_type) as caught:
        await ingest(replay)
    assert caught.value is failure
    replay.thread.assert_awaited_once()
    replay.store.put.assert_awaited_once()
    assert replay.events[-1] == ("unlock", "notebook:one")
