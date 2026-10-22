"""Generate first and publish once; failures must never trigger a broad cleanup."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from commands import embedding_commands as commands


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", [ConnectionError("lost ACK"), RuntimeError("aborted")]
)
async def test_publication_failure_has_no_cleanup(monkeypatch, failure):
    source = SimpleNamespace(full_text="original content", asset=None, created=None)
    monkeypatch.setattr(commands.Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(commands, "chunk_text", lambda *a, **kw: ["chunk"] * 120)
    monkeypatch.setattr(
        commands, "generate_embeddings", AsyncMock(return_value=[[1.0]] * 120)
    )
    publish = AsyncMock(side_effect=failure)
    monkeypatch.setattr(commands, "publish_source_embeddings", publish)
    cleanup = AsyncMock()
    monkeypatch.setattr(commands, "repo_query", cleanup)
    with pytest.raises(type(failure)):
        await commands.embed_source_command(
            commands.EmbedSourceInput(source_id="source:test")
        )
    assert publish.await_count == 1
    assert len(publish.call_args.args[-1]) == 120
    cleanup.assert_not_awaited()


@pytest.mark.asyncio
async def test_count_mismatch_never_publishes(monkeypatch):
    monkeypatch.setattr(
        commands.Source,
        "get",
        AsyncMock(return_value=SimpleNamespace(full_text="text", asset=None)),
    )
    monkeypatch.setattr(commands, "chunk_text", lambda *a, **kw: ["a", "b"])
    monkeypatch.setattr(
        commands, "generate_embeddings", AsyncMock(return_value=[[1.0]])
    )
    publish = AsyncMock()
    monkeypatch.setattr(commands, "publish_source_embeddings", publish)
    result = await commands.embed_source_command(
        commands.EmbedSourceInput(source_id="source:test")
    )
    assert result.success is False
    publish.assert_not_awaited()
