"""No ambiguous submission or duplicate worker grants permission to replay."""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from api.models import SourceCreate
from api.routers import sources
from commands import source_commands
from open_notebook.database import source_attempt_repository as attempts
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import CommandSubmissionUnknownError


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"result": []},
        {"result": [{"status": "ERR", "result": "failure"}]},
        {"result": [{"status": "OK", "result": {}}]},
        {"result": [{"status": "OK", "result": []}, {"status": "OK", "result": []}]},
    ],
)
async def test_ambiguous_claim_ack_never_returns_permission(monkeypatch, response):
    @asynccontextmanager
    async def connection():
        class DB:
            query_raw = AsyncMock(return_value=response)

        yield DB()

    monkeypatch.setattr(attempts, "db_connection", connection)
    with pytest.raises(CommandSubmissionUnknownError):
        await attempts.claim_retry(Source(id="source:test"))


@pytest.mark.asyncio
async def test_cancelled_claim_is_not_retried(monkeypatch):
    @asynccontextmanager
    async def connection():
        raise asyncio.CancelledError()
        yield

    monkeypatch.setattr(attempts, "db_connection", connection)
    with pytest.raises(asyncio.CancelledError):
        await attempts.claim_retry(Source(id="source:test"))


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "stale-token", "duplicate-token"])
async def test_worker_refuses_before_graph_and_does_not_report_success(
    monkeypatch, token
):
    graph = AsyncMock()
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=Source(id="source:test")))
    monkeypatch.setattr(
        source_commands,
        "start_worker",
        AsyncMock(side_effect=ValueError("Stale or duplicate")),
    )
    monkeypatch.setattr(source_commands.source_graph, "ainvoke", graph)
    with pytest.raises(ValueError, match="Stale or duplicate"):
        await source_commands.process_source_command(
            source_commands.SourceProcessingInput(
                source_id="source:test",
                submission_token=token,
                content_state={},
                notebook_ids=[],
                transformations=[],
                embed=False,
            )
        )
    graph.assert_not_called()


@pytest.mark.asyncio
async def test_fast_worker_completion_preserved_in_create_response(monkeypatch):
    saved = []

    async def save(source):
        source.id = "source:test"
        saved.append(source.model_dump())

    bind = AsyncMock(
        return_value={
            "id": "source:test",
            "title": "Extracted",
            "full_text": "worker output",
            "command": "command:real",
            "processing_attempt": {
                "token": "same",
                "phase": "running",
                "command": "command:real",
            },
        }
    )
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "add_to_notebook", AsyncMock())
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=2))
    monkeypatch.setattr(Source, "get_status", AsyncMock(return_value="completed"))
    monkeypatch.setattr(sources.source_attempts, "bind_command", bind)
    submit = AsyncMock(return_value="command:real")
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    response = await sources._create_source_async_path(
        SourceCreate(type="text", content="original", notebooks=[]),
        {"content": "original"},
        [],
        None,
    )
    assert len(saved) == 1
    assert saved[0]["full_text"] == "original"
    assert submit.await_args is not None
    assert (
        saved[0]["processing_attempt"]["token"]
        == submit.await_args.args[2]["submission_token"]
    )
    assert response.full_text == "worker output" and response.title == "Extracted"
    assert response.status == "completed" and response.embedded_chunks == 2


def test_portable_drops_operational_ownership():
    from api.portable_service import _clean

    assert _clean(
        {
            "full_text": "original",
            "command": "command:old",
            "processing_attempt": {"token": "old", "phase": "running"},
        }
    ) == {"full_text": "original"}


def test_existing_source_save_never_writes_old_owner():
    source = Source(
        id="source:test",
        command="command:old",
        processing_attempt={"token": "old", "phase": "pending"},
    )
    assert "command" not in source._prepare_save_data()
    assert "processing_attempt" not in source._prepare_save_data()


