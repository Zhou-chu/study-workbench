"""Notebook mutation ordering with fake query, lock and source operations."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_native_notebook_delete_invalidates_before_destructive_queries(
    monkeypatch,
):
    from open_notebook.database import evidence_embedding_repository as module
    from open_notebook.database import note_repository
    from open_notebook.domain import notebook as domain

    events = []

    async def invalidate(*args, **kwargs):
        events.append("invalidate")

    async def query(sql, params=None):
        if "DELETE" in sql:
            events.append("delete")
        return []

    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository, "invalidate_notebook_locked", invalidate
    )
    monkeypatch.setattr(domain, "repo_query", query)
    monkeypatch.setattr(domain.Notebook, "get_notes", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        domain.Notebook, "get_chat_sessions", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        note_repository, "delete_notebook_notes_locked", AsyncMock(return_value=0)
    )
    await domain.Notebook(
        id="notebook:allowed", name="one", description=""
    )._delete_locked()
    assert events[0] == "invalidate" and "delete" in events


@pytest.mark.asyncio
@pytest.mark.parametrize("source_fails", [False, True])
async def test_notebook_exclusive_source_deletion_uses_already_locked_boundary(
    monkeypatch, source_fails
):
    from open_notebook.database import evidence_embedding_repository as module
    from open_notebook.database import note_repository
    from open_notebook.domain import notebook as domain

    held = False
    events = []

    @asynccontextmanager
    async def mutation_lock(notebook_id):
        nonlocal held
        held = True
        try:
            yield
        finally:
            held = False
            events.append("unlock")

    async def query(sql, params=None):
        if "assigned_others" in sql:
            return [{"id": "source:one", "assigned_others": 0}]
        return []

    async def delete_source(*args, **kwargs):
        assert held, "Cascade must use its already-owned barrier"
        events.append("source_delete")
        if source_fails:
            raise RuntimeError("fixture cleanup failure")
        return True

    monkeypatch.setattr(note_repository, "notebook_mutation_locks", mutation_lock)
    monkeypatch.setattr(
        note_repository, "delete_notebook_notes_locked", AsyncMock(return_value=0)
    )
    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository, "invalidate_notebook_locked", AsyncMock()
    )
    monkeypatch.setattr(domain, "repo_query", query)
    monkeypatch.setattr(domain.Notebook, "get_notes", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        domain.Notebook, "get_chat_sessions", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        domain.Source,
        "get",
        AsyncMock(return_value=domain.Source(id="source:one", title="one")),
    )
    monkeypatch.setattr(
        domain.Source, "_delete_under_notebook_barrier", delete_source, raising=False
    )
    result = await domain.Notebook(
        id="notebook:allowed", name="one", description=""
    ).delete(delete_exclusive_sources=True)
    assert events == ["source_delete", "unlock"]
    assert result["deleted_sources"] == (0 if source_fails else 1)
