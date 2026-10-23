"""Post-save sync failures retain data instead of treating queue status as rollback."""

import asyncio
from threading import Event
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI, UploadFile

from api.main import command_submission_unknown_handler
from api.models import SourceCreate
from api.routers import sources
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import CommandSubmissionUnknownError, NotFoundError


@pytest.fixture
def sync_creation(monkeypatch, tmp_path):
    path = tmp_path / "original.txt"
    original = "\ufeff🌞 原始资料。\r\n".encode()
    path.write_bytes(original)
    records = {}
    children = ["embedding:existing", "source_insight:existing"]
    saves = []

    async def save(source):
        source.id = "source:fixture"
        saves.append(source)
        records[source.id] = source.model_copy(deep=True)

    async def delete():
        records.clear()
        children.clear()

    processed = Source(
        id="source:fixture",
        title="Processed",
        full_text="retained extracted text",
        asset=Asset(file_path=str(path)),
    )
    delete_source = AsyncMock(side_effect=delete)
    cleanup = Mock(wraps=sources._cleanup_uploaded_file)
    associate = AsyncMock()
    get_source = AsyncMock(return_value=processed)
    chunks = AsyncMock(return_value=1)
    submit = AsyncMock()
    execute = Mock(return_value=SimpleNamespace(is_success=lambda: True))
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "delete", delete_source)
    monkeypatch.setattr(Source, "add_to_notebook", associate)
    monkeypatch.setattr(Source, "get", get_source)
    monkeypatch.setattr(Source, "get_embedded_chunks", chunks)
    monkeypatch.setattr(sources.Notebook, "get", AsyncMock(return_value=object()))
    monkeypatch.setattr(sources.Transformation, "get", AsyncMock(return_value=object()))
    monkeypatch.setattr(
        sources, "save_uploaded_file", AsyncMock(return_value=str(path))
    )
    monkeypatch.setattr(sources, "UPLOADS_FOLDER", str(tmp_path))
    monkeypatch.setattr(sources, "_assert_file_supported", AsyncMock())
    monkeypatch.setattr(sources, "_cleanup_uploaded_file", cleanup)
    monkeypatch.setattr(sources, "execute_command_sync", execute)
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = SourceCreate(
        type="upload", async_processing=False, notebooks=["notebook:fixture"]
    )
    return SimpleNamespace(
        path=path,
        original=original,
        records=records,
        children=children,
        saves=saves,
        processed=processed,
        delete=delete_source,
        cleanup=cleanup,
        associate=associate,
        get=get_source,
        chunks=chunks,
        submit=submit,
        execute=execute,
        data=data,
    )


def assert_retained(state):
    assert state.path.read_bytes() == state.original
    assert set(state.records) == {"source:fixture"}
    assert state.children == ["embedding:existing", "source_insight:existing"]
    assert len(state.saves) == 1
    state.delete.assert_not_awaited()
    state.cleanup.assert_not_called()
    state.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_sync_association_failure_retains_saved_source_without_submission(
    sync_creation,
):
    state = sync_creation
    state.associate.side_effect = ConnectionError("private association receipt")

    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((state.data, cast(UploadFile, object())))

    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id is None
    assert "private" not in str(caught.value)
    assert_retained(state)
    state.execute.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [ConnectionError, TimeoutError, ValueError])
async def test_sync_accepted_queue_error_retains_inputs_without_replay(
    sync_creation, failure
):
    state = sync_creation
    accepted = []

    def accept_then_raise(*args, **kwargs):
        accepted.append(args[2]["source_id"])
        raise failure("private queue or polling failure")

    state.execute.side_effect = accept_then_raise
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((state.data, cast(UploadFile, object())))

    assert accepted == ["source:fixture"]
    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id is None
    assert "private" not in str(caught.value)
    assert_retained(state)
    state.execute.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "canceled"])
@pytest.mark.parametrize(
    "owner_phase", [None, "pending", "running", "succeeded", "failed"]
)
async def test_sync_non_success_retains_all_owner_states_for_inspection(
    sync_creation, status, owner_phase
):
    state = sync_creation
    if owner_phase:
        state.processed.processing_attempt = {
            "token": "attempt",
            "phase": owner_phase,
            **(
                {"command": "command:accepted", "owner": "worker"}
                if owner_phase != "pending"
                else {}
            ),
        }
    result = SimpleNamespace(
        is_success=lambda: False,
        status=status,
        command_id="command:unverified-result",
        error_message="private worker detail",
    )

    def record_effects_then_report_failure(*args, **kwargs):
        state.records["source:fixture"] = state.processed.model_copy(deep=True)
        return result

    state.execute.side_effect = record_effects_then_report_failure
    state.get.side_effect = ConnectionError("owner inspection unavailable")

    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((state.data, cast(UploadFile, object())))

    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id is None
    assert "private" not in str(caught.value)
    assert_retained(state)
    assert state.records["source:fixture"] == state.processed
    state.get.assert_not_awaited()
    state.execute.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure_stage", ["source_read", "missing_source", "chunks", "response"]
)
async def test_sync_completed_queue_read_failure_retains_inputs(
    sync_creation, monkeypatch, failure_stage
):
    state = sync_creation
    error = ConnectionError("private completed result read")
    if failure_stage == "source_read":
        state.get.side_effect = error
    elif failure_stage == "missing_source":
        state.get.side_effect = NotFoundError("private source identity")
    elif failure_stage == "chunks":
        state.chunks.side_effect = error
    else:
        monkeypatch.setattr(sources, "_source_to_response", Mock(side_effect=error))

    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await sources.create_source((state.data, cast(UploadFile, object())))

    assert caught.value.source_id == "source:fixture"
    assert caught.value.command_id is None
    assert_retained(state)
    state.execute.assert_called_once()