@pytest.mark.asyncio
async def test_create_cancellation_retains_durable_input(monkeypatch):
    saved = []

    async def save(source):
        source.id = "source:cancelled"
        saved.append(source)

    delete = AsyncMock()
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "delete", delete)
    monkeypatch.setattr(Source, "add_to_notebook", AsyncMock())
    monkeypatch.setattr(
        sources.CommandService,
        "submit_command_job",
        AsyncMock(side_effect=asyncio.CancelledError()),
    )
    with pytest.raises(asyncio.CancelledError):
        await sources._create_source_async_path(
            SourceCreate(type="text", content="retained", notebooks=[]),
            {"content": "retained"},
            [],
            None,
        )
    assert saved[0].full_text == "retained"
    assert saved[0].processing_attempt["phase"] == "pending"
    delete.assert_not_called()


@pytest.mark.asyncio
async def test_unresolved_status_read_never_submits(monkeypatch):
    source = Source(
        id="source:test", processing_attempt={"token": "pending", "phase": "pending"}
    )
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(attempts, "reconcile", AsyncMock(return_value=source))
    submit = AsyncMock()
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    result = await sources.get_source_status("source:test")
    assert result.status == "unknown" and result.command_id is None
    submit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("fetched", [True, False])
async def test_unresolved_attempt_hides_stale_command_in_all_read_views(
    monkeypatch, fetched
):
    source = Source(
        id="source:test",
        title="Retained",
        command="command:old",
        processing_attempt={"token": "new", "phase": "pending"},
    )
    row = {**source.model_dump(), "created": "2026-10-22", "updated": "2026-10-22"}
    row["command"] = (
        {"id": "command:old", "status": "failed", "error_message": "old error"}
        if fetched
        else "command:old"
    )
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[row]))
    listing = await sources.get_sources(
        notebook_id=None, limit=10, offset=0, sort_by="updated", sort_order="desc"
    )
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(attempts, "reconcile", AsyncMock(return_value=source))
    monkeypatch.setattr(sources, "_stamp_source_view", AsyncMock())
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=0))
    progress = AsyncMock(return_value={"status": "failed", "error": "old error"})
    monkeypatch.setattr(Source, "get_processing_progress", progress)
    detail = await sources.get_source("source:test")
    status = await sources.get_source_status("source:test")
    for result in [listing[0], detail, status]:
        assert result.status == "unknown"
        assert result.command_id is None
        assert result.processing_info == {"submission_unknown": True}
    progress.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phase, sdk_status, expected",
    [
        ("running", "failed", "unknown"),
        ("running", "completed", "unknown"),
        ("succeeded", "failed", "completed"),
        ("confirmed", "completed", "unknown"),
        (None, "completed", "unknown"),
    ],
)
async def test_owner_completion_controls_all_read_views_and_refuses_retry(
    monkeypatch, phase, sdk_status, expected
):
    from types import SimpleNamespace

    import surreal_commands
    from fastapi import HTTPException

    attempt = (
        {
            "token": "attempt",
            "phase": phase,
            "command": "command:same",
            "owner": "execution",
        }
        if phase
        else None
    )
    source = Source(
        id="source:fixture",
        command="command:same",
        processing_attempt=attempt,
        full_text="retained",
    )
    row = {
        **source.model_dump(),
        "created": "2026-10-22",
        "updated": "2026-10-22",
        "command": {
            "id": "command:same",
            "status": sdk_status,
            "error_message": "duplicate's stale error",
            "result": {"old": True},
        },
    }
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[row]))
    listing = await sources.get_sources(
        notebook_id=None, limit=10, offset=0, sort_by="updated", sort_order="desc"
    )
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=0))
    monkeypatch.setattr(sources, "_stamp_source_view", AsyncMock())
    monkeypatch.setattr(
        surreal_commands,
        "get_command_status",
        AsyncMock(
            return_value=SimpleNamespace(
                status=sdk_status,
                error_message="duplicate's stale error",
                result={"old": True},
            )
        ),
    )
    detail = await sources.get_source("source:fixture")
    status = await sources.get_source_status("source:fixture")
    for response in [listing[0], detail, status]:
        assert response.status == expected
        assert response.command_id == "command:same"
        assert "error" not in response.processing_info
        assert "result" not in response.processing_info
    claim = AsyncMock()
    monkeypatch.setattr(attempts, "claim_retry", claim)
    with pytest.raises(HTTPException) as caught:
        await sources.retry_source_processing("source:fixture")
    assert caught.value.status_code == 409
    claim.assert_not_called()
