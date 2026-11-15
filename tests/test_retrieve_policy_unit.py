"""Retrieve coordinator units; phase methods are explicit internal collaborator stubs."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from api import evidence_retrieval as mod
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    ScopeEntry,
    ScopeSnapshot,
)
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def policy():
    events = []
    snapshot = ScopeSnapshot(
        notebook_id="notebook:one",
        entries=tuple(
            ScopeEntry(
                version_id=v,
                extraction_id="ex_" + v,
                manifest_hash="a" * 64,
                scope_epoch=1,
            )
            for v in ("sv_one", "sv_two")
        ),
    )
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
        query_prefix="前缀:",
        preprocessing_revision="evidence-identity-v1",
        max_input_bytes=2000,
        cosine_min_score=0.0,
        destination_descriptor_version="1",
        destination_kind="remote",
    )

    async def capture(*args):
        events.append("capture")
        return snapshot

    async def lexical(*args):
        events.append("lexical")
        return (
            [("ev_a", 9.0), ("ev_b", 2.0)],
            {"sentinel": "records"},
            {"sentinel": "metadata"},
        )

    async def semantic(*args):
        events.append("semantic")
        return [("ev_b", 0.9), ("ev_c", 0.8)], 2, None

    async def reread(*args):
        events.append("reread")
        return [
            {"evidence_id": identity, "score": score} for identity, score in args[1]
        ]

    repository = SimpleNamespace(capture_scope=AsyncMock(side_effect=capture))
    embeddings = SimpleNamespace(resolve_profile=Mock(return_value=profile))
    service = mod.EvidenceRetrievalService(
        evidence=object(),
        repository=repository,
        embeddings=embeddings,
        enabled=Mock(return_value=True),
    )
    service._lexical = AsyncMock(side_effect=lexical)
    service._semantic = AsyncMock(side_effect=semantic)
    service._reread = AsyncMock(side_effect=reread)

    async def admission():
        events.append("admit")

    return SimpleNamespace(
        service=service,
        snapshot=snapshot,
        profile=profile,
        repository=repository,
        embeddings=embeddings,
        events=events,
        admission=AsyncMock(side_effect=admission),
    )


def hybrid(s):
    return {
        "mode": "hybrid",
        "profile_id": "synthetic",
        "acknowledge_query_processing": True,
        "disclosed_profile_fingerprint": s.profile.fingerprint,
        "destination_descriptor_version": "1",
    }


async def request(s, query="问题", versions=None, **kwargs):
    return await s.service.retrieve(
        query,
        "notebook:one",
        ["sv_one", "sv_two"] if versions is None else versions,
        **kwargs,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs,query,versions,code",
    [
        ({"limit": True}, "q", None, "RETRIEVAL_LIMIT_INVALID"),
        ({"limit": 101}, "q", None, "RETRIEVAL_LIMIT_INVALID"),
        ({"mode": "unknown"}, "q", None, "RETRIEVAL_MODE_INVALID"),
        ({"mode": "hybrid", "profile_id": " "}, "q", None, "RETRIEVAL_MODE_INVALID"),
        ({"profile_id": "unexpected"}, "q", None, "RETRIEVAL_MODE_INVALID"),
        ({"acknowledge_query_processing": 0}, "q", None, "RETRIEVAL_MODE_INVALID"),
        ({}, "  ", None, "RETRIEVAL_QUERY_INVALID"),
        ({}, 42, None, "RETRIEVAL_QUERY_INVALID"),
        ({}, "x" * (mod.QUERY_CHAR_CAP + 1), None, "QUERY_TOO_LONG"),
        ({}, chr(0xD800), None, "RETRIEVAL_QUERY_INVALID"),
        ({}, "q", [], "NO_SOURCES_SELECTED"),
    ],
)
async def test_preflight_rejection_performs_no_repository_or_phase_io(
    policy, kwargs, query, versions, code
):
    s = policy
    with pytest.raises(InvalidInputError, match="^" + code + "$"):
        await request(
            s, query=query, versions=versions, operation_admission=s.admission, **kwargs
        )
    assert s.events == []
    s.repository.capture_scope.assert_not_awaited()
    s.embeddings.resolve_profile.assert_not_called()
    s.service._lexical.assert_not_awaited()
    s.service._semantic.assert_not_awaited()
    s.service._reread.assert_not_awaited()
    s.admission.assert_not_awaited()


@pytest.mark.asyncio
async def test_lexical_order_limit_and_result_scope_metadata(policy):
    s = policy
    result = await request(s, limit=1, operation_admission=s.admission)
    assert s.events == ["capture", "admit", "lexical", "reread", "admit"]
    assert result.hits == [{"evidence_id": "ev_a", "score": 9.0}]
    assert result.requested_method == result.retrieval_method == "lexical"
    assert result.selected_version_count == 2 and result.indexed_version_count == 0
    assert (
        result.profile_id is None
        and result.fallback_reason is None
        and result.warnings == ()
    )
    s.repository.capture_scope.assert_awaited_once_with(
        "notebook:one", ["sv_one", "sv_two"]
    )
    s.service._semantic.assert_not_awaited()
    s.embeddings.resolve_profile.assert_not_called()
    args = s.service._reread.await_args.args
    assert args == (
        s.snapshot,
        [("ev_a", 9.0)],
        {"sentinel": "records"},
        {"sentinel": "metadata"},
        "lexical",
        {"ev_a", "ev_b"},
        set(),
    )


@pytest.mark.asyncio
async def test_hybrid_uses_real_rrf_not_lexical_or_semantic_scores(policy):
    s = policy
    result = await request(s, limit=2, operation_admission=s.admission, **hybrid(s))
    assert [h["evidence_id"] for h in result.hits] == ["ev_b", "ev_a"]
    assert [h["score"] for h in result.hits] == pytest.approx([1 / 62 + 1 / 61, 1 / 61])
    assert result.retrieval_method == result.requested_method == "hybrid"
    assert result.indexed_version_count == result.selected_version_count == 2
    assert result.profile_id == "synthetic" and result.fallback_reason is None
    assert s.events == ["capture", "admit", "lexical", "semantic", "reread", "admit"]
    args = s.service._semantic.await_args.args
    assert args[:3] == ("问题", s.snapshot, s.profile)
    assert args[3].acknowledge_query_processing is True
    assert args[4:] == ({"sentinel": "records"}, s.admission)
    assert s.service._reread.await_args.args[-2:] == (
        {"ev_a", "ev_b"},
        {"ev_b", "ev_c"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reason", ["PROFILE_UNAVAILABLE", "FEATURE_DISABLED", "QUERY_TOO_LONG"]
)
async def test_policy_fallback_retains_lexical_scores_and_still_rereads(policy, reason):
    s = policy
    kwargs = hybrid(s)
    if reason == "PROFILE_UNAVAILABLE":
        s.embeddings.resolve_profile.side_effect = mod.EmbeddingUnavailable(
            "not configured"
        )
    elif reason == "FEATURE_DISABLED":
        s.service.enabled.return_value = False
    else:
        s.embeddings.resolve_profile.return_value = s.profile.model_copy(
            update={"max_input_bytes": 1}
        )
        kwargs["disclosed_profile_fingerprint"] = (
            s.embeddings.resolve_profile.return_value.fingerprint
        )
    result = await request(s, **kwargs)
    assert (
        result.requested_method == "hybrid"
        and result.retrieval_method == "lexical_fallback"
    )
    assert result.fallback_reason == reason and result.indexed_version_count == 0
    assert result.hits == [
        {"evidence_id": "ev_a", "score": 9.0},
        {"evidence_id": "ev_b", "score": 2.0},
    ]
    assert result.warnings == ()
    s.service._semantic.assert_not_awaited()
    assert s.events == ["capture", "lexical", "reread"]


@pytest.mark.asyncio
async def test_byte_budget_counts_utf8_prefix_and_allows_exact_boundary(policy):
    s = policy
    size = len((s.profile.query_prefix + "问题").encode("utf-8"))
    s.embeddings.resolve_profile.return_value = s.profile.model_copy(
        update={"max_input_bytes": size}
    )
    kwargs = hybrid(s)
    kwargs["disclosed_profile_fingerprint"] = (
        s.embeddings.resolve_profile.return_value.fingerprint
    )
    assert (await request(s, **kwargs)).retrieval_method == "hybrid"
    s.service._semantic.reset_mock()
    s.embeddings.resolve_profile.return_value = s.profile.model_copy(
        update={"max_input_bytes": size - 1}
    )
    kwargs["disclosed_profile_fingerprint"] = (
        s.embeddings.resolve_profile.return_value.fingerprint
    )
    assert (await request(s, **kwargs)).fallback_reason == "QUERY_TOO_LONG"
    s.service._semantic.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_feature_does_not_bypass_disclosure_validation(policy):
    s = policy
    s.service.enabled.return_value = False
    kwargs = hybrid(s)
    kwargs["destination_descriptor_version"] = "stale"
    with pytest.raises(mod.EmbeddingDisclosureStale):
        await request(s, **kwargs)
    s.service.enabled.assert_not_called()
    s.service._semantic.assert_not_awaited()
    s.service._reread.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["EMBEDDING_OUTCOME_UNKNOWN", "INDEX_STALE"])
async def test_semantic_fallback_preserves_index_count_and_only_unknown_warning(
    policy, reason
):
    s = policy
    s.service._semantic.side_effect = None
    s.service._semantic.return_value = ([], 1, reason)
    result = await request(s, **hybrid(s))
    assert result.retrieval_method == "lexical_fallback"
    assert result.fallback_reason == reason and result.indexed_version_count == 1
    assert result.warnings == (
        ("EMBEDDING_OUTCOME_UNKNOWN",) if reason == "EMBEDDING_OUTCOME_UNKNOWN" else ()
    )
    assert [h["score"] for h in result.hits] == [9.0, 2.0]


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["first", "final"])
async def test_admission_cancellation_prevents_next_phase_or_result(policy, stage):
    s = policy
    s.admission.side_effect = (
        asyncio.CancelledError()
        if stage == "first"
        else [None, asyncio.CancelledError()]
    )
    with pytest.raises(asyncio.CancelledError):
        await request(s, operation_admission=s.admission)
    assert s.admission.await_count == (1 if stage == "first" else 2)
    if stage == "first":
        s.service._lexical.assert_not_awaited()
        s.service._reread.assert_not_awaited()
    else:
        s.service._reread.assert_awaited_once()


@pytest.mark.asyncio
async def test_scope_capture_rejection_never_starts_content_or_admission(policy):
    s = policy
    s.repository.capture_scope.side_effect = InvalidInputError("SCOPE_CHANGED")
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await request(s, operation_admission=s.admission)
    s.service._lexical.assert_not_awaited()
    s.admission.assert_not_awaited()
