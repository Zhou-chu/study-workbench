"""Metadata-only contracts: deployment configuration never probes a provider."""

import json

import pytest

from open_notebook.ai.evidence_embeddings import (
    EmbeddingUnavailable,
    EvidenceEmbeddingClient,
    hybrid_enabled,
    load_profiles,
)
from tests.evidence_embedding_profile_fixture import profile_data


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
