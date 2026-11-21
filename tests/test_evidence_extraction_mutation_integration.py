"""Source mutation workflows using files and collaborating production owners."""

from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary,hook",
    [
        ("delete", "source_deletion_barrier"),
        ("_delete_under_notebook_barrier", "invalidate_source_locked"),
    ],
)
async def test_native_source_delete_invalidates_before_file_or_native_delete(
    monkeypatch, tmp_path, boundary, hook
):
    from open_notebook.database import evidence_embedding_repository as module
    from open_notebook.domain import notebook as domain

    events = []
    file = tmp_path / "source.txt"
    file.write_text("original")

    async def invalidate(*args, **kwargs):
        assert file.exists()
        events.append("invalidate")

    async def native_delete(self):
        events.append("native_delete")
        return True

    @asynccontextmanager
    async def barrier(*args, **kwargs):
        await invalidate(*args, **kwargs)
        yield

    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository,
        hook,
        barrier if boundary == "delete" else invalidate,
    )
    monkeypatch.setattr(domain, "repo_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(domain.Source.__bases__[0], "delete", native_delete)
    source = domain.Source(
        id="source:one", title="one", asset=domain.Asset(file_path=str(file))
    )
    assert await getattr(source, boundary)()
    assert events == ["invalidate", "native_delete"]
    assert not file.exists()


@pytest.mark.asyncio
async def test_router_unlink_invalidates_before_reference_delete(monkeypatch, tmp_path):
    from api.routers import notebooks
    from open_notebook.database import evidence_embedding_repository as module

    events = []
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notebooks.Notebook, "get", AsyncMock())

    async def invalidate(*args, **kwargs):
        events.append("invalidate")

    async def query(sql, params=None):
        assert "DELETE FROM reference" in sql
        events.append("delete")
        return []

    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository, "invalidate_source", invalidate
    )
    monkeypatch.setattr(notebooks, "repo_query", query)
    await notebooks.remove_source_from_notebook("notebook:allowed", "source:one")
    assert events == ["invalidate", "delete"]


@pytest.mark.asyncio
async def test_reparse_revokes_epoch_before_publication_and_keeps_original(
    monkeypatch, tmp_path
):
    from test_v1_evidence_ingest import MemoryStore

    from api.evidence_service import EvidenceService

    events: list[tuple[Any, ...]] = []

    class IndexedStore(MemoryStore):
        async def invalidate_evidence_scope(self, notebook_id, version_ids, reason):
            events.append(("invalidate", notebook_id, version_ids, reason))

        async def put(self, kind, identity, value, create_only=False):
            if kind == "version" and value.get("status") == "extracting":
                events.append(("extracting",))
            return await super().put(kind, identity, value, create_only)

    store = IndexedStore()
    service = EvidenceService(store=store, data_root=tmp_path)
    version = await service.ingest(
        "notebook:allowed", "source:one", "one", b"Keep original.", filename="one.md"
    )
    await service.extract(version["source_version_id"])
    events.clear()
    original = await service.resolve_file(version["source_version_id"])
    await service.extract(version["source_version_id"], force=True)
    assert events[0][0] == "invalidate" and events[1][0] == "extracting"
    assert original.read_bytes() == b"Keep original."


@pytest.mark.asyncio
async def test_reparse_invalidation_failure_prevents_any_new_extraction_state(tmp_path):
    from test_v1_evidence_ingest import MemoryStore

    from api.evidence_service import EvidenceService

    class IndexedStore(MemoryStore):
        async def invalidate_evidence_scope(self, *args):
            raise RuntimeError("fixture invalidation unavailable")

    store = IndexedStore()
    service = EvidenceService(store=store, data_root=tmp_path)
    version = await service.ingest(
        "notebook:allowed", "source:one", "one", b"Original.", filename="one.md"
    )
    await service.extract(version["source_version_id"])
    old = deepcopy(store.data)
    with pytest.raises(RuntimeError, match="invalidation unavailable"):
        await service.extract(version["source_version_id"], force=True)
    assert store.data == old


