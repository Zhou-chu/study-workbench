"""Real Source/model orchestration; all persistence, queue and executor boundaries replaced."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.models import SourceCreate
from api.routers import sources as module
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import CommandSubmissionUnknownError


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    saved: list[Source] = []
    events: list[str] = []

    async def save(source: Source) -> None:
        events.append("save")
        source.id = "source:one"
        saved.append(source.model_copy(deep=True))

    async def associate(notebook_id: str) -> None:
        events.append("associate:" + notebook_id)

    async def bind(source_id: str, token: str, command_id: str):
        events.append("bind")
        result = saved[0].model_dump()
        result["command"] = command_id
        return result

    association = AsyncMock(side_effect=associate)
    submit = AsyncMock(return_value="command:one")
    binding = AsyncMock(side_effect=bind)
    chunks = AsyncMock(return_value=2)
    status = AsyncMock(return_value="queued")
    processed = Source(
        id="source:one", title="Processed", full_text="canonical text", topics=["topic"]
    )
    get = AsyncMock(return_value=processed)
    thread = AsyncMock(return_value=SimpleNamespace(is_success=lambda: True))
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "add_to_notebook", association)
    monkeypatch.setattr(Source, "get_embedded_chunks", chunks)
    monkeypatch.setattr(Source, "get_status", status)
    monkeypatch.setattr(Source, "get", get)
    monkeypatch.setattr(module.CommandService, "submit_command_job", submit)
    monkeypatch.setattr(module.source_attempts, "bind_command", binding)
    monkeypatch.setattr(module.asyncio, "to_thread", thread)
    return SimpleNamespace(
        saved=saved,
        events=events,
        association=association,
        submit=submit,
        bind=binding,
        chunks=chunks,
        status=status,
        get=get,
        thread=thread,
        processed=processed,
    )


def request() -> SourceCreate:
    return SourceCreate(
        type="text",
        content="saved text",
        notebooks=["notebook:a", "notebook:b"],
        embed=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["text", "link", "upload"])
@pytest.mark.parametrize("title", [None, "Chosen title"])
async def test_async_constructs_source_intent_and_exact_command_inputs(
    setup: SimpleNamespace, kind: str, title: str | None
) -> None:
    s = setup
    data = SourceCreate(
        type=kind,
        content="saved text",
        url="https://example.invalid/source",
        file_path="legacy-file-token",
        title=title,
        notebooks=["notebook:a", "notebook:b"],
        embed=True,
    )
    content_state = {"content": "opaque validated state"}
    result = await module._create_source_async_path(
        data, content_state, ["transform:one"], "uploaded-file-token"
    )
    source = s.saved[0]
    assert source.title == (title or "Processing...")
    assert source.full_text == ("saved text" if kind == "text" else None)
    if kind == "text":
        assert source.asset is None
    elif kind == "link":
        assert source.asset is not None and source.asset.url == data.url
    else:
        assert (
            source.asset is not None and source.asset.file_path == "uploaded-file-token"
        )
    command = s.submit.await_args.args
    assert command[:2] == ("open_notebook", "process_source")
    payload = command[2]
    assert payload["source_id"] == "source:one"
    assert payload["content_state"] == content_state
    assert payload["notebook_ids"] == ["notebook:a", "notebook:b"]
    assert payload["transformations"] == ["transform:one"] and payload["embed"] is True
    assert source.processing_attempt is not None
    assert payload["submission_token"] == source.processing_attempt["token"]
    s.bind.assert_awaited_once_with(
        "source:one", payload["submission_token"], "command:one"
    )
    assert result.id == "source:one" and result.command_id == "command:one"
    assert result.status == "queued" and result.embedded_chunks == 2
    assert result.processing_info == {"async": True, "queued": True}
    assert s.events == ["save", "associate:notebook:a", "associate:notebook:b", "bind"]
    s.thread.assert_not_awaited()


@pytest.mark.asyncio
async def test_async_upload_uses_legacy_path_when_no_uploaded_path(
    setup: SimpleNamespace,
) -> None:
    data = SourceCreate(type="upload", file_path="legacy-file-token")
    await module._create_source_async_path(
        data, {"file_path": "legacy-file-token"}, [], None
    )
    assert setup.saved[0].asset.file_path == "legacy-file-token"
    setup.association.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary", ["association", "submit", "bind", "chunks", "status"]
)
async def test_async_post_save_failure_preserves_known_owner_and_ack(
    setup: SimpleNamespace, boundary: str
) -> None:
    s = setup
    error = OSError("synthetic failure")
    getattr(s, boundary).side_effect = error
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await module._create_source_async_path(
            request(), {"content": "saved text"}, [], None
        )
    assert caught.value.source_id == "source:one"
    assert caught.value.command_id == (
        "command:one" if boundary in {"bind", "chunks", "status"} else None
    )
    assert caught.value.__cause__ is error
    assert len(s.saved) == 1
    if boundary == "association":
        s.submit.assert_not_awaited()
    if boundary in {"association", "submit"}:
        s.bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["association", "submit", "bind"])
async def test_async_cancellation_is_not_converted_to_ack_or_retried(
    setup: SimpleNamespace, boundary: str
) -> None:
    error = asyncio.CancelledError("cancelled")
    getattr(setup, boundary).side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await module._create_source_async_path(
            request(), {"content": "saved text"}, [], None
        )
    assert caught.value is error
    assert len(setup.saved) == 1
    assert getattr(setup, boundary).await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("embed", [False, True])
async def test_sync_success_uses_executor_boundary_and_real_response_projection(
    setup: SimpleNamespace, embed: bool
) -> None:
    s = setup
    data = SourceCreate(type="text", content="saved text", embed=embed)
    result = await module._create_source_sync_path(
        data, {"content": "saved text"}, ["transform:one"]
    )
    args = s.thread.await_args.args
    assert args[:3] == (module.execute_command_sync, "open_notebook", "process_source")
    assert args[3]["source_id"] == "source:one"
    assert args[3]["embed"] is embed and args[3]["transformations"] == ["transform:one"]
    assert args[3]["content_state"] == {"content": "saved text"}
    assert s.thread.await_args.kwargs == {"timeout": 300}
    s.get.assert_awaited_once_with("source:one")
    assert result.full_text == "canonical text" and result.title == "Processed"
    assert result.topics == ["topic"] and result.embedded is True
    assert result.command_id is None and result.status is None
    s.submit.assert_not_awaited()
    s.bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["thread", "get", "chunks"])
async def test_sync_failure_cannot_claim_rollback_or_command_identity(
    setup: SimpleNamespace, boundary: str
) -> None:
    error = OSError("synthetic failure")
    getattr(setup, boundary).side_effect = error
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await module._create_source_sync_path(request(), {"content": "saved text"}, [])
    assert caught.value.source_id == "source:one" and caught.value.command_id is None
    assert caught.value.__cause__ is error
    assert len(setup.saved) == 1
    if boundary == "thread":
        setup.get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["thread", "get", "chunks"])
async def test_sync_cancellation_does_not_report_worker_termination(
    setup: SimpleNamespace, boundary: str
) -> None:
    error = asyncio.CancelledError("cancelled")
    getattr(setup, boundary).side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await module._create_source_sync_path(request(), {"content": "saved text"}, [])
    assert caught.value is error
    assert len(setup.saved) == 1
    assert getattr(setup, boundary).await_count == 1


@pytest.mark.asyncio
async def test_sync_missing_processed_row_retains_unknown_outcome(
    setup: SimpleNamespace,
) -> None:
    setup.get.return_value = None
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await module._create_source_sync_path(request(), {"content": "saved text"}, [])
    assert caught.value.source_id == "source:one"
    assert caught.value.command_id is None
    setup.chunks.assert_not_awaited()


@pytest.mark.asyncio
async def test_async_existing_unknown_exception_keeps_allocated_command(
    setup: SimpleNamespace,
) -> None:
    error = CommandSubmissionUnknownError(command_id="command:uncertain")
    setup.submit.side_effect = error
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await module._create_source_async_path(
            request(), {"content": "saved text"}, [], None
        )
    assert caught.value is error
    assert error.source_id == "source:one" and error.command_id == "command:uncertain"
    setup.bind.assert_not_awaited()
