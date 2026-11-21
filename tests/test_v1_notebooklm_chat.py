import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore

from api.evidence_service import EvidenceService
from api.notebooklm_service import NotebookLMService
from open_notebook.integrations.notebooklm.contracts import (
    BridgeAnswer,
    BridgeError,
    RemoteReference,
)


@pytest.mark.asyncio
async def test_local_scope_requires_exact_verified_mapping(tmp_path):
    store = MemoryStore()
    evidence = EvidenceService(store, tmp_path)
    v = await evidence.ingest(
        "notebook:local",
        "source:local",
        "Same title.txt",
        b"Content",
        mime_type="text/plain",
    )
    bridge = FakeBridge()
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    with pytest.raises(BridgeError) as caught:
        await app.ask(
            {
                "notebook_id": "notebook:local",
                "selection_origin": "local",
                "source_version_ids": [v["source_version_id"]],
                "remote_notebook_id": "nb",
                "message": "Question",
                "idempotency_key": "ask",
            }
        )
    assert caught.value.code == "UNMAPPED_SOURCE"
    assert bridge.ask_calls == 0


@pytest.mark.asyncio
async def test_repeated_quote_on_two_pages_remains_unmapped(tmp_path):
    store = MemoryStore()
    evidence = EvidenceService(store, tmp_path)
    v = await evidence.ingest(
        "notebook:local",
        "source:local",
        "A.txt",
        b"Repeated phrase.\n\nRepeated phrase.",
        mime_type="text/plain",
    )
    await evidence.extract(v["source_version_id"])
    await store.put(
        "source_link",
        "sl",
        {
            "source_link_id": "sl",
            "notebook_id": "notebook:local",
            "remote_notebook_id": "nb",
            "remote_source_id": "a",
            "source_version_id": v["source_version_id"],
            "mapping_status": "verified",
            "mapping_method": "uploaded_original",
            "remote_status": "ready",
        },
    )
    bridge = FakeBridge()
    bridge.answer = BridgeAnswer(
        answer="Phrase",
        conversation_id="c",
        references=[RemoteReference(remote_source_id="a", quote="Repeated phrase.")],
    )
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    result = await app.ask(
        {
            "notebook_id": "notebook:local",
            "selection_origin": "local",
            "source_version_ids": [v["source_version_id"]],
            "remote_notebook_id": "nb",
            "message": "Question",
            "idempotency_key": "ask",
        }
    )
    assert result["citations"][0]["reference_validity"] == "unverified"
    assert result["citations"][0]["locator"] is None


@pytest.mark.asyncio
async def test_identical_chat_retry_returns_saved_snapshot_after_mapping_refresh(
    tmp_path,
):
    store, bridge = MemoryStore(), FakeBridge()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "notebook:local", "source:one", "A.txt", b"Exact fact.", mime_type="text/plain"
    )
    await evidence.extract(version["source_version_id"])
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    link = app._source_link(
        "notebook:local",
        "nb",
        "a",
        source_version_id=version["source_version_id"],
        mapping_status="verified",
        remote_status="ready",
        mapping_method="uploaded_original",
    )
    await store.put("source_link", link["source_link_id"], link)
    req = {
        "notebook_id": "notebook:local",
        "selection_origin": "local",
        "source_version_ids": [version["source_version_id"]],
        "remote_notebook_id": "nb",
        "message": "Question",
        "idempotency_key": "same",
    }
    first = await app.ask(req)
    second = await app.ask(req)
    assert second["scope_snapshot"] == first["scope_snapshot"]
    assert bridge.ask_calls == 1
    with pytest.raises(BridgeError) as caught:
        await app.ask({**req, "message": "Different question"})
    assert caught.value.code == "IDEMPOTENCY_CONFLICT"


@pytest.mark.asyncio
async def test_remote_change_between_scope_resolution_and_send_blocks_local_scope(
    tmp_path,
):
    from open_notebook.integrations.notebooklm.contracts import RemoteSource

    store, bridge = MemoryStore(), FakeBridge()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "notebook:local", "source:one", "A.txt", b"Exact fact.", mime_type="text/plain"
    )
    app = NotebookLMService(store=store, bridge=bridge, evidence=evidence, enqueue=None)
    link = app._source_link(
        "notebook:local",
        "nb",
        "a",
        source_version_id=version["source_version_id"],
        mapping_status="verified",
        remote_status="ready",
        mapping_method="uploaded_original",
        remote_metadata={"revision_id": "old"},
    )
    await store.put("source_link", link["source_link_id"], link)
    bridge.sources[0] = RemoteSource(
        id="a", title="A", status="ready", revision_id="new"
    )
    with pytest.raises(BridgeError) as caught:
        await app.ask(
            {
                "notebook_id": "notebook:local",
                "selection_origin": "local",
                "source_version_ids": [version["source_version_id"]],
                "remote_notebook_id": "nb",
                "message": "Question",
                "idempotency_key": "changed",
            }
        )
    assert caught.value.code == "UNMAPPED_SOURCE"
    assert bridge.ask_calls == 0
