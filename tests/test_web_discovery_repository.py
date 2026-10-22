"""Opt-in isolated local SurrealDB acceptance; provider and worker stay mocked."""

import asyncio
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from api.evidence_service import EvidenceService
from api.personal_store import PersonalStore
from api.portable_service import PortableService
from api.web_discovery_contracts import WebImportRequest
from api.web_discovery_service import WebDiscoveryService
from open_notebook.database.repository import repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import InvalidInputError


@pytest.mark.skipif(
    not os.environ.get("WEB_DISCOVERY_TEST_DB"),
    reason="Requires explicitly isolated local test database",
)
@pytest.mark.asyncio
async def test_real_db_import_claim_native_source_version_export_and_deleted_replay(
    tmp_path, monkeypatch
):
    assert os.environ.get("SURREAL_URL", "").startswith("ws://127.0.0.1:")
    monkeypatch.setenv("SURREAL_DATABASE", "web_discovery_" + uuid4().hex)
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    notebook = Notebook(name="Synthetic web acceptance", description="No live provider")
    await notebook.save()
    store = PersonalStore()
    provider = AsyncMock()
    started, release = asyncio.Event(), asyncio.Event()

    async def scrape(url):
        started.set()
        await release.wait()
        return "# Synthetic article\n\nA retained Markdown snapshot is evidence, not original HTML."

    provider.scrape.side_effect = scrape
    service = WebDiscoveryService(
        store=store,
        provider=provider,
        submit=AsyncMock(return_value="command:synthetic"),
        validate=AsyncMock(),
        data_root=tmp_path,
        evidence=EvidenceService(store=store, data_root=tmp_path),
    )
    request = WebImportRequest(
        url="https://example.com/synthetic",
        title="Synthetic article",
        idempotency_key="one",
    )
    first_task = asyncio.create_task(service.import_source(notebook.id, request))
    await started.wait()
    with pytest.raises(InvalidInputError, match="WEB_IMPORT_IN_PROGRESS"):
        await service.import_source(
            notebook.id, request.model_copy(update={"idempotency_key": "concurrent"})
        )
    release.set()
    first = await first_task
    duplicate = await service.import_source(notebook.id, request)
    assert duplicate == first
    assert (await Source.get(first.source_id)).title == "Synthetic article"
    assert len(await repo_query("SELECT * FROM source;")) == 1
    assert len(await repo_query("SELECT * FROM reference;")) == 1
    assert len(await store.list("version", notebook.id)) == 1
    assert provider.scrape.await_count == 1
    extraction = await service.evidence.extract(first.source_version_id)
    assert extraction["status"] == "ready"
    archive = await PortableService(store=store, data_root=tmp_path).export_project(
        notebook.id
    )
    assert archive["path"].is_file()
    await (await Source.get(first.source_id)).delete()
    with pytest.raises(InvalidInputError, match="WEB_IMPORTED_SOURCE_UNAVAILABLE"):
        await service.import_source(notebook.id, request)
    assert provider.scrape.await_count == 1
