import asyncio
import threading

import pytest

from open_notebook.integrations.notebooklm.sdk_adapter import _asset_file_operation


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
@pytest.mark.parametrize("cancel_count", [1, 3])
async def test_cancellation_wins_after_owned_worker_finishes(fail, cancel_count):
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    def work():
        entered.set()
        assert release.wait(3)
        finished.set()
        if fail:
            raise OSError("synthetic worker failure")
        return "must not be returned"

    task = asyncio.create_task(_asset_file_operation(work))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        for index in range(cancel_count):
            task.cancel(f"cancel-{index}")
            await asyncio.sleep(0)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert task.cancelled()
        assert finished.is_set()
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
