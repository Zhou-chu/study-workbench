"""Direct source-open/download decisions; no ASGI, file read, storage or queue I/O."""

import asyncio
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse
from surrealdb import RecordID

from api.routers import sources as mod
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import DatabaseOperationError, NotFoundError

pytestmark = pytest.mark.asyncio


@dataclass
class Boundary:
    source: Source
    get: AsyncMock
    status: AsyncMock
    progress: AsyncMock
    chunks: AsyncMock
    reconcile: AsyncMock
    query: AsyncMock
    exists: Mock
    realpath: Mock
    events: list[str]


@pytest.fixture
def b(monkeypatch: pytest.MonkeyPatch) -> Boundary:
    source = Source(
        id="source:one", title="中文资料", full_text="保留内容", topics=["主题"]
    )
    get = AsyncMock(return_value=source)
    status = AsyncMock(return_value="completed")
    progress = AsyncMock(return_value={"stage": "done", "progress": 1})
    chunks = AsyncMock(return_value=2)
    reconcile = AsyncMock(return_value=source)
    events: list[str] = []

    async def query(sql, params):
        assert str(params["source_id"]) == "source:one"
        if sql.startswith("UPDATE"):
            events.append("stamp")
            return []
        assert sql == "SELECT VALUE out FROM reference WHERE in = $source_id"
        events.append("references")
        return [RecordID("notebook", "a"), "notebook:b"]

    db = AsyncMock(side_effect=query)
    exists = Mock(return_value=True)
    realpath = Mock(side_effect=lambda path: str(path))
    monkeypatch.setattr(mod, "UPLOADS_FOLDER", "/virtual/uploads")
    monkeypatch.setattr(
        mod,
        "os",
        SimpleNamespace(
            path=SimpleNamespace(
                realpath=realpath,
                exists=exists,
                basename=lambda path: path.rsplit("/", 1)[-1],
            ),
            sep="/",
        ),
    )
    for owner, name, value in (
        (Source, "get", get),
        (Source, "get_status", status),
        (Source, "get_processing_progress", progress),
        (Source, "get_embedded_chunks", chunks),
        (mod.source_attempts, "reconcile", reconcile),
        (mod, "repo_query", db),
    ):
        monkeypatch.setattr(owner, name, value)
    return Boundary(
        source, get, status, progress, chunks, reconcile, db, exists, realpath, events
    )


async def test_open_projects_real_values_and_associations_after_view_stamp(b):
    result = await mod.get_source("source:one")
    assert result.model_dump() == dict(
        id="source:one",
        title="中文资料",
        topics=["主题"],
        asset=None,
        full_text="保留内容",
        embedded=True,
        embedded_chunks=2,
        file_available=None,
        created=str(b.source.created),
        updated=str(b.source.updated),
        command_id=None,
        status=None,
        processing_info=None,
        notebooks=["notebook:a", "notebook:b"],
    )
    assert b.events == ["stamp", "references"]
    b.get.assert_awaited_once_with("source:one")
    b.chunks.assert_awaited_once_with()
    b.status.assert_not_awaited()
    b.progress.assert_not_awaited()
    b.reconcile.assert_not_awaited()
    b.exists.assert_not_called()


@pytest.mark.parametrize(
    "asset,available",
    [
        (None, None),
        (Asset(url="https://example.com"), None),
        (Asset(file_path="/virtual/uploads/lesson.txt"), True),
    ],
)
async def test_open_reports_original_availability_without_reading_bytes(
    b, asset, available
):
    b.source.asset = asset
    result = await mod.get_source("source:one")
    assert result.file_available is available
    assert (result.asset.model_dump() if result.asset else None) == (
        asset.model_dump() if asset else None
    )
    assert b.exists.call_count == int(available is True)


async def test_open_missing_file_keeps_saved_text_and_empty_embedding_state(b):
    b.source.asset = Asset(file_path="/virtual/uploads/missing.txt")
    b.exists.return_value = False
    b.chunks.return_value = 0
    result = await mod.get_source("source:one")
    assert result.file_available is False
    assert result.full_text == "保留内容"
    assert result.embedded is False and result.embedded_chunks == 0


async def test_unbound_attempt_hides_stale_command_without_status_read(b):
    b.source.command = "command:old"
    b.source.processing_attempt = {"token": "attempt:next"}
    result = await mod.get_source("source:one")
    b.reconcile.assert_awaited_once_with(b.source)
    assert result.status == "unknown"
    assert result.command_id is None
    assert result.processing_info == {"submission_unknown": True}
    b.status.assert_not_awaited()
    b.progress.assert_not_awaited()
    assert result.notebooks == ["notebook:a", "notebook:b"]


