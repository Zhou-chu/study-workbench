"""Offline cancellation contract at HTTP and deferred worker boundaries."""

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from v1_notebooklm_helpers import MemoryStore

from api.notebooklm_service import NotebookLMService
from api.personal_service import PersonalService
from api.routers import evidence, notebooklm
from open_notebook.exceptions import InvalidInputError


def client_for(store):
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = (
        lambda: NotebookLMService(store=store)
    )

    @app.exception_handler(InvalidInputError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("engine", ["independent", "notebooklm"])
@pytest.mark.parametrize("fails", [False, True])
async def test_running_chat_cancel_is_durable_and_never_replayed(
    monkeypatch, engine, fails
):
    store = MemoryStore()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def answer(*args, **kwargs):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        if fails:
            raise TimeoutError("late failure")
        return {"answer": "late answer", "status": "succeeded", "citations": []}

    if engine == "notebooklm":
        monkeypatch.setattr(NotebookLMService, "ask", answer)
    else:
        from open_notebook.graphs.grounded_chat import GroundedChatService

        monkeypatch.setattr(GroundedChatService, "turn", answer)
    service = PersonalService(store, AsyncMock(return_value="command:test"))
    request = {
        "notebook_id": "nb",
        "engine": engine,
        "message": "question",
        "idempotency_key": "once",
    }
    job = await service.submit_turn("session", request)
    worker = asyncio.create_task(service.run_turn(job["job_id"]))
    await asyncio.wait_for(entered.wait(), 3)
    try:
        async with client_for(store) as client:
            url = f"/api/personal/jobs/{job['job_id']}/cancel"
            result = (await client.post(url)).json()
            assert result["state"] == "cancelled_local"
            assert result["cancel_requested"] is True
            assert result["remote_may_continue"] is True
            assert (await client.post(url)).json() == result
    finally:
        release.set()
        await worker
    assert (await store.get("job", job["job_id"])) == result
    assert (await service.run_turn(job["job_id"])) == result
    assert (await service.submit_turn("session", request)) == result
    assert calls == 1
    if engine == "notebooklm":
        assert (await store.get("turn", job["turn_id"]))["status"] == (
            "failed" if fails else "succeeded"
        )


@pytest.mark.asyncio
async def test_queued_chat_cancel_prevents_provider_call(monkeypatch):
    store = MemoryStore()
    ask = AsyncMock()
    monkeypatch.setattr(NotebookLMService, "ask", ask)
    service = PersonalService(store, AsyncMock(return_value="command:test"))
    job = await service.submit_turn(
        "session",
        {
            "notebook_id": "nb",
            "engine": "notebooklm",
            "message": "q",
            "idempotency_key": "q",
        },
    )
    async with client_for(store) as client:
        result = (
            await client.post(f"/api/personal/jobs/{job['job_id']}/cancel")
        ).json()
    assert result["state"] == "cancelled_local"
    assert result["remote_may_continue"] is False
    assert (await service.run_turn(job["job_id"])) == result
    ask.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["reparse", "revalidate", "portable_export"])
async def test_running_cpu_job_rejects_cancel_explicitly(operation):
    store = MemoryStore()
    job = {
        "job_id": "cpu",
        "notebook_id": "nb",
        "operation": operation,
        "state": "running",
    }
    await store.put("job", "cpu", job)
    async with client_for(store) as client:
        response = await client.post("/api/personal/jobs/cpu/cancel")
    assert response.status_code == 400
    assert "CANCELLATION_UNSUPPORTED" in response.text
    assert await store.get("job", "cpu") == job


@pytest.mark.asyncio
@pytest.mark.parametrize("turn_state", ["running", "succeeded", "failed"])
async def test_events_prioritize_cancelled_wait_over_existing_turn(
    monkeypatch, turn_state
):
    store = MemoryStore()
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    await store.put(
        "job",
        "job",
        {"turn_id": "turn", "state": "cancelled_local", "remote_may_continue": True},
    )
    await store.put("turn", "turn", {"turn_id": "turn", "status": turn_state})
    response = await evidence.turn_events("turn")
    events = response.body_iterator
    first = await anext(events)
    assert '"state": "cancelled_local"' in first
    assert '"remote_may_continue": true' in first
    with pytest.raises(StopAsyncIteration):
        await anext(events)


@pytest.mark.asyncio
async def test_queued_export_cancel_prevents_archive_work(tmp_path):
    from api.portable_service import PortableService

    store = MemoryStore()
    await store.put(
        "job",
        "export",
        {
            "job_id": "export",
            "notebook_id": "nb",
            "operation": "portable_export",
            "state": "queued",
        },
    )
    async with client_for(store) as client:
        cancelled = (await client.post("/api/personal/jobs/export/cancel")).json()
    service = PortableService(store=store, data_root=tmp_path)
    with patch.object(
        service,
        "export_project",
        new=AsyncMock(side_effect=AssertionError("cancelled export ran")),
    ) as export_project:
        assert await service.run_export("export") == cancelled
        export_project.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state", ["succeeded", "failed", "submission_unknown", "cancelled_local"]
)
async def test_terminal_job_cancellation_is_unchanged(state):
    store = MemoryStore()
    job = {
        "job_id": "terminal",
        "notebook_id": "nb",
        "operation": "chat",
        "state": state,
    }
    await store.put("job", "terminal", job)
    async with client_for(store) as client:
        response = await client.post("/api/personal/jobs/terminal/cancel")
    assert response.status_code == 200
    assert response.json() == job
    assert await store.get("job", "terminal") == job


@pytest.mark.asyncio
async def test_cancel_rereads_after_worker_transition_under_project_lock():
    store = MemoryStore()
    await store.put(
        "job",
        "chat",
        {"job_id": "chat", "notebook_id": "nb", "operation": "chat", "state": "queued"},
    )
    async with client_for(store) as client:
        async with store.project_lock("nb"):
            request = asyncio.create_task(client.post("/api/personal/jobs/chat/cancel"))
            # Let the route read queued state and block on the worker's lock.
            await asyncio.sleep(0)
            current = await store.get("job", "chat")
            current.update(state="running", attempts=1)
            await store.put("job", "chat", current)
        result = (await request).json()
    assert result["state"] == "cancelled_local"
    assert result["remote_may_continue"] is True
    assert result["attempts"] == 1
