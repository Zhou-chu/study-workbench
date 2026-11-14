"""Isolated route-function units; no ASGI app, database or provider integration."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from loguru import logger

from api.routers import sources

SECRET = "synthetic-secret /private/connection"


@pytest.mark.parametrize(
    "value", [None, {}, {"submission_unknown": True}, {"error": None}, {"error": ""}]
)
def test_progress_without_failure_is_preserved(value):
    assert sources._public_processing_info(value) == value


@pytest.mark.parametrize(
    "error", [SECRET, "permission denied " + SECRET, "timeout " + SECRET]
)
def test_failure_projection_retains_state_without_guessing_exception_class(error):
    value = {"error": error, "started_at": "2026-01-01", "submission_unknown": True}
    result = sources._public_processing_info(value)
    assert result == {
        **value,
        "error": "Source processing failed. Review the source and processing settings.",
    }
    assert value["error"] == error
    assert SECRET not in str(result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name",
    [
        "get_source",
        "check_source_file",
        "download_source_file",
        "get_source_status",
        "delete_source",
        "get_source_insights",
        "retry_source_processing",
    ],
)
async def test_unexpected_lookup_failure_has_safe_response_and_log(monkeypatch, name):
    monkeypatch.setattr(
        sources.Source, "get", AsyncMock(side_effect=RuntimeError(SECRET))
    )
    records = []
    sink = logger.add(lambda message: records.append(str(message)), level="DEBUG")
    try:
        with pytest.raises(HTTPException) as failure:
            await getattr(sources, name)("source:synthetic")
    finally:
        logger.remove(sink)
    assert failure.value.status_code == 500
    assert SECRET not in str(failure.value.detail)
    assert records
    assert SECRET not in "".join(records)
    assert "exception_type=RuntimeError" in "".join(records)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state", ["failed", "running", "queued", "completed", "unknown", "canceled"]
)
async def test_status_preserves_state_and_safe_progress(monkeypatch, state):
    source = SimpleNamespace(
        processing_attempt=None,
        command="command:synthetic",
        get_status=AsyncMock(return_value=state),
        get_processing_progress=AsyncMock(
            return_value={"error": SECRET, "completed_at": None}
        ),
    )
    monkeypatch.setattr(sources.Source, "get", AsyncMock(return_value=source))
    result = await sources.get_source_status("source:synthetic")
    assert result.status == state
    assert result.command_id == "command:synthetic"
    assert SECRET not in str(result.processing_info)
    assert result.processing_info["completed_at"] is None


@pytest.mark.asyncio
async def test_list_projects_worker_error_without_changing_failed_status(monkeypatch):
    row = {
        "id": "source:synthetic",
        "created": "2026-01-01",
        "updated": "2026-01-01",
        "processing_attempt": {
            "command": "command:synthetic",
            "phase": "failed",
            "owner": "synthetic-owner",
        },
        "command": {
            "id": "command:synthetic",
            "status": "failed",
            "error_message": SECRET,
        },
    }
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[row]))
    result = await sources.get_sources(
        notebook_id=None, limit=50, offset=0, sort_by="updated", sort_order="desc"
    )
    assert result[0].status == "failed"
    assert result[0].command_id == "command:synthetic"
    assert SECRET not in str(result[0].processing_info)
    assert row["command"]["error_message"] == SECRET


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name",
    [
        "get_source",
        "check_source_file",
        "download_source_file",
        "get_source_status",
        "delete_source",
        "get_source_insights",
        "retry_source_processing",
    ],
)
async def test_absent_source_remains_not_found(monkeypatch, name):
    monkeypatch.setattr(sources.Source, "get", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as failure:
        await getattr(sources, name)("source:missing")
    assert failure.value.status_code == 404
    assert failure.value.detail == "Source not found"


@pytest.mark.asyncio
async def test_unresolved_submission_refuses_retry_without_dispatch(monkeypatch):
    source = SimpleNamespace(processing_attempt={"command": None}, command=None)
    monkeypatch.setattr(sources.Source, "get", AsyncMock(return_value=source))
    reconcile = AsyncMock(return_value=source)
    monkeypatch.setattr(sources.source_attempts, "reconcile", reconcile)
    dispatch = AsyncMock(side_effect=AssertionError("must not dispatch"))
    monkeypatch.setattr(sources, "submit_command", dispatch)
    with pytest.raises(HTTPException) as failure:
        await sources.retry_source_processing("source:synthetic")
    assert failure.value.status_code == 409
    assert "unresolved" in failure.value.detail
    dispatch.assert_not_called()
