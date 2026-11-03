"""Metadata-only contracts: deployment configuration never probes a provider."""

import json

import pytest
from pydantic import ValidationError

from open_notebook.ai.evidence_embeddings import (
    EmbeddingUnavailable,
    EvidenceEmbeddingClient,
    hybrid_enabled,
    load_profiles,
)
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    IndexPreview,
    IndexReceipt,
    QueryEmbeddingDisclosure,
    RetrievalResult,
    ScopeEntry,
    ScopeSnapshot,
)


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


@pytest.mark.parametrize(
    "change",
    [
        {"revision": "new-revision"},
        {"endpoint": "https://different.invalid/v1"},
        {"dimension": 3},
        {"document_prefix": "document: "},
        {"query_prefix": "question: "},
        {"model_name": "same-dimension-new-model"},
        {"model_id": "model:other"},
        {"credential_binding_id": "credential:other"},
        {"destination_descriptor_version": "disclosure-v2"},
        {"max_input_bytes": 999},
        {"cosine_min_score": 0.5},
    ],
)
def test_profile_fingerprint_changes_for_revision_endpoint_dimension_and_prefix(change):
    old = make_profile()
    changed_same_dimension_model = make_profile(**change)
    assert old.fingerprint != changed_same_dimension_model.fingerprint
    assert old.configuration_fingerprint == old.fingerprint
    assert make_profile().fingerprint == old.fingerprint


def test_public_profile_never_retains_url_secrets():
    secret = "must-not-appear"
    profile = make_profile(
        endpoint=f"https://user:{secret}@example.invalid/v1?key={secret}#{secret}"
    )
    profile_public_json = profile.model_dump_json()
    assert profile_public_json.find(secret) == -1
    assert profile.endpoint == "https://example.invalid/v1"
    assert secret not in repr(profile)
    assert profile.fingerprint == make_profile(endpoint=profile.endpoint).fingerprint


@pytest.mark.parametrize(
    "missing", ["dimension", "revision", "max_input_bytes", "cosine_min_score"]
)
def test_profile_missing_dimension_or_revision_is_unavailable_without_probe(
    tmp_path, monkeypatch, missing
):
    data = profile_data()
    del data[missing]
    path = tmp_path / "profiles.json"
    path.write_text(json.dumps([data]))
    monkeypatch.setenv("STUDY_WORKBENCH_EMBEDDING_PROFILES", str(path))
    with pytest.raises(EmbeddingUnavailable, match="PROFILE_UNAVAILABLE") as error:
        load_profiles()
    assert error.value.__cause__ is None


@pytest.mark.parametrize(
    "change",
    [
        {"dimension": 0},
        {"dimension": 4097},
        {"dimension": True},
        {"revision": " "},
        {"max_input_bytes": 0},
        {"max_input_bytes": True},
        {"cosine_min_score": 1.01},
        {"cosine_min_score": float("nan")},
        {"cosine_min_score": -1.01},
        {"endpoint": "file:///tmp/forbidden"},
        {"destination_descriptor_version": ""},
        {"unexpected_key": "secret"},
    ],
)
def test_profile_rejects_incomplete_or_out_of_range_configuration(change):
    with pytest.raises(ValidationError):
        make_profile(**change)


def test_load_profiles_is_explicit_strict_and_metadata_only(tmp_path, monkeypatch):
    monkeypatch.delenv("STUDY_WORKBENCH_EMBEDDING_PROFILES", raising=False)
    monkeypatch.delenv("STUDY_WORKBENCH_HYBRID_ENABLED", raising=False)
    assert load_profiles() == {}
    assert hybrid_enabled() is False
    path = tmp_path / "profiles.json"
    path.write_text(json.dumps([profile_data()]))
    monkeypatch.setenv("STUDY_WORKBENCH_EMBEDDING_PROFILES", str(path))
    profiles = load_profiles()
    assert EvidenceEmbeddingClient().resolve_profile("chosen") == profiles["chosen"]
    with pytest.raises(EmbeddingUnavailable):
        EvidenceEmbeddingClient().resolve_profile("not-selected")
    path.write_text(json.dumps([profile_data(), profile_data()]))
    with pytest.raises(EmbeddingUnavailable):
        load_profiles()
    path.write_text('{"chosen":{},"chosen":{}}')
    with pytest.raises(EmbeddingUnavailable):
        load_profiles()


def test_profiles_and_scope_are_frozen_and_sorted():
    profile = make_profile()
    with pytest.raises(ValidationError):
        profile.dimension = 3
    a = ScopeEntry(
        version_id="a", extraction_id="e-a", manifest_hash="a" * 64, scope_epoch=0
    )
    b = ScopeEntry(
        version_id="b", extraction_id="e-b", manifest_hash="b" * 64, scope_epoch=1
    )
    snapshot = ScopeSnapshot(notebook_id="n", entries=[b, a])
    assert snapshot.entries == (a, b)
    with pytest.raises(ValidationError):
        ScopeSnapshot(notebook_id="n", entries=[])
    with pytest.raises(ValidationError):
        ScopeSnapshot(notebook_id="n", entries=[a, a])
    with pytest.raises(ValidationError):
        QueryEmbeddingDisclosure(
            disclosed_profile_fingerprint="",
            destination_descriptor_version="v1",
            acknowledge_query_processing=True,
        )
    with pytest.raises(ValidationError):
        QueryEmbeddingDisclosure(
            disclosed_profile_fingerprint=profile.fingerprint,
            destination_descriptor_version="",
            acknowledge_query_processing=True,
        )
    assert (
        RetrievalResult(
            hits=[],
            requested_method="lexical",
            retrieval_method="lexical",
            selected_version_count=2,
        ).hits
        == []
    )
    assert IndexPreview is not None and IndexReceipt is not None


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://faß.de/v1",
        "https://%66ass.de/v1",
        "https://fass.de\\other/v1",
        "https://fass.de\n/v1",
    ],
)
def test_ambiguous_endpoint_identity_is_rejected_without_transport_work(endpoint):
    with pytest.raises(ValidationError):
        make_profile(endpoint=endpoint)


def test_ascii_idna_authorities_have_distinct_disclosure_fingerprints():
    ascii_domain = make_profile(endpoint="https://fass.de/v1")
    idna_domain = make_profile(endpoint="https://xn--fa-hia.de/v1")
    assert ascii_domain.fingerprint != idna_domain.fingerprint
