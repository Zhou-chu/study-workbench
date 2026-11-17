"""NotebookLM configuration policy with client construction replaced."""

from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from open_notebook.integrations.notebooklm.sdk_adapter import sdk_client


@pytest.mark.asyncio
async def test_pinned_config_disables_hidden_mutation_retries(monkeypatch):
    from notebooklm import NotebookLMClient

    @asynccontextmanager
    async def construct(**kwargs):
        config = kwargs["config"]
        assert config.backend.kind == "web"
        assert config.retry.rate_limit_max_retries == 0
        assert config.retry.server_error_max_retries == 0
        yield "client"

    monkeypatch.setattr(NotebookLMClient, "from_storage", construct)
    async with sdk_client(Path("unused-synthetic-storage.json")) as client:
        assert client == "client"
