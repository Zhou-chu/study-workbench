"""Real domain wrappers reach the public DB boundary without starting lifespan."""

from collections.abc import Awaitable, Callable

import httpx
import pytest
from fastapi import FastAPI

from api.source_snapshot_contracts import SnapshotCommitRejected
from open_notebook.ai.models import Model
from open_notebook.domain import base, notebook
from open_notebook.exceptions import (
    AuthenticationError,
    CommandSubmissionUnknownError,
    ConfigurationError,
    DatabaseOperationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    NoteRevisionConflict,
    NoteRevisionRequired,
    NotFoundError,
    OpenNotebookError,
    RateLimitError,
    UnsupportedCapabilityError,
    UnsupportedTypeException,
    UploadCommitUnknownError,
)

PAYLOAD = (
    "host=synthetic.private token=secret-token /private/document.txt document-body"
)


async def request_failure(action: Callable[[], Awaitable[object]], origin=None):
    from api.main import app as production_app

    # Copy the actual registered handlers, but not lifespan, middleware or services.
    app = FastAPI()
    app.exception_handlers.update(production_app.exception_handlers)

    @app.get("/failure")
    async def fail():
        return await action()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.get(
            "/failure", headers={"Origin": origin} if origin else {}
        )


@pytest.mark.asyncio
async def test_workspace_db_wrapper_has_fixed_public_detail(monkeypatch):
    async def failed_query(*args, **kwargs):
        raise OSError(PAYLOAD)

    monkeypatch.setattr(notebook, "repo_query", failed_query)
    workspace = notebook.Notebook(
        id="notebook:private-id", name="Private", description=""
    )
    response = await request_failure(workspace.get_sources)

    assert response.status_code == 500
    assert response.json() == {"detail": "Database operation failed"}
    assert PAYLOAD not in response.text


@pytest.mark.asyncio
async def test_models_db_wrapper_has_fixed_public_detail(monkeypatch):
    async def failed_query(*args, **kwargs):
        raise OSError(PAYLOAD)

    monkeypatch.setattr(base, "repo_query", failed_query)
    response = await request_failure(Model.get_all)
    assert response.status_code == 500
    assert response.json() == {"detail": "Database operation failed"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_class", [DatabaseOperationError, SnapshotCommitRejected]
)
async def test_database_error_and_subclass_have_fixed_detail(error_class):
    async def fail():
        raise error_class(PAYLOAD) from ValueError(PAYLOAD)

    response = await request_failure(fail)
    assert response.status_code == 500
    assert response.json() == {"detail": "Database operation failed"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_class,status",
    [
        (NotFoundError, 404),
        (InvalidInputError, 400),
        (AuthenticationError, 401),
        (UnsupportedTypeException, 415),
        (ConfigurationError, 422),
        (RateLimitError, 429),
        (NetworkError, 502),
        (ExternalServiceError, 502),
        (UnsupportedCapabilityError, 501),
        (OpenNotebookError, 500),
    ],
)
async def test_non_database_typed_errors_keep_their_public_contract(
    error_class, status
):
    async def fail():
        raise error_class("Deliberate public message")

    response = await request_failure(fail)
    assert response.status_code == status
    assert response.json() == {"detail": "Deliberate public message"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,status,detail",
    [
        (
            NoteRevisionConflict(7),
            409,
            {"code": "NOTE_REVISION_CONFLICT", "current_revision": 7},
        ),
        (NoteRevisionRequired(), 428, {"code": "NOTE_REVISION_REQUIRED"}),
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
async def test_specific_receipts_are_not_hidden_by_database_handler(
    error, status, detail
):
    async def fail():
        raise error

    response = await request_failure(fail)
    assert response.status_code == status
    assert response.json() == {"detail": detail}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "allowed,origin,expected",
    [
        (["*"], "https://allowed.example", "https://allowed.example"),
        (
            ["https://allowed.example"],
            "https://allowed.example",
            "https://allowed.example",
        ),
        (["https://allowed.example"], "https://other.example", None),
    ],
)
async def test_database_error_keeps_cors_rules(monkeypatch, allowed, origin, expected):
    from api import main

    monkeypatch.setattr(main, "CORS_ALLOWED_ORIGINS", allowed)
    monkeypatch.setattr(main, "CORS_ALLOW_CREDENTIALS", "*" not in allowed)

    async def fail():
        raise DatabaseOperationError(PAYLOAD)

    response = await request_failure(fail, origin)
    assert response.status_code == 500
    assert response.headers.get("access-control-allow-origin") == expected
    assert response.headers.get("access-control-allow-credentials") == (
        "true" if "*" not in allowed else None
    )