@pytest.mark.asyncio
async def test_failed_native_revocation_preserves_original_and_native_source(
    monkeypatch, tmp_path
):
    from open_notebook.database import evidence_embedding_repository as module
    from open_notebook.domain import notebook as domain

    file = tmp_path / "source.txt"
    file.write_text("original")
    native_delete = AsyncMock()
    monkeypatch.setattr(domain, "repo_query", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        module.EvidenceEmbeddingRepository,
        "_invalidate_scopes",
        AsyncMock(side_effect=RuntimeError("revocation unavailable")),
    )
    monkeypatch.setattr(domain.Source.__bases__[0], "delete", native_delete)
    source = domain.Source(
        id="source:one", title="one", asset=domain.Asset(file_path=str(file))
    )
    with pytest.raises(RuntimeError, match="revocation unavailable"):
        await source.delete()
    assert file.read_text() == "original"
    native_delete.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_phase", ["invalidate", "delete"])
async def test_unlink_query_diagnostics_never_reach_logs_or_http_detail(
    monkeypatch, tmp_path, failure_phase
):
    from fastapi import HTTPException
    from loguru import logger

    from api.routers import notebooks

    marker = "SYNTHETIC_PRIVATE_DB_BODY"
    messages = []
    sink = logger.add(lambda message: messages.append(str(message)))
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(notebooks.Notebook, "get", AsyncMock())

    async def query(sql, params=None):
        if (failure_phase == "invalidate" and "invalidate-versions" in sql) or (
            failure_phase == "delete" and "DELETE FROM reference" in sql
        ):
            raise RuntimeError(marker)
        return []

    monkeypatch.setattr(notebooks, "repo_query", query)
    try:
        with pytest.raises(Exception) as caught:
            await notebooks.remove_source_from_notebook(
                "notebook:allowed", "source:one"
            )
        detail = (
            caught.value.detail
            if isinstance(caught.value, HTTPException)
            else str(caught.value)
        )
        assert marker not in detail and marker not in "".join(messages)
        assert caught.value.__cause__ is None and caught.value.__context__ is None
    finally:
        logger.remove(sink)


@pytest.mark.asyncio
@pytest.mark.parametrize("error_name", ["InvalidInputError", "DatabaseOperationError"])
@pytest.mark.parametrize("chain", ["cause", "context"])
@pytest.mark.parametrize("entry", ["repository", "unlink"])
async def test_known_safe_query_error_is_reconstructed_without_diagnostic_chain(
    monkeypatch, tmp_path, error_name, chain, entry
):
    import traceback

    from loguru import logger

    from api.routers import notebooks
    from open_notebook import exceptions
    from open_notebook.database.evidence_embedding_repository import (
        EvidenceEmbeddingRepository,
    )

    error_class = getattr(exceptions, error_name)
    safe_message = (
        "SCOPE_CHANGED: evidence index prerequisites changed or are unavailable"
    )
    marker = "SYNTHETIC_PRIVATE_DB_CHAIN"
    original_errors = []
    messages = []

    async def wrapped_query(sql, params=None):
        try:
            raise RuntimeError(marker)
        except RuntimeError as raw:
            wrapped = error_class(safe_message)
            original_errors.append(wrapped)
            if chain == "cause":
                raise wrapped from raw
            raise wrapped

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    sink = logger.add(lambda message: messages.append(str(message)))
    try:
        with pytest.raises(error_class) as caught:
            if entry == "repository":
                await EvidenceEmbeddingRepository(query=wrapped_query).capture_scope(
                    "notebook:allowed", ["v1"]
                )
            else:
                monkeypatch.setattr(notebooks.Notebook, "get", AsyncMock())
                monkeypatch.setattr(notebooks, "repo_query", wrapped_query)
                await notebooks.remove_source_from_notebook(
                    "notebook:allowed", "source:one"
                )
        assert str(caught.value) == safe_message
        assert type(caught.value) is error_class
        assert caught.value is not original_errors[0]
        assert caught.value.__cause__ is None and caught.value.__context__ is None
        assert marker not in "".join(traceback.format_exception(caught.value))
        assert marker not in "".join(messages)
    finally:
        logger.remove(sink)