@pytest.mark.asyncio
async def test_sync_malformed_result_preserves_inputs(sync_creation):
    state = sync_creation
    state.execute.return_value = None
    with pytest.raises(CommandSubmissionUnknownError):
        await sources.create_source((state.data, cast(UploadFile, object())))
    assert_retained(state)
    state.execute.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure_stage", ["association", "poll", "failed_result", "source_read"]
)
async def test_sync_post_save_errors_have_safe_http_contract(
    sync_creation, failure_stage
):
    state = sync_creation
    error = ConnectionError("private /sensitive/path/credential")
    if failure_stage == "association":
        state.associate.side_effect = error
    elif failure_stage == "poll":
        state.execute.side_effect = error
    elif failure_stage == "failed_result":
        state.execute.return_value = SimpleNamespace(
            is_success=lambda: False,
            error_message=str(error),
            command_id="command:not-an-ownership-proof",
        )
    else:
        state.get.side_effect = error
    app = FastAPI()
    app.exception_handler(CommandSubmissionUnknownError)(
        command_submission_unknown_handler
    )
    app.include_router(sources.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://fixture"
    ) as client:
        response = await client.post(
            "/api/sources",
            data={
                "type": "upload",
                "notebook_id": "notebook:fixture",
                "async_processing": "false",
            },
            files={"file": ("original.txt", state.original, "text/plain")},
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "COMMAND_SUBMISSION_UNKNOWN"
    assert detail["retry_safe"] is False
    assert detail["resource_id"] == "source:fixture"
    assert detail["resource_type"] == "source"
    assert "command_id" not in detail and "job_id" not in detail
    assert "private" not in response.text and "sensitive" not in response.text
    assert_retained(state)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_stage", ["association", "sdk", "result", "read"])
async def test_sync_failure_boundary_does_not_log_private_details(
    sync_creation, failure_stage
):
    state = sync_creation
    private_detail = "private /sensitive/path/token=synthetic-secret"
    error = ConnectionError(private_detail)
    if failure_stage == "association":
        state.associate.side_effect = error
    elif failure_stage == "sdk":
        state.execute.side_effect = error
    elif failure_stage == "result":
        state.execute.return_value = SimpleNamespace(
            is_success=lambda: False, error_message=private_detail
        )
    else:
        state.get.side_effect = error
    messages: list[str] = []
    sink = sources.logger.add(messages.append, format="{message}")
    try:
        with pytest.raises(Exception):
            await sources.create_source((state.data, cast(UploadFile, object())))
    finally:
        sources.logger.remove(sink)

    for fragment in ("private", "/sensitive/path/", "synthetic-secret"):
        assert all(fragment not in message for message in messages)
    assert_retained(state)


@pytest.mark.asyncio
async def test_sync_cancellation_retains_inputs_while_owned_fake_thread_finishes(
    sync_creation,
):
    state = sync_creation
    started, release, finished = Event(), Event(), Event()
    completed_after_cancel = []

    def accepted_work(*args, **kwargs):
        started.set()
        try:
            if not release.wait(timeout=2):
                raise AssertionError("Fake worker was not released")
            completed_after_cancel.append(args[2]["source_id"])
            return SimpleNamespace(is_success=lambda: True)
        finally:
            finished.set()

    state.execute.side_effect = accepted_work
    request = asyncio.create_task(
        sources.create_source((state.data, cast(UploadFile, object())))
    )
    try:
        assert await asyncio.to_thread(started.wait, 2)
        request.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(request, timeout=2)
        assert not finished.is_set()
        assert_retained(state)
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 2)
        if not request.done():
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)
    assert completed_after_cancel == ["source:fixture"]
    assert_retained(state)
    state.execute.assert_called_once()


@pytest.mark.asyncio
async def test_sync_success_preserves_command_inputs_and_response(sync_creation):
    state = sync_creation
    state.data.transformations = ["transformation:fixture"]
    state.data.embed = True
    state.data.delete_source = True
    response = await sources.create_source((state.data, cast(UploadFile, object())))

    assert response.id == "source:fixture"
    assert response.full_text == "retained extracted text"
    assert response.embedded_chunks == 1
    assert response.embedded is True
    state.execute.assert_called_once()
    args = state.execute.call_args.args
    assert args[:2] == ("open_notebook", "process_source")
    assert args[2]["source_id"] == "source:fixture"
    assert args[2]["submission_token"] is None
    assert args[2]["notebook_ids"] == ["notebook:fixture"]
    assert args[2]["transformations"] == ["transformation:fixture"]
    assert args[2]["embed"] is True
    assert args[2]["content_state"] == {
        "file_path": str(state.path),
        "delete_source": True,
    }
    assert state.execute.call_args.kwargs == {"timeout": 300}
    assert_retained(state)
