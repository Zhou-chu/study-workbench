"""SDK retry and Loguru integration keeps worker failure diagnostics visible."""

import pytest
from loguru import logger
from surreal_commands.core.registry import registry
from surreal_commands.core.retry import build_async_retry_instance

import commands  # noqa: F401 -- import registers the @command decorators


def _retry_config(command_id: str):
    item = registry.get_command_by_id(command_id)
    assert item is not None, f"{command_id} is not registered"
    assert item.retry_config is not None, f"{command_id} has no retry config"
    return item.retry_config


@pytest.mark.asyncio
async def test_retry_warning_includes_attempt_error_and_delay():
    config = _retry_config("open_notebook.run_transformation").model_copy(
        update={
            "max_attempts": 2,
            "wait_strategy": "fixed",
            "wait_time": 0,
            "wait_min": 0,
            "wait_max": 0,
        }
    )
    messages: list[str] = []
    sink_id = logger.add(lambda message: messages.append(str(message)), level="WARNING")

    try:
        with pytest.raises(ConnectionError):
            async for attempt in build_async_retry_instance(config):
                with attempt:
                    raise ConnectionError("provider temporarily unavailable")
    finally:
        logger.remove(sink_id)

    assert len(messages) == 1
    assert "[Retry] Attempt 1 failed with ConnectionError" in messages[0]
    assert "provider temporarily unavailable" in messages[0]
    assert "waiting 0.0s before retry 2" in messages[0]
