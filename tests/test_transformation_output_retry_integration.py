"""Exercise actual worker retry compatibility for incomplete model output."""

import pytest
from surreal_commands.core.registry import registry
from surreal_commands.core.retry import build_async_retry_instance

import commands  # noqa: F401 -- register worker retry policies
from open_notebook.exceptions import ExternalServiceError, IncompleteGenerationError


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "command_id",
    [
        "open_notebook.process_source",
        "open_notebook.run_transformation",
    ],
)
@pytest.mark.parametrize(
    "error, expected_attempts",
    [
        (IncompleteGenerationError("Incomplete output"), 1),
        (ExternalServiceError("Provider unavailable"), 3),
    ],
)
async def test_worker_retry_policy(command_id, error, expected_attempts):
    command = registry.get_command_by_id(command_id)
    config = command.retry_config.model_copy(
        update={
            "max_attempts": 3,
            "wait_strategy": "fixed",
            "wait_time": 0,
            "wait_min": 0,
            "wait_max": 0,
        }
    )
    attempts = 0
    with pytest.raises(type(error)):
        async for attempt in build_async_retry_instance(config):
            with attempt:
                attempts += 1
                raise error
    assert attempts == expected_attempts
