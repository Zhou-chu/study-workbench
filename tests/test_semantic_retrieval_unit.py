"""Scoped semantic ranking units; repository and provider I/O are explicit stubs."""

import asyncio
import hashlib
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call

import pytest

from api import evidence_retrieval as mod
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    ScopeEntry,
    ScopeSnapshot,
)
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def semantic():
    profile = EmbeddingProfile(
        profile_id="synthetic",
        model_id="model:x",
        provider="synthetic",
        model_name="synthetic",
        revision="1",
        endpoint="https://example.invalid/v1",
        credential_binding_id="synthetic",
        dimension=2,
        document_prefix="",
        query_prefix="",
        preprocessing_revision="evidence-identity-v1",
        max_input_bytes=2000,
        cosine_min_score=0.2,
        destination_descriptor_version="1",
        destination_kind="remote",
    )
    snapshot = ScopeSnapshot(
        notebook_id="notebook:one",
        entries=(
            ScopeEntry(
                version_id="sv_one",
                extraction_id="ex_one",
                manifest_hash="a" * 64,
                scope_epoch=1,
            ),
        ),
    )
    records = {}
    vectors = []
    for identity, vector in (
        ("ev_z", [1.00001, 0]),
        ("ev_a", [1, 0]),
        ("ev_side", [0, 1]),
        ("ev_mid", [0.6, 0.8]),
    ):
        quote_hash = hashlib.sha256(identity.encode()).hexdigest()
        records[identity] = {
            "evidence_id": identity,
            "source_version_id": "sv_one",
            "quote_hash": quote_hash,
        }
        vectors.append(
            {
                "evidence_id": identity,
                "notebook_id": "notebook:one",
                "version_id": "sv_one",
                "extraction_id": "ex_one",
                "manifest_hash": "a" * 64,
                "scope_epoch": 1,
                "namespace": profile.fingerprint,
                "dimension": 2,
                "preprocessing_revision": profile.preprocessing_revision,
                "quote_hash": quote_hash,
                "vector": vector,
            }
        )
    events = []

    async def assert_scope(chosen):
        assert chosen == snapshot
        events.append("scope")

    async def embed(chosen, query, *, disclosure, dispatch_admission):
        assert chosen == profile and query == "合成问题"
        assert disclosure.model_dump() == {
            "disclosed_profile_fingerprint": profile.fingerprint,
            "destination_descriptor_version": "1",
            "acknowledge_query_processing": True,
        }
        events.append("provider-slot")
        await dispatch_admission()
        events.append("send")
        return [10, 0]

    repository = SimpleNamespace(
        status=AsyncMock(return_value={"state": "ready", "indexed_version_count": 1}),
        scoped_vectors=AsyncMock(return_value=vectors),
        assert_scope=AsyncMock(side_effect=assert_scope),
    )
    embeddings = SimpleNamespace(
        resolve_profile=Mock(return_value=profile),
        embed_query=AsyncMock(side_effect=embed),
    )
    service = mod.EvidenceRetrievalService(
        evidence=SimpleNamespace(), repository=repository, embeddings=embeddings
    )
    disclosure = service._disclosure(profile, profile.fingerprint, "1", True)
    return SimpleNamespace(
        service=service,
        repository=repository,
        embeddings=embeddings,
        profile=profile,
        snapshot=snapshot,
        records=records,
        vectors=vectors,
        disclosure=disclosure,
        events=events,
    )


async def run(s, admission=None):
    return await s.service._semantic(
        "合成问题", s.snapshot, s.profile, s.disclosure, s.records, admission
    )


@pytest.mark.asyncio
async def test_real_cosine_normalization_filter_ties_and_admission_order(semantic):
    s = semantic

    async def admit():
        s.events.append("operation")

    before = deepcopy(s.vectors)
    ranked, indexed, fallback = await run(s, admit)
    assert [i for i, _ in ranked] == ["ev_a", "ev_z", "ev_mid"]
    assert [score for _, score in ranked] == pytest.approx([1, 1, 0.6])
    assert indexed == 1 and fallback is None
    assert s.events == ["scope", "provider-slot", "scope", "operation", "send"]
    assert s.vectors == before
    s.repository.scoped_vectors.assert_awaited_once_with(
        s.snapshot, s.profile, row_cap=mod.ROW_CAP, element_cap=mod.ELEMENT_CAP
    )
    assert s.repository.assert_scope.await_args_list == [
        call(s.snapshot),
        call(s.snapshot),
    ]


