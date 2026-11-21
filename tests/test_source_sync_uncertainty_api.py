"""Real ASGI post-save failure output with disposable upload fixtures."""

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from source_sync_uncertainty_fixtures import assert_retained
from source_sync_uncertainty_fixtures import sync_creation as _sync_creation

from api.main import command_submission_unknown_handler
from api.routers import sources
from open_notebook.exceptions import CommandSubmissionUnknownError

sync_creation = _sync_creation


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
