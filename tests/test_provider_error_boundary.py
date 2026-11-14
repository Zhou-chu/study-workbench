"""Real Ask wrappers and registered handlers, with synthetic provider seams only."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from langchain_core.runnables import RunnableConfig

from open_notebook.exceptions import (
    CommandSubmissionUnknownError,
    ConfigurationError,
    ExternalServiceError,
    OpenNotebookError,
    UploadCommitUnknownError,
)
from open_notebook.graphs import ask

PAYLOAD = "token=synthetic-secret /private/document.txt document-body"
EMPTY_CONFIG = cast(RunnableConfig, {"configurable": {}})


async def request_failure(action: Callable[[], Awaitable[object]]):
    from api.main import app as production_app

    # The real handler registrations, not application lifespan/services/middleware.
    app = FastAPI()
    app.exception_handlers.update(production_app.exception_handlers)

    @app.get("/failure")
    async def fail():
        return await action()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.get("/failure")


def failing_model(monkeypatch, error):
    model = MagicMock()
    model.ainvoke = AsyncMock(side_effect=error)
    provision = AsyncMock(return_value=model)
    monkeypatch.setattr(ask, "provision_langchain_model", provision)
    return provision, model.ainvoke


@pytest.mark.asyncio
@pytest.mark.parametrize("padding", ["", "x" * 400], ids=["short", "long"])
@pytest.mark.parametrize(
    "prefix,expected_class,status,detail",
    [
        (
            "model not found",
            ConfigurationError,
            422,
            "The selected AI model is unavailable. Please check your model configuration in Manage -> Models.",
        ),
        (
            "no model configured",
            ConfigurationError,
            422,
            "No AI model is configured for this operation. Please configure a default model in Manage -> Models.",
        ),
        (
            "unrecognized provider failure",
            ExternalServiceError,
            502,
            "The AI service could not complete the request. Please try again later.",
        ),
    ],
)
async def test_ask_classified_error_keeps_cause_and_handler_status(
    monkeypatch, prefix, expected_class, status, detail, padding
):
    original = ValueError(f"{prefix}: {PAYLOAD} {padding} {PAYLOAD}")
    provision, invoke = failing_model(monkeypatch, original)

    async def action():
        with pytest.raises(expected_class) as caught:
            await ask.call_model_with_messages(
                cast(ask.ThreadState, {"question": "synthetic question"}),
                EMPTY_CONFIG,
            )
        assert type(caught.value) is expected_class
        assert caught.value.__cause__ is original
        raise caught.value

    response = await request_failure(action)
    assert response.status_code == status
    assert response.json() == {"detail": detail}
    for forbidden in (PAYLOAD, "synthetic-secret", "/private/", "document-body"):
        assert forbidden not in response.text
    provision.assert_awaited_once()
    invoke.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,status,detail",
    [
        (
            CommandSubmissionUnknownError(
                source_id="source:existing", command_id="command:existing"
            ),
            409,
            {
                "code": "COMMAND_SUBMISSION_UNKNOWN",
                "message": "Submission may already be accepted. Do not retry; check existing work first.",
                "retry_safe": False,
                "resource_id": "source:existing",
                "resource_type": "source",
                "command_id": "command:existing",
            },
        ),
        (
            CommandSubmissionUnknownError(
                resource_id="episode:existing", resource_type="episode"
            ),
            409,
            {
                "code": "COMMAND_SUBMISSION_UNKNOWN",
                "message": "Submission may already be accepted. Do not retry; check existing work first.",
                "retry_safe": False,
                "resource_id": "episode:existing",
                "resource_type": "episode",
            },
        ),
        (
            UploadCommitUnknownError(
                source_id="source:existing", source_version_id="version_existing"
            ),
            500,
            {
                "code": "UPLOAD_COMMIT_UNKNOWN",
                "message": "Upload may already be saved. Do not retry; inspect the existing source before taking further action.",
                "retry_safe": False,
                "source_id": "source:existing",
                "source_version_id": "version_existing",
            },
        ),
    ],
)
async def test_ask_preserves_keyword_only_typed_uncertainty_receipts(
    monkeypatch, error, status, detail
):
    cause = ValueError(PAYLOAD)
    error.__cause__ = cause
    attributes = vars(error).copy()
    provision, invoke = failing_model(monkeypatch, error)

    async def action():
        with pytest.raises(OpenNotebookError) as caught:
            await ask.call_model_with_messages(
                cast(ask.ThreadState, {"question": "synthetic question"}),
                EMPTY_CONFIG,
            )
        assert caught.value is error
        assert caught.value.__cause__ is cause
        assert vars(caught.value) == attributes
        raise caught.value

    response = await request_failure(action)
    assert response.status_code == status
    assert response.json() == {"detail": detail}
    assert PAYLOAD not in response.text
    provision.assert_awaited_once()
    invoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_ask_does_not_reclassify_or_repeat_cancellation(monkeypatch):
    original = asyncio.CancelledError(PAYLOAD)
    provision, invoke = failing_model(monkeypatch, original)
    with pytest.raises(asyncio.CancelledError) as caught:
        await ask.call_model_with_messages(
            cast(ask.ThreadState, {"question": "synthetic question"}), EMPTY_CONFIG
        )
    assert caught.value is original
    provision.assert_awaited_once()
    invoke.assert_awaited_once()