@pytest.mark.asyncio
async def test_real_channel_limit_keeps_best_ids_after_batching(semantic):
    s = semantic
    original = s.vectors[0]
    s.vectors.clear()
    s.records.clear()
    for n in reversed(range(mod.READ_BATCH_SIZE + 5)):
        identity = f"ev_{n:04d}"
        row = {**original, "evidence_id": identity, "vector": [1, 0]}
        s.vectors.append(row)
        s.records[identity] = {
            "source_version_id": "sv_one",
            "quote_hash": row["quote_hash"],
        }
    ranked, indexed, fallback = await run(s)
    assert [i for i, _ in ranked] == [f"ev_{n:04d}" for n in range(mod.CHANNEL_LIMIT)]
    assert all(score == 1 for _, score in ranked)
    assert indexed == 1 and fallback is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state,reason", [("stale", "INDEX_STALE"), ("missing", "INDEX_NOT_READY")]
)
async def test_unready_index_never_reads_vectors_or_dispatches(semantic, state, reason):
    s = semantic
    s.repository.status.return_value = {"state": state, "indexed_version_count": 0}
    assert await run(s) == ([], 0, reason)
    s.repository.scoped_vectors.assert_not_awaited()
    s.embeddings.resolve_profile.assert_not_called()
    s.embeddings.embed_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code", ["SCOPE_TOO_LARGE", "INDEX_NOT_READY", "INDEX_STALE", "INDEX_INTEGRITY"]
)
async def test_only_explicit_vector_read_errors_allow_lexical_fallback(semantic, code):
    s = semantic
    s.repository.scoped_vectors.side_effect = InvalidInputError(
        code + ": synthetic detail"
    )
    if code == "INDEX_INTEGRITY":
        with pytest.raises(InvalidInputError, match=code):
            await run(s)
    else:
        assert await run(s) == ([], 1, code)
    s.embeddings.embed_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("notebook_id", "notebook:other"),
        ("version_id", "sv_other"),
        ("extraction_id", "ex_other"),
        ("manifest_hash", "b" * 64),
        ("scope_epoch", 2),
        ("namespace", "other"),
        ("dimension", 3),
        ("preprocessing_revision", "other"),
        ("quote_hash", "b" * 64),
        ("evidence_id", "ev_invented"),
    ],
)
async def test_vector_candidate_binding_rejects_cross_scope_before_provider(
    semantic, field, value
):
    s = semantic
    s.vectors[0][field] = value
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await run(s)
    s.embeddings.resolve_profile.assert_not_called()
    s.embeddings.embed_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["duplicate", "count"])
async def test_duplicate_or_incomplete_vector_membership_is_not_ranked(
    semantic, corruption
):
    s = semantic
    if corruption == "duplicate":
        s.vectors[1] = deepcopy(s.vectors[0])
    else:
        s.vectors.pop()
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await run(s)
    s.embeddings.embed_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", ["removed", "descriptor", "fingerprint"])
async def test_changed_destination_rejected_without_send(semantic, changed):
    s = semantic
    if changed == "removed":
        s.embeddings.resolve_profile.side_effect = mod.EmbeddingUnavailable("removed")
    else:
        updates = (
            {"destination_descriptor_version": "2"}
            if changed == "descriptor"
            else {"revision": "2"}
        )
        s.embeddings.resolve_profile.return_value = s.profile.model_copy(update=updates)
    with pytest.raises(mod.EmbeddingDisclosureStale):
        await run(s)
    s.embeddings.embed_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,reason",
    [
        (mod.EmbeddingOutcomeUnknown("lost"), "EMBEDDING_OUTCOME_UNKNOWN"),
        (mod.EmbeddingUnavailable("unavailable"), "EMBEDDING_UNAVAILABLE"),
        (mod.EmbeddingResponseInvalid("invalid"), "EMBEDDING_UNAVAILABLE"),
    ],
)
async def test_provider_failure_is_typed_fallback_without_retry(
    semantic, error, reason
):
    s = semantic
    s.embeddings.embed_query.side_effect = error
    assert await run(s) == ([], 1, reason)
    assert s.embeddings.embed_query.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("vector", [[0, 0], [float("nan"), 1], [1], [True, 0]])
async def test_provider_vector_is_validated_before_numpy_ranking(semantic, vector):
    s = semantic
    s.embeddings.embed_query.side_effect = None
    s.embeddings.embed_query.return_value = vector
    assert await run(s) == ([], 1, "EMBEDDING_UNAVAILABLE")


@pytest.mark.asyncio
async def test_cancel_during_operation_admission_propagates_without_send(semantic):
    s = semantic

    async def cancel():
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await run(s, cancel)
    assert s.events == ["scope", "provider-slot", "scope"]
    assert s.embeddings.embed_query.await_count == 1


@pytest.mark.asyncio
async def test_scope_revoked_at_dispatch_propagates_without_fallback_or_send(semantic):
    s = semantic
    s.repository.assert_scope.side_effect = [None, InvalidInputError("SCOPE_CHANGED")]
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await run(s)
    assert s.events == ["provider-slot"]


@pytest.mark.parametrize("ack", [False, 1, "yes"])
def test_remote_query_disclosure_requires_exact_boolean_consent(semantic, ack):
    s = semantic
    with pytest.raises(mod.EmbeddingInputInvalid):
        s.service._disclosure(s.profile, s.profile.fingerprint, "1", ack)


def test_on_device_query_does_not_require_remote_consent(semantic):
    s = semantic
    profile = s.profile.model_copy(update={"destination_kind": "on_device"})
    disclosure = s.service._disclosure(profile, profile.fingerprint, "1", False)
    assert disclosure.acknowledge_query_processing is False
    assert disclosure.disclosed_profile_fingerprint == profile.fingerprint


@pytest.mark.asyncio
async def test_exact_cosine_threshold_remains_inclusive(semantic):
    s = semantic
    s.vectors[2]["vector"] = [0.2, (1 - 0.2**2) ** 0.5]
    ranked, _, fallback = await run(s)
    assert fallback is None
    assert dict(ranked)["ev_side"] == pytest.approx(s.profile.cosine_min_score)


@pytest.mark.asyncio
async def test_valid_snapshot_version_cannot_override_canonical_evidence_version(
    semantic,
):
    s = semantic
    second = ScopeEntry(
        version_id="sv_two",
        extraction_id="ex_two",
        manifest_hash="b" * 64,
        scope_epoch=2,
    )
    s.snapshot = ScopeSnapshot(
        notebook_id="notebook:one", entries=(*s.snapshot.entries, second)
    )
    s.vectors[0].update(
        version_id="sv_two",
        extraction_id="ex_two",
        manifest_hash="b" * 64,
        scope_epoch=2,
    )
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await run(s)
    s.embeddings.resolve_profile.assert_not_called()
    s.embeddings.embed_query.assert_not_awaited()