async def test_reconciled_attempt_uses_replacement_source_and_public_progress(b):
    b.source.processing_attempt = {"token": "attempt:next"}
    replacement = Source(
        id="source:one",
        title="Recovered",
        command="command:new",
        processing_attempt={"token": "attempt:next", "command": "command:new"},
    )
    b.reconcile.return_value = replacement
    original = {
        "stage": "extract",
        "error": "synthetic internal details",
        "progress": 0.5,
    }
    b.progress.return_value = original
    result = await mod.get_source("source:one")
    assert result.title == "Recovered" and result.command_id == "command:new"
    assert result.status == "completed"
    assert result.processing_info == {
        "stage": "extract",
        "error": "Source processing failed. Review the source and processing settings.",
        "progress": 0.5,
    }
    assert original["error"] == "synthetic internal details"
    b.status.assert_awaited_once_with()
    b.progress.assert_awaited_once_with()


@pytest.mark.parametrize("phase", ["status", "progress"])
async def test_optional_command_metadata_failure_still_returns_source(b, phase):
    b.source.command = "command:one"
    getattr(b, phase).side_effect = RuntimeError("metadata unavailable")
    result = await mod.get_source("source:one")
    assert result.status == "unknown" and result.command_id == "command:one"
    assert result.processing_info is None
    assert result.full_text == "保留内容" and result.embedded_chunks == 2
    if phase == "status":
        b.progress.assert_not_awaited()


async def test_view_stamp_failure_does_not_block_reference_read(b):
    b.query.side_effect = [RuntimeError("stamp unavailable"), []]
    result = await mod.get_source("source:one")
    assert result.notebooks == [] and result.full_text == "保留内容"
    assert b.query.await_count == 2
    assert b.query.await_args_list[0].args[0].startswith("UPDATE")
    assert b.query.await_args_list[1].args[0].startswith("SELECT")


@pytest.mark.parametrize("missing", [None, NotFoundError("absent")])
async def test_missing_source_never_stamps_or_reads_metadata(b, missing):
    if missing is None:
        b.get.return_value = None
    else:
        b.get.side_effect = missing
    with pytest.raises(HTTPException) as caught:
        await mod.get_source("source:one")
    assert caught.value.status_code == 404 and caught.value.detail == "Source not found"
    b.query.assert_not_awaited()
    b.chunks.assert_not_awaited()


@pytest.mark.parametrize("phase", ["get", "chunks", "reconcile"])
@pytest.mark.parametrize("kind", ["typed", "cancel", "unexpected"])
async def test_required_read_failure_propagates_or_maps_without_partial_result(
    b, phase, kind
):
    error = (
        DatabaseOperationError("read failed")
        if kind == "typed"
        else asyncio.CancelledError()
        if kind == "cancel"
        else RuntimeError("synthetic detail")
    )
    if phase == "reconcile":
        b.source.processing_attempt = {"token": "attempt:next"}
    getattr(b, phase).side_effect = error
    with pytest.raises(
        type(error) if kind != "unexpected" else HTTPException
    ) as caught:
        await mod.get_source("source:one")
    if kind != "unexpected":
        assert caught.value is error
    else:
        assert isinstance(caught.value, HTTPException)
        assert caught.value.status_code == 500
        assert caught.value.detail == "Error fetching source"
    assert not any(
        call.args[0].startswith("SELECT") for call in b.query.await_args_list
    )


@pytest.mark.parametrize("action", ["check", "download"])
async def test_original_route_returns_metadata_without_sending_file(b, action):
    b.source.asset = Asset(file_path="/virtual/uploads/lesson.txt")
    if action == "check":
        result = await mod.check_source_file("source:one")
        assert result.status_code == 200
        assert result.body == b""
    else:
        result = await mod.download_source_file("source:one")
        assert isinstance(result, FileResponse)
        assert result.path == "/virtual/uploads/lesson.txt"
        assert result.filename == "lesson.txt"
        assert result.media_type == "application/octet-stream"
        assert "lesson.txt" in result.headers["content-disposition"]
        assert result.stat_result is None
    b.exists.assert_called_once_with("/virtual/uploads/lesson.txt")
    b.query.assert_not_awaited()


@pytest.mark.parametrize(
    "mode,detail",
    [
        ("absent", "Source not found"),
        ("url", "Source has no file to download"),
        ("missing", "File not found on server"),
    ],
)
async def test_original_missing_decisions_preserve_precise_notfound(b, mode, detail):
    if mode == "absent":
        b.get.return_value = None
    elif mode == "url":
        b.source.asset = Asset(url="https://example.com")
    else:
        b.source.asset = Asset(file_path="/virtual/uploads/missing.txt")
        b.exists.return_value = False
    with pytest.raises(HTTPException) as caught:
        await mod.download_source_file("source:one")
    assert caught.value.status_code == 404 and caught.value.detail == detail
    b.query.assert_not_awaited()


@pytest.mark.parametrize(
    "action,detail",
    [
        ("check", "Failed to verify file"),
        ("download", "Failed to download source file"),
    ],
)
async def test_original_lookup_failure_uses_endpoint_error(b, action, detail):
    b.get.side_effect = RuntimeError("synthetic internal error")
    with pytest.raises(HTTPException) as caught:
        if action == "check":
            await mod.check_source_file("source:one")
        else:
            await mod.download_source_file("source:one")
    assert caught.value.status_code == 500 and caught.value.detail == detail
