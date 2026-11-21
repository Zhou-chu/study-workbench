"""Direct schema and lazy NotebookLM adapter initialization with no I/O."""

import pytest


def test_request_contract_keeps_exact_retry_fields_and_strict_booleans():
    from api.evidence_indexing import IndexRequest

    assert set(IndexRequest.model_fields) == {
        "source_version_ids",
        "profile_id",
        "preview_hash",
        "acknowledge_external_processing",
        "idempotency_key",
        "retry_of_job_id",
        "acknowledge_duplicate_embedding_cost",
    }
    with pytest.raises(ValueError):
        IndexRequest.model_validate(
            dict(
                source_version_ids=["v1"],
                profile_id="chosen",
                preview_hash="a" * 64,
                acknowledge_external_processing="true",
                idempotency_key="one",
            )
        )


def test_lazy_bridge_preserves_injected_and_legacy_assignment(monkeypatch):
    from api import notebooklm_service

    bridge = object()
    builds = []

    def build():
        builds.append(bridge)
        return bridge

    monkeypatch.setattr(notebooklm_service, "SDKNotebookLMBridge", build)
    service = notebooklm_service.NotebookLMService(store=object())
    assert builds == []
    assert service.bridge is bridge
    assert service.bridge is bridge
    assert builds == [bridge]
    replacement = object()
    service.bridge = replacement
    assert service.bridge is replacement
    explicit = notebooklm_service.NotebookLMService(store=object(), bridge=replacement)
    assert explicit.bridge is replacement
    assert builds == [bridge]
