"""Unsupported generic commands fail honestly without touching the backend."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI

from api import command_service
from api.auth import PasswordAuthMiddleware
from api.command_service import CommandService
from api.routers import commands
from open_notebook.exceptions import OpenNotebookError

CASES = [
    (
        "list_command_jobs",
        (),
        "GET",
        "/api/commands/jobs",
        "GENERIC_COMMAND_LISTING_UNSUPPORTED",
    ),
    (
        "cancel_command_job",
        ("command:fixture",),
        "DELETE",
        "/api/commands/jobs/command:fixture",
        "GENERIC_COMMAND_CANCELLATION_UNSUPPORTED",
    ),
]


@pytest.fixture
def backend(monkeypatch):
    submit = Mock(side_effect=AssertionError("unexpected submission"))
    status = AsyncMock(side_effect=AssertionError("unexpected status lookup"))
    monkeypatch.setattr(command_service, "submit_command", submit)
    monkeypatch.setattr(command_service, "get_command_status", status)
    return submit, status


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
async def test_unsupported_service_raises_typed_capability_error(
    backend, name, args, method, path, code
):
    with pytest.raises(OpenNotebookError, match=f"^{code}$") as raised:
        await getattr(CommandService, name)(*args)
    assert type(raised.value).__name__ == "UnsupportedCapabilityError"
    for dependency in backend:
        dependency.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
async def test_router_propagates_capability_error(
    backend, name, args, method, path, code
):
    with pytest.raises(OpenNotebookError, match=f"^{code}$"):
        await getattr(commands, name)(*args)


def app_for(monkeypatch):
    # Reuse production error mappings without starting app lifespan/migrations.
    from api.main import app as main_app

    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "legacy_password")
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic-test-password")
    app = FastAPI()
    app.include_router(commands.router, prefix="/api")
    for error, handler in main_app.exception_handlers.items():
        app.add_exception_handler(error, handler)
    app.add_middleware(PasswordAuthMiddleware)
    return app


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
async def test_http_501_not_empty_list_or_false_cancellation(
    monkeypatch, backend, name, args, method, path, code
):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(monkeypatch)), base_url="http://test"
    ) as client:
        response = await client.request(
            method, path, headers={"Authorization": "Bearer synthetic-test-password"}
        )
    assert response.status_code == 501
    assert response.json() == {"detail": code}
    for dependency in backend:
        dependency.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
@pytest.mark.parametrize("authorization", [None, "Bearer incorrect"])
async def test_auth_rejects_before_unsupported_service(
    monkeypatch, backend, name, args, method, path, code, authorization
):
    service = AsyncMock(side_effect=AssertionError("unauthorized service call"))
    monkeypatch.setattr(CommandService, name, service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(monkeypatch)), base_url="http://test"
    ) as client:
        response = await client.request(
            method,
            path,
            headers={"Authorization": authorization} if authorization else {},
        )
    assert response.status_code == 401
    service.assert_not_called()


@pytest.mark.asyncio
async def test_generic_submission_and_status_remain_available(monkeypatch):
    # Import registration only; the actual submission/status backends are mocked.
    submit = Mock(return_value="command:fixture")
    status = AsyncMock(return_value=SimpleNamespace(status="running", result=None))
    monkeypatch.setattr(command_service, "submit_command", submit)
    monkeypatch.setattr(command_service, "get_command_status", status)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app_for(monkeypatch)),
        base_url="http://test",
        headers={"Authorization": "Bearer synthetic-test-password"},
    ) as client:
        response = await client.post(
            "/api/commands/jobs",
            json={"app": "open_notebook", "command": "generate_podcast", "input": {}},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
        response = await client.get("/api/commands/jobs/command:fixture")
        assert response.status_code == 200
        assert response.json()["status"] == "running"
    submit.assert_called_once_with("open_notebook", "generate_podcast", {})
    status.assert_awaited_once_with("command:fixture")


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,method,path,code", CASES)
@pytest.mark.parametrize("authenticated", [False, True])
async def test_device_auth_boundary_without_issuing_credentials(
    monkeypatch, backend, name, args, method, path, code, authenticated
):
    from api.device_session_models import AuthError
    from api.device_session_runtime import DeviceAuthRuntime
    from api.device_session_service import DeviceSessionService

    app = app_for(monkeypatch)
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "device_sessions")
    authenticate = AsyncMock(
        return_value=object(),
        side_effect=None if authenticated else AuthError("AUTH_REQUIRED"),
    )
    app.state.device_auth_runtime = DeviceAuthRuntime(
        "device_sessions",
        Mock(spec=DeviceSessionService, authenticate_access=authenticate),
        frozenset({"https://test.example"}),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.request(
            method, path, headers={"Authorization": "Bearer synthetic-not-a-token"}
        )
    assert response.status_code == (501 if authenticated else 401)
    if authenticated:
        assert response.json() == {"detail": code}
    else:
        assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    authenticate.assert_awaited_once_with("synthetic-not-a-token")
    for dependency in backend:
        dependency.assert_not_called()
