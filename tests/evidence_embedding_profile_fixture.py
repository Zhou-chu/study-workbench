"""Synthetic embedding metadata, without loading collected tests."""

from open_notebook.domain.evidence_retrieval import EmbeddingProfile


def profile_data(**changes):
    return {
        "profile_id": "chosen",
        "model_id": "model:pinned",
        "provider": "ollama",
        "model_name": "operator-selected-model",
        "revision": "operator-pinned-revision",
        "endpoint": "http://127.0.0.1:11434",
        "credential_binding_id": "credential:pinned",
        "dimension": 2,
        "document_prefix": "passage: ",
        "query_prefix": "query: ",
        "preprocessing_revision": "evidence-identity-v1",
        "max_input_bytes": 1000,
        "cosine_min_score": 0.4,
        "destination_descriptor_version": "disclosure-v1",
        "destination_kind": "unknown",
        **changes,
    }


def make_profile(**changes):
    return EmbeddingProfile(**profile_data(**changes))
