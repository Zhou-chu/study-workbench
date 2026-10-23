"""Source enqueue uncertainty must preserve inputs and prohibit blind replay."""

from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException, UploadFile

from api.models import SourceCreate
from api.routers import sources
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import CommandSubmissionUnknownError


@pytest.fixture
def creation(monkeypatch, tmp_path):
    path = tmp_path / "upload.txt"
    path.write_text("worker input")
    saved = []

    async def save(source):
        source.id = "source:fixture"
        saved.append(source)

    delete = AsyncMock()
    cleanup = Mock(wraps=sources._cleanup_uploaded_file)
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "delete", delete)
    monkeypatch.setattr(Source, "add_to_notebook", AsyncMock())
    monkeypatch.setattr(sources.Notebook, "get", AsyncMock(return_value=object()))
    monkeypatch.setattr(
        sources, "save_uploaded_file", AsyncMock(return_value=str(path))
    )
    monkeypatch.setattr(
        sources,
        "_build_content_state",
        AsyncMock(return_value={"file_path": str(path)}),
    )
    monkeypatch.setattr(sources, "_cleanup_uploaded_file", cleanup)
    return path, saved, delete, cleanup


@pytest.mark.asyncio
@pytest.mark.parametrize("visible_id", ["source:fixture", None])
async def test_initial_save_commit_ack_loss_preserves_upload_without_enqueue(
    creation, monkeypatch, visible_id
):
    path, saved, delete, cleanup = creation
    content = "\ufeff🌞 原始字节。\r\n".encode()
    path.write_bytes(content)
    committed = {}
    writes = []

    async def commit_then_raise(source):
        writes.append(source.model_dump())
        committed["source:fixture"] = source.model_copy(
            update={"id": "source:fixture"}, deep=True
        )
        source.id = visible_id
        raise ConnectionError("private database acknowledgement failure")

    monkeypatch.setattr(Source, "save", commit_then_raise)
    associate = AsyncMock()
    monkeypatch.setattr(Source, "add_to_notebook", associate)
    submit = AsyncMock()
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = SourceCreate(
        type="upload", notebooks=["notebook:fixture"], async_processing=True
    )
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((data, cast(UploadFile, object())))
    assert path.read_bytes() == content
    assert committed["source:fixture"].asset.file_path == str(path)
    assert len(writes) == 1
    assert caught.value.source_id == visible_id
    assert caught.value.command_id is None
    assert "private" not in str(caught.value)
    delete.assert_not_awaited()
    cleanup.assert_not_called()
    submit.assert_not_awaited()
    associate.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_id", [None, "", "   "])
async def test_initial_save_without_usable_identity_never_enqueues_or_claims_success(
    creation, monkeypatch, missing_id
):
    path, saved, delete, cleanup = creation
    writes = []

    async def save_without_identity(source):
        writes.append(source.model_dump())
        source.id = missing_id

    monkeypatch.setattr(Source, "save", save_without_identity)
    associate = AsyncMock()
    monkeypatch.setattr(Source, "add_to_notebook", associate)
    submit = AsyncMock(side_effect=CommandSubmissionUnknownError())
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = SourceCreate(
        type="upload", notebooks=["notebook:fixture"], async_processing=True
    )
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((data, cast(UploadFile, object())))
    assert caught.value.source_id is None
    assert caught.value.command_id is None
    assert len(writes) == 1
    assert path.read_text() == "worker input"
    delete.assert_not_awaited()
    cleanup.assert_not_called()
    submit.assert_not_awaited()
    associate.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_enqueue_preserves_source_file_and_identity(
    creation, monkeypatch
):
    path, saved, delete, cleanup = creation
    submit = AsyncMock(side_effect=CommandSubmissionUnknownError())
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = SourceCreate(
        type="upload", notebooks=["notebook:fixture"], async_processing=True
    )
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((data, cast(UploadFile, object())))
    assert caught.value.source_id == "source:fixture"
    assert saved[0].asset.file_path == str(path)
    delete.assert_not_awaited()
    cleanup.assert_not_called()
    assert path.read_text() == "worker input"
    submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_post_ack_save_failure_preserves_inputs_and_command_identity(
    creation, monkeypatch
):
    path, saved, delete, cleanup = creation
    calls = 0

    async def save(source):
        nonlocal calls
        calls += 1
        source.id = "source:fixture"
        if calls == 2:
            raise ConnectionError("source reference write failed after queue ACK")

    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(
        sources.source_attempts,
        "bind_command",
        AsyncMock(side_effect=ConnectionError("ACK association failed")),
    )
    monkeypatch.setattr(
        sources.CommandService,
        "submit_command_job",
        AsyncMock(return_value="command:confirmed"),
    )
    data = SourceCreate(
        type="upload", notebooks=["notebook:fixture"], async_processing=True
    )
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((data, cast(UploadFile, object())))
    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id == "command:confirmed"
    delete.assert_not_awaited()
    cleanup.assert_not_called()
    assert path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status", ["new", "queued", "running", "unknown", None, "completed"]
)
async def test_retry_fails_closed_unless_prior_command_definitely_failed(
    monkeypatch, status
):
    source = Source(id="source:fixture", command="command:old", full_text="input")
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_status", AsyncMock(return_value=status))
    submit = AsyncMock()
    query = AsyncMock()
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    monkeypatch.setattr(sources, "repo_query", query)
    with pytest.raises(HTTPException):
        await sources.retry_source_processing("source:fixture")
    submit.assert_not_called()
    query.assert_not_called()


@pytest.mark.asyncio
async def test_retry_status_failure_does_not_enqueue(monkeypatch):
    source = Source(id="source:fixture", command="command:old")
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(
        Source, "get_status", AsyncMock(side_effect=ConnectionError("status"))
    )
    submit = AsyncMock()
    query = AsyncMock()
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    monkeypatch.setattr(sources, "repo_query", query)
    with pytest.raises(HTTPException):
        await sources.retry_source_processing("source:fixture")
    submit.assert_not_called()
    query.assert_not_called()


@pytest.mark.asyncio
async def test_retry_unknown_preserves_existing_source_and_propagates_identity(
    monkeypatch,
):
    source = Source(id="source:fixture", command="command:old", full_text="input")
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_status", AsyncMock(return_value="failed"))
    delete = AsyncMock()
    monkeypatch.setattr(Source, "delete", delete)
    monkeypatch.setattr(
        sources, "repo_query", AsyncMock(return_value=["notebook:fixture"])
    )
    monkeypatch.setattr(
        sources.source_attempts,
        "claim_retry",
        AsyncMock(return_value={"token": "retry-token", "phase": "pending"}),
    )
    submit = AsyncMock(side_effect=CommandSubmissionUnknownError())
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.retry_source_processing("source:fixture")
    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id is None
    assert str(source.command) == "command:old"
    assert source.full_text == "input"
    delete.assert_not_awaited()
    submit.assert_awaited_once()
