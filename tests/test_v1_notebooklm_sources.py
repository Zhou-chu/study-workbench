import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore

from api.evidence_service import EvidenceService
from api.notebooklm_service import NotebookLMService
from open_notebook.integrations.notebooklm.contracts import (
    RemoteSourcePage,
    RemoteTextResult,
)


@pytest.mark.asyncio
async def test_paginated_import_reports_missing_originals_and_partial_failure(
    tmp_path, monkeypatch
):
    class Bridge(FakeBridge):
        async def list_sources(self, nb, cursor=None):
            if cursor is None:
                return RemoteSourcePage(
                    items=[self.sources[0]], next_cursor="page2", listing_complete=False
                )
            return RemoteSourcePage(items=[self.sources[1]])

        async def fetch_source_text(self, req):
            if req.remote_source_id == "b":
                raise TimeoutError("read failed")
            return RemoteTextResult(
                remote_source_id="a",
                title="A",
                content="The snapshot is only extracted text.",
            )

    store = MemoryStore()
    evidence = EvidenceService(store, tmp_path)
    app = NotebookLMService(
        store=store, bridge=Bridge(), evidence=evidence, enqueue=None
    )

    async def local_source(notebook_id, source_id, title):
        return source_id

    monkeypatch.setattr(app, "ensure_native_source", local_source)
    job = await app.create_job(
        "notebook:local",
        "import",
        {
            "remote_notebook_id": "nb",
            "remote_source_ids": ["a", "b"],
            "include_text": True,
        },
        "import",
    )
    done = await app.run_job(job["job_id"])
    assert done["state"] == "succeeded"
    report = done["result"]["import_report"]
    assert report["requested"] == ["a", "b"]
    assert report["imported"] == ["a"]
    assert report["failed"][0]["remote_source_id"] == "b"
    assert report["missing_originals"] == ["a", "b"]
    assert report["pagination_complete"] is True
    versions = await store.list("version")
    assert len(versions) == 1
    assert versions[0]["origin"] == "remote_text_snapshot"
    assert versions[0]["original_status"] == "missing"


@pytest.mark.asyncio
async def test_sync_maps_actual_returned_id_to_immutable_version_and_deduplicates(
    tmp_path,
):
    store, bridge = MemoryStore(), FakeBridge()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "notebook:local", "source:one", "A.txt", b"Original", mime_type="text/plain"
    )
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    req = {
        "remote_notebook_id": "nb",
        "source_version_ids": [version["source_version_id"]],
    }
    job = await app.create_job("notebook:local", "sync", req, "sync")
    result = await app.run_job(job["job_id"])
    assert result["state"] == "succeeded"
    links = await store.list("source_link")
    assert links[0]["remote_source_id"] == "uploaded-" + version["source_version_id"]
    assert links[0]["mapping_method"] == "uploaded_original"
    assert links[0]["mapping_status"] == "verified"
    second = await app.create_job(
        "notebook:local", "sync", req, "another-explicit-click"
    )
    await app.run_job(second["job_id"])
    assert bridge.upload_calls == 1


@pytest.mark.asyncio
async def test_sync_rejects_versions_owned_by_other_notebook(tmp_path):
    store = MemoryStore()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "notebook:other", "source:one", "A.txt", b"Original", mime_type="text/plain"
    )
    bridge = FakeBridge()
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    job = await app.create_job(
        "notebook:local",
        "sync",
        {
            "remote_notebook_id": "nb",
            "source_version_ids": [version["source_version_id"]],
        },
        "cross-project",
    )
    result = await app.run_job(job["job_id"])
    assert result["state"] == "failed"
    assert result["error"]["code"] == "INVALID_REQUEST"
    assert bridge.upload_calls == 0


@pytest.mark.asyncio
async def test_user_original_association_requires_matching_text_not_title(tmp_path):
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    class TextBridge(FakeBridge):
        content = "Different bytes"

        async def fetch_source_text(self, request):
            return RemoteTextResult(
                remote_source_id=request.remote_source_id,
                title="A.txt",
                content=self.content,
            )

    store, bridge = MemoryStore(), TextBridge()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "notebook:local",
        "source:one",
        "A.txt",
        b"The original content.",
        mime_type="text/plain",
    )
    await evidence.extract(version["source_version_id"])
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    with pytest.raises(BridgeError) as caught:
        await app.confirm_source_mapping(
            "notebook:local", "nb", "a", version["source_version_id"], True
        )
    assert caught.value.code == "SOURCE_TEXT_MISMATCH"
    bridge.content = "The original content."
    link = await app.confirm_source_mapping(
        "notebook:local", "nb", "a", version["source_version_id"], True
    )
    assert link["mapping_status"] == "verified"
    assert link["mapping_method"] == "user_confirmed_exact_text"
