import asyncio
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_parent", [False, True])
async def test_shutdown_preserves_parent_cancellation(monkeypatch, cancel_parent):
    from api import device_session_runtime, main, notebooklm_service

    monkeypatch.setattr(main, "_run_database_migrations", AsyncMock())
    monkeypatch.setattr(device_session_runtime, "initialize_device_auth", AsyncMock())
    started, cleaning, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def dispatch():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaning.set()
            await release.wait()

    monkeypatch.setattr(notebooklm_service, "dispatch_due_jobs", dispatch)

    async def run():
        async with main.lifespan(None):
            await started.wait()

    task = asyncio.create_task(run())
    try:
        await asyncio.wait_for(cleaning.wait(), 2)
        if cancel_parent:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            release.set()
            await task
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_cancellation_inside_lifespan_body_is_preserved(monkeypatch):
    from api import device_session_runtime, main, notebooklm_service

    monkeypatch.setattr(main, "_run_database_migrations", AsyncMock())
    monkeypatch.setattr(device_session_runtime, "initialize_device_auth", AsyncMock())
    started = asyncio.Event()
    cleaned = asyncio.Event()

    async def dispatch():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    monkeypatch.setattr(notebooklm_service, "dispatch_due_jobs", dispatch)

    async def run():
        async with main.lifespan(None):
            await asyncio.Event().wait()

    task = asyncio.create_task(run())
    try:
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned.is_set()
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
