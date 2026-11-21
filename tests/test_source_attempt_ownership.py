"""Cross-view source attempt ownership integration."""

from unittest.mock import AsyncMock

import pytest

from api.routers import sources
from open_notebook.database import source_attempt_repository as attempts
from open_notebook.domain.notebook import Source


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
