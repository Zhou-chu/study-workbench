import importlib
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_commands_do_one_step_without_worker_retry(monkeypatch):
    try:
        module = importlib.import_module("commands.notebooklm_commands")
    except ModuleNotFoundError:
        pytest.fail("NotebookLM worker commands are not registered")
    service = AsyncMock()
    service.run_job.return_value = {"job_id": "job1", "state": "waiting_remote"}
    service.poll_job.return_value = {"job_id": "job1", "state": "succeeded"}
    monkeypatch.setattr(module, "get_notebooklm_service", lambda: service)
    result = await module.notebooklm_execute(module.NotebookLMJobInput(job_id="job1"))
    assert result.state == "waiting_remote"
    result = await module.notebooklm_poll(module.NotebookLMJobInput(job_id="job1"))
    assert result.state == "succeeded"
    assert service.run_job.await_args.args == ("job1",)
    assert service.poll_job.await_args.args == ("job1",)

    from surreal_commands.core.registry import registry

    for name in ["notebooklm_execute", "notebooklm_poll"]:
        assert registry.get_command("open_notebook", name).retry_config is None
