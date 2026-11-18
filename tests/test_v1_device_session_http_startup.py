"""Auth startup composes credentials, service and runtime over an in-memory store."""

import pytest
from device_session_core_fixtures import MemoryStore
from fastapi import FastAPI


@pytest.mark.asyncio
async def test_startup_runtime_is_fail_closed_and_new_epoch(monkeypatch):
    from api import device_session_repository
    from api.device_session_models import AuthError
    from api.device_session_runtime import initialize_device_auth

    class ReadyStore(MemoryStore):
        async def ready(self):
            self.check()

    store = ReadyStore()
    monkeypatch.setattr(
        device_session_repository, "SurrealDeviceSessionStore", lambda: store
    )
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "device_sessions")
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "https://app.example")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic")
    app = FastAPI()
    await initialize_device_auth(app)
    initial = app.state.device_auth_runtime.service
    pair = await initial.create_session("synthetic", "Test")
    await initialize_device_auth(app)
    restarted = app.state.device_auth_runtime.service
    assert initial is not restarted
    with pytest.raises(AuthError, match="Authentication required"):
        await restarted.authenticate_access(pair.access_token)
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "*")
    with pytest.raises(AuthError, match="Authentication unavailable"):
        await initialize_device_auth(FastAPI())
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "https://app.example")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD")
    with pytest.raises(AuthError, match="Authentication unavailable"):
        await initialize_device_auth(FastAPI())
