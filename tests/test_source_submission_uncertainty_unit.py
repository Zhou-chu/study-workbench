"""Direct retry admission and custody checks with fake persistence and enqueue."""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.routers import sources
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import CommandSubmissionUnknownError


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
