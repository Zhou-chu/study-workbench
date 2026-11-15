"""Source retry and status policy with persistence, queue and path calls replaced."""

import asyncio
from dataclasses import dataclass
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from surrealdb import RecordID

from api.models import SourceUpdate
from api.routers import sources
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import (
    CommandSubmissionUnknownError,
    DatabaseOperationError,
)

pytestmark = pytest.mark.asyncio


@dataclass
class Boundaries:
    get: AsyncMock
    status: AsyncMock
    progress: AsyncMock
    chunks: AsyncMock
    reconcile: AsyncMock
    references: AsyncMock
    supported: AsyncMock
    claim: AsyncMock
    submit: AsyncMock
    bind: AsyncMock
    update: AsyncMock


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    sample = Source(id="source:sample", command="command:prior", full_text="保留文字")
    get = AsyncMock(return_value=sample)
    status = AsyncMock(side_effect=["failed", "queued"])
    progress = AsyncMock(return_value=None)
    chunks = AsyncMock(return_value=3)
    reconcile = AsyncMock(return_value=sample)
    references = AsyncMock(return_value=[RecordID("notebook", "one"), "notebook:two"])
    supported = AsyncMock()
    claim = AsyncMock(return_value={"token": "retry-token"})
    submit = AsyncMock(return_value="command:next")
    bind = AsyncMock(
        return_value={
            "id": "source:sample",
            "command": "command:next",
            "title": "Bound",
        }
    )
    update = AsyncMock()
    for target, name, replacement in (
        (Source, "get", get),
        (Source, "get_status", status),
        (Source, "get_processing_progress", progress),
        (Source, "get_embedded_chunks", chunks),
        (sources.source_attempts, "reconcile", reconcile),
        (sources, "repo_query", references),
        (sources, "_assert_file_supported", supported),
        (sources.source_attempts, "claim_retry", claim),
        (sources.CommandService, "submit_command_job", submit),
        (sources.source_attempts, "bind_command", bind),
        (sources, "repo_update", update),
    ):
        monkeypatch.setattr(target, name, replacement)
    return Boundaries(
        get,
        status,
        progress,
        chunks,
        reconcile,
        references,
        supported,
        claim,
        submit,
        bind,
        update,
    )


@pytest.mark.parametrize(
    ("asset", "prior", "state"),
    [
        (None, "failed", {"content": "保留文字"}),
        (
            Asset(url="https://example.org/paper"),
            "cancelled",
            {"url": "https://example.org/paper"},
        ),
        (
            Asset(file_path="originals/paper.pdf", url="https://example.org/paper"),
            "canceled",
            {"file_path": "originals/paper.pdf", "delete_source": False},
        ),
    ],
)
async def test_retry_reuses_original_material_and_reports_new_command(
    setup: Boundaries, asset: Asset | None, prior: str, state: dict
) -> None:
    setup.get.return_value.asset = asset
    setup.status.side_effect = [prior, "queued"]
    result = await sources.retry_source_processing("source:sample")
    assert result.id == "source:sample"
    assert result.command_id == "command:next" and result.status == "queued"
    assert result.title == "Bound" and result.embedded_chunks == 3
    assert result.processing_info == {"retry": True, "queued": True}
    assert setup.references.await_args is not None
    assert str(setup.references.await_args.args[1]["source_id"]) == "source:sample"
    setup.submit.assert_awaited_once_with(
        "open_notebook",
        "process_source",
        {
            "source_id": "source:sample",
            "submission_token": "retry-token",
            "content_state": state,
            "notebook_ids": ["notebook:one", "notebook:two"],
            "transformations": [],
            "embed": True,
        },
    )
    setup.bind.assert_awaited_once_with("source:sample", "retry-token", "command:next")
    if "file_path" in state:
        setup.supported.assert_awaited_once_with("originals/paper.pdf")
    else:
        setup.supported.assert_not_awaited()


@pytest.mark.parametrize(
    ("problem", "status_code", "detail"),
    [
        ("missing", 404, "Source not found"),
        ("unlinked", 400, "Source is not associated with any notebooks"),
        ("empty-asset", 400, "Source asset has no file_path or url"),
        ("empty-text", 400, "Cannot determine source content for retry"),
        ("unsupported", 415, "Unsupported source type"),
        ("contended", 409, "Another attempt already owns this source"),
    ],
)
async def test_retry_preflight_never_submits_without_usable_owned_source(
    setup: Boundaries, problem: str, status_code: int, detail: str
) -> None:
    if problem == "missing":
        setup.get.return_value = None
    elif problem == "unlinked":
        setup.references.return_value = []
    elif problem == "empty-asset":
        setup.get.return_value.asset = Asset()
    elif problem == "empty-text":
        setup.get.return_value.full_text = None
    elif problem == "unsupported":
        setup.get.return_value.asset = Asset(file_path="originals/unknown.example")
        setup.supported.side_effect = HTTPException(status_code=415, detail=detail)
    else:
        setup.claim.side_effect = ValueError(detail)

    with pytest.raises(HTTPException) as caught:
        await sources.retry_source_processing("source:sample")
    assert (caught.value.status_code, caught.value.detail) == (status_code, detail)
    assert setup.claim.await_count == int(problem == "contended")
    setup.submit.assert_not_awaited()
    setup.bind.assert_not_awaited()


