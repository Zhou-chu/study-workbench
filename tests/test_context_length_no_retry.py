"""Retry registry and SDK/tenacity integration for context-length rejections.

Companion test_context_length_classification_unit.py verifies the classifier
separately; this file drives actual registered retry configuration and execution.
"""

import pytest
from surreal_commands.core.registry import registry
from surreal_commands.core.retry import build_async_retry_instance

import commands  # noqa: F401  -- import registers the @command decorators
from open_notebook.exceptions import ContextLengthExceededError

# Commands whose retry config must treat context-length errors as permanent.
RETRY_COMMANDS = [
    "open_notebook.process_source",
    "open_notebook.run_transformation",
]


def _retry_config(command_id: str):
    """The live retry config the worker would actually use for this command."""
    item = registry.get_command_by_id(command_id)
    assert item is not None, f"{command_id} is not registered"
    assert item.retry_config is not None, f"{command_id} has no retry config"
    return item.retry_config


def _instant(config):
    """Same config, but without the real backoff, so tests don't sleep."""
    return config.model_copy(
        update={"wait_strategy": "fixed", "wait_time": 0, "wait_min": 0, "wait_max": 0}
    )


async def _count_attempts(config, exc: Exception) -> int:
    """Drive the real tenacity instance and report how many attempts it made."""
    attempts = 0
    retrying = build_async_retry_instance(_instant(config))
    with pytest.raises(type(exc)):
        async for attempt in retrying:
            with attempt:
                attempts += 1
                raise exc
    return attempts


@pytest.mark.parametrize("command_id", RETRY_COMMANDS)
class TestRetryBehaviour:
    def test_stop_on_lists_context_length(self, command_id):
        assert ContextLengthExceededError in _retry_config(command_id).stop_on

    @pytest.mark.asyncio
    async def test_context_length_is_attempted_once(self, command_id):
        config = _retry_config(command_id)

        attempts = await _count_attempts(
            config, ContextLengthExceededError("Content too large")
        )

        assert attempts == 1, (
            f"{command_id} retried a deterministic context-length failure "
            f"{attempts} times; it must fail after the first attempt (#1231)"
        )

    @pytest.mark.asyncio
    async def test_transient_error_still_uses_full_budget(self, command_id):
        """Proves the fix narrows retries rather than disabling them."""
        config = _retry_config(command_id)

        attempts = await _count_attempts(
            config, RuntimeError("Failed to commit transaction due to a conflict")
        )

        assert attempts == config.max_attempts
