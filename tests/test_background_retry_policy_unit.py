"""Registered background retry policy decisions without SDK retry execution."""

import pytest
from surreal_commands.core.registry import registry

import commands  # noqa: F401 -- import registers the @command decorators

VISIBLE_RETRY_COMMANDS = [
    "open_notebook.run_transformation",
    "open_notebook.embed_note",
    "open_notebook.embed_insight",
    "open_notebook.embed_source",
    "open_notebook.create_insight",
]


def _retry_config(command_id: str):
    item = registry.get_command_by_id(command_id)
    assert item is not None, f"{command_id} is not registered"
    assert item.retry_config is not None, f"{command_id} has no retry config"
    return item.retry_config


@pytest.mark.parametrize("command_id", VISIBLE_RETRY_COMMANDS)
def test_background_retry_is_logged_at_warning(command_id):
    assert _retry_config(command_id).retry_log_level.value == "warning"
