"""NotebookLM source decisions with memory-only stores and explicit doubles."""

import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore

from api.notebooklm_service import NotebookLMService


@pytest.mark.asyncio
async def test_same_title_never_creates_trusted_mapping(monkeypatch):
    store = MemoryStore()
    app = NotebookLMService(store=store, bridge=FakeBridge(), enqueue=None)

    async def local_source(*args):
        return "source:a"

    monkeypatch.setattr(app, "ensure_native_source", local_source)
    job = await app.create_job(
        "notebook:local",
        "import",
        {"remote_notebook_id": "nb", "remote_source_ids": ["a"], "include_text": False},
        "metadata",
    )
    result = await app.run_job(job["job_id"])
    assert result["state"] == "succeeded"
    link = (await store.list("source_link"))[0]
    assert link["source_version_id"] is None
    assert link["mapping_status"] == "unmapped"


@pytest.mark.asyncio
async def test_import_creates_missing_native_source_with_create_not_update(monkeypatch):
    from unittest.mock import AsyncMock

    import open_notebook.database.repository as repository
    from open_notebook.domain.notebook import Source
    from open_notebook.exceptions import NotFoundError

    queries = []

    async def query(sql, params=None):
        queries.append(sql)
        return []

    monkeypatch.setattr(Source, "get", AsyncMock(side_effect=NotFoundError("missing")))
    monkeypatch.setattr(repository, "repo_query", query)
    monkeypatch.setattr(repository, "repo_relate", AsyncMock(return_value=[]))
    app = NotebookLMService(store=MemoryStore(), bridge=FakeBridge(), enqueue=None)
    await app.ensure_native_source("notebook:local", "source:stable", "Snapshot")
    assert any("CREATE $source" in sql for sql in queries)


@pytest.mark.asyncio
async def test_remote_revision_change_invalidates_mapping_without_deleting_original():
    from open_notebook.integrations.notebooklm.contracts import RemoteSource

    store, bridge = MemoryStore(), FakeBridge()
    link = {
        "source_link_id": "sl",
        "notebook_id": "notebook:local",
        "remote_notebook_id": "nb",
        "remote_source_id": "a",
        "source_version_id": "sv",
        "mapping_method": "uploaded_original",
        "mapping_status": "verified",
        "remote_status": "ready",
        "remote_metadata": {"revision_id": "old"},
    }
    await store.put("source_link", "sl", link)
    bridge.sources[0] = RemoteSource(
        id="a", title="A", status="ready", revision_id="changed"
    )
    app = NotebookLMService(store=store, bridge=bridge, enqueue=None)
    await app.refresh_source_links("nb")
    updated = await store.get("source_link", "sl")
    assert updated["mapping_status"] == "stale"
    assert updated["source_version_id"] == "sv"