async def test_retry_unresolved_submission_stops_before_reading_references(
    setup: Boundaries,
) -> None:
    setup.get.return_value = Source(
        id="source:sample", processing_attempt={"token": "unresolved"}
    )
    setup.reconcile.return_value = setup.get.return_value
    with pytest.raises(HTTPException) as caught:
        await sources.retry_source_processing("source:sample")
    assert caught.value.status_code == 409
    assert "unresolved" in str(caught.value.detail)
    setup.reconcile.assert_awaited_once_with(setup.get.return_value)
    setup.references.assert_not_awaited()
    setup.claim.assert_not_awaited()
    setup.submit.assert_not_awaited()


async def test_retry_after_reconciliation_uses_recovered_command_without_second_submit(
    setup: Boundaries,
) -> None:
    setup.get.return_value = Source(
        id="source:sample", processing_attempt={"token": "unresolved"}
    )
    setup.reconcile.return_value = Source(
        id="source:sample",
        command="command:recovered",
        processing_attempt={"token": "unresolved", "command": "command:recovered"},
    )
    setup.status.side_effect = ["running"]
    with pytest.raises(HTTPException) as caught:
        await sources.retry_source_processing("source:sample")
    assert caught.value.status_code == 409
    setup.status.assert_awaited_once()
    setup.references.assert_not_awaited()
    setup.submit.assert_not_awaited()


@pytest.mark.parametrize("boundary", ["submit", "bind", "projection"])
async def test_retry_unexpected_ack_failure_keeps_known_identity_and_never_replays(
    setup: Boundaries, boundary: str
) -> None:
    failure = RuntimeError("Synthetic boundary failure")
    target = {"submit": setup.submit, "bind": setup.bind, "projection": setup.chunks}
    target[boundary].side_effect = failure
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.retry_source_processing("source:sample")
    assert caught.value.__cause__ is failure
    assert caught.value.source_id == "source:sample"
    assert caught.value.command_id == (None if boundary == "submit" else "command:next")
    assert setup.submit.await_count == 1
    assert setup.bind.await_count == int(boundary != "submit")


@pytest.mark.parametrize("boundary", ["claim", "submit", "bind"])
async def test_cancelled_retry_does_not_repeat_queue_submission(
    setup: Boundaries, boundary: str
) -> None:
    failure = asyncio.CancelledError()
    {"claim": setup.claim, "submit": setup.submit, "bind": setup.bind}[
        boundary
    ].side_effect = failure
    with pytest.raises(asyncio.CancelledError) as caught:
        await sources.retry_source_processing("source:sample")
    assert caught.value is failure
    assert setup.submit.await_count == int(boundary != "claim")
    assert setup.bind.await_count == int(boundary == "bind")


async def test_source_status_distinguishes_completed_legacy_source_from_queue_status(
    setup: Boundaries,
) -> None:
    setup.get.return_value = Source(id="source:legacy")
    result = await sources.get_source_status("source:legacy")
    assert result.model_dump() == {
        "status": None,
        "message": "Legacy source (completed before async processing)",
        "processing_info": None,
        "command_id": None,
    }
    setup.status.assert_not_awaited()
    setup.reconcile.assert_not_awaited()


@pytest.mark.parametrize(
    ("status", "message"),
    [
        ("completed", "Source processing completed successfully"),
        ("failed", "Source processing failed"),
        ("running", "Source processing in progress"),
        ("queued", "Source processing queued"),
        ("unknown", "Source processing status unknown"),
        ("cancelled", "Source processing status: cancelled"),
    ],
)
async def test_status_keeps_command_id_and_message_after_reconciliation(
    setup: Boundaries, status: str, message: str
) -> None:
    setup.get.return_value = Source(
        id="source:sample", processing_attempt={"token": "unresolved"}
    )
    setup.reconcile.return_value = Source(
        id="source:sample",
        command="command:recovered",
        processing_attempt={"token": "unresolved", "command": "command:recovered"},
    )
    setup.status.side_effect = [status]
    setup.progress.return_value = {"current": 2}
    result = await sources.get_source_status("source:sample")
    assert (result.status, result.message, result.command_id) == (
        status,
        message,
        "command:recovered",
    )
    assert result.processing_info == {"current": 2}
    setup.submit.assert_not_awaited()


@pytest.mark.parametrize("boundary", ["status", "progress"])
async def test_status_receipt_survives_unavailable_progress_or_status_backend(
    setup: Boundaries, boundary: str
) -> None:
    {"status": setup.status, "progress": setup.progress}[
        boundary
    ].side_effect = DatabaseOperationError("Synthetic backend connection detail")
    result = await sources.get_source_status("source:sample")
    assert result.model_dump() == {
        "status": "unknown",
        "message": "Failed to retrieve processing status",
        "processing_info": None,
        "command_id": "command:prior",
    }
    setup.submit.assert_not_awaited()


@pytest.mark.parametrize("boundary", ["lookup", "metadata"])
async def test_cancelled_metadata_update_never_refreshes_embedding_count(
    setup: Boundaries, boundary: str
) -> None:
    failure = asyncio.CancelledError()
    {"lookup": setup.get, "metadata": setup.update}[boundary].side_effect = failure
    with pytest.raises(asyncio.CancelledError) as caught:
        await sources.update_source("source:sample", SourceUpdate(title="Rename"))
    assert caught.value is failure
    assert setup.update.await_count == int(boundary == "metadata")
    setup.chunks.assert_not_awaited()
