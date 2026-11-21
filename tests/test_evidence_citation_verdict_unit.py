"""Citation verdict units: real service and schema, only persistence is synthetic."""

import asyncio
import copy
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import pytest

from api.evidence_service import EvidenceService


@pytest.fixture
def case():
    quote = "甲乙丙丁"
    evidence = {
        "evidence_id": "ev_one",
        "source_version_id": "sv_one",
        "extraction_id": "ex_old",
        "quote": quote,
        "quote_hash": hashlib.sha256(quote.encode()).hexdigest(),
        "source_title": "合成资料",
        "locator": {
            "block_id": "block_one",
            "page_index": 2,
            "start_offset": 2,
            "end_offset": 6,
        },
    }
    extraction = {
        "extraction_id": "ex_old",
        "source_version_id": "sv_one",
        "status": "ready",
        "blocks": [
            {"block_id": "block_one", "page_index": 2, "text": "前言甲乙丙丁后记"}
        ],
    }
    rows = {
        ("evidence", "ev_one"): evidence,
        ("extraction", "ex_old"): extraction,
        ("version", "sv_one"): {"origin": "upload", "provenance": {"synthetic": True}},
    }

    async def get(kind, identity):
        return copy.deepcopy(rows.get((kind, identity)))

    service = object.__new__(EvidenceService)
    service.store = SimpleNamespace(get=AsyncMock(side_effect=get))
    return service, rows


async def verdict(case, citation=None, **kwargs):
    service, _ = case
    return await service.validate_citation(
        {"evidence_id": "ev_one", **(citation or {})}, ["sv_one"], **kwargs
    )


@pytest.mark.asyncio
async def test_verified_subquote_has_exact_original_offsets_and_does_not_mutate(case):
    service, rows = case
    before = copy.deepcopy(rows)
    result = await verdict(case, {"quote": "乙丙", "citation_id": "answer-c2"})
    assert result["reference_validity"] == "verified"
    assert result["citation_id"] == "answer-c2"
    assert result["quote"] == "乙丙"
    assert result["locator"] == {
        "block_id": "block_one",
        "page_index": 2,
        "start_offset": 3,
        "end_offset": 5,
    }
    assert result["source_title"] == "合成资料"
    assert result["provenance"] == {"synthetic": True}
    assert result["kind"] == "local_evidence"
    assert result["independent_support"] is None and result["reason"] is None
    assert rows == before
    assert service.store.get.await_args_list == [
        call("evidence", "ev_one"),
        call("extraction", "ex_old"),
        call("version", "sv_one"),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("identity", [None, 17, ""])
async def test_malformed_identity_never_reads_storage(case, identity):
    result = await verdict(case, {"evidence_id": identity})
    assert result["reference_validity"] == "invalid"
    assert result["reason"] == "Malformed evidence ID"
    case[0].store.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_and_payload_identity_corruption_are_not_trusted(case):
    _, rows = case
    rows.pop(("evidence", "ev_one"))
    assert (await verdict(case))["reason"] == "Unknown evidence ID"
    rows["evidence", "ev_one"] = {"evidence_id": "ev_other"}
    assert (await verdict(case))["reason"] == "Stored evidence integrity check failed"


@pytest.mark.asyncio
async def test_outside_scope_and_not_supplied_are_distinct_and_stop_before_extraction(
    case,
):
    service, _ = case
    result = await service.validate_citation({"evidence_id": "ev_one"}, ["sv_other"])
    assert result["reference_validity"] == "out_of_scope"
    assert service.store.get.await_count == 1
    result = await verdict(case, evidence_ids=["ev_other"])
    assert result["reference_validity"] == "invalid"
    assert result["reason"] == "Evidence was not supplied to this answer"
    assert service.store.get.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "citation,reason",
    [
        ({"source_version_id": "sv_other"}, "Source version does not match evidence"),
        ({"quote": "不存在"}, "Quote does not match evidence"),
        ({"quote": 19}, "Quote does not match evidence"),
    ],
)
async def test_model_metadata_cannot_override_evidence(case, citation, reason):
    result = await verdict(case, citation)
    assert result["reference_validity"] == "invalid" and result["reason"] == reason
    assert case[0].store.get.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    [
        "missing_extraction",
        "wrong_version",
        "missing_block",
        "bad_hash",
        "changed_text",
    ],
)
async def test_retained_extraction_and_quote_hash_are_required(case, corruption):
    _, rows = case
    evidence = rows["evidence", "ev_one"]
    extraction = rows["extraction", "ex_old"]
    if corruption == "missing_extraction":
        rows.pop(("extraction", "ex_old"))
    elif corruption == "wrong_version":
        extraction["source_version_id"] = "sv_other"
    elif corruption == "missing_block":
        extraction["blocks"] = []
    elif corruption == "bad_hash":
        evidence["quote_hash"] = "0" * 64
    else:
        extraction["blocks"][0]["text"] = "前言甲乙修改后记"
    result = await verdict(case)
    assert result["reference_validity"] == "invalid"
    assert result["reason"] == "Stored evidence integrity check failed"


@pytest.mark.asyncio
async def test_repeated_subquote_is_ambiguous_not_first_match(case):
    _, rows = case
    evidence = rows["evidence", "ev_one"]
    evidence.update(
        quote="甲乙甲乙", quote_hash=hashlib.sha256("甲乙甲乙".encode()).hexdigest()
    )
    rows["extraction", "ex_old"]["blocks"][0]["text"] = "前言甲乙甲乙后记"
    result = await verdict(case, {"quote": "甲乙"})
    assert result["reference_validity"] == "invalid"
    assert result["reason"] == "Quote location is ambiguous within evidence"


def restore(case):
    _, rows = case
    rows["evidence", "ev_one"]["verification_origin"] = "restored_archive"
    old = rows["extraction", "ex_old"]
    old["verification_origin"] = "restored_archive"
    old["revalidation"] = {
        "evidence_ids": ["ev_one"],
        "fresh_extraction_id": "ex_fresh",
    }
    fresh = copy.deepcopy(old)
    fresh.update(extraction_id="ex_fresh", verification_origin="local_extraction")
    fresh.pop("revalidation")
    rows["extraction", "ex_fresh"] = fresh
    return fresh


@pytest.mark.asyncio
async def test_restored_self_consistency_is_not_verification_but_fresh_exact_match_is(
    case,
):
    _, rows = case
    rows["evidence", "ev_one"]["verification_origin"] = "restored_archive"
    result = await verdict(case)
    assert result["reference_validity"] == "unverified"
    assert "fresh local extraction" in result["reason"]
    restore(case)
    result = await verdict(case, {"quote": "乙丙"})
    assert result["reference_validity"] == "verified"
    assert result["locator"]["start_offset"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    [
        "restored_fresh",
        "wrong_version",
        "failed",
        "wrong_page",
        "missing_block",
        "page_label",
        "bbox",
        "bool_offset",
        "negative_offset",
        "long_offset",
        "text_changed",
        "not_in_report",
        "missing_fresh",
    ],
)
async def test_revalidation_report_alone_cannot_promote_unmatched_evidence(
    case, corruption
):
    fresh = restore(case)
    _, rows = case
    evidence = rows["evidence", "ev_one"]
    if corruption == "restored_fresh":
        fresh["verification_origin"] = "restored_archive"
    elif corruption == "wrong_version":
        fresh["source_version_id"] = "sv_other"
    elif corruption == "failed":
        fresh["status"] = "failed"
    elif corruption == "wrong_page":
        fresh["blocks"][0]["page_index"] = 3
    elif corruption == "missing_block":
        fresh["blocks"] = []
    elif corruption in ("page_label", "bbox"):
        evidence["locator"][corruption] = "claimed"
    elif corruption == "bool_offset":
        # Direct matching tests bool rejection without slicing an invalid stored citation.
        evidence["locator"]["start_offset"] = True
        assert EvidenceService._matches_fresh(evidence, fresh) is False
        return
    elif corruption in ("negative_offset", "long_offset"):
        evidence["locator"]["end_offset"] = (
            -1 if corruption == "negative_offset" else 100
        )
        assert EvidenceService._matches_fresh(evidence, fresh) is False
        return
    elif corruption == "text_changed":
        fresh["blocks"][0]["text"] = "前言甲乙不同后记"
    elif corruption == "not_in_report":
        rows["extraction", "ex_old"]["revalidation"]["evidence_ids"] = []
    else:
        rows.pop(("extraction", "ex_fresh"))
    result = await verdict(case)
    assert result["reference_validity"] == "unverified"
    assert "fresh local extraction" in result["reason"]


@pytest.mark.asyncio
async def test_missing_version_prevents_even_valid_fresh_revalidation(case):
    restore(case)
    case[1].pop(("version", "sv_one"))
    result = await verdict(case)
    assert result["reference_validity"] == "unverified"
    assert "Source version is unavailable" in result["reason"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["version_derived", "evidence_derived", "remote"])
async def test_kind_and_independent_support_are_projected_from_retained_metadata(
    case, kind
):
    _, rows = case
    if kind == "version_derived":
        rows["version", "sv_one"]["origin"] = "derived_snapshot"
    else:
        rows["evidence", "ev_one"]["evidence_kind"] = (
            "derived_snapshot" if kind == "evidence_derived" else "remote_text_snapshot"
        )
    result = await verdict(case)
    assert result["reference_validity"] == "verified"
    assert result["kind"] == (
        "remote_text_snapshot" if kind == "remote" else "derived_snapshot"
    )
    assert result["independent_support"] is (None if kind == "remote" else False)


@pytest.mark.asyncio
async def test_explicit_read_view_is_used_exclusively_and_cancellation_propagates(case):
    service, _ = case
    reads = SimpleNamespace(get=service.store.get)
    service.store = SimpleNamespace(
        get=AsyncMock(side_effect=AssertionError("fallback forbidden"))
    )
    result = await service.validate_citation(
        {"evidence_id": "ev_one"}, ["sv_one"], _reads=reads
    )
    assert result["reference_validity"] == "verified"
    service.store.get.assert_not_awaited()
    reads.get.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await service.validate_citation(
            {"evidence_id": "ev_one"}, ["sv_one"], _reads=reads
        )


@pytest.mark.parametrize("end_offset", [True, False, 6.0, "6", None])
def test_fresh_match_rejects_non_integer_end_offsets(case, end_offset):
    fresh = restore(case)
    evidence = case[1]["evidence", "ev_one"]
    evidence["locator"]["end_offset"] = end_offset
    assert EvidenceService._matches_fresh(evidence, fresh) is False


def test_fresh_match_rejects_bad_quote_hash_despite_matching_text_and_location(case):
    fresh = restore(case)
    evidence = case[1]["evidence", "ev_one"]
    evidence["quote_hash"] = "0" * 64
    assert EvidenceService._matches_fresh(evidence, fresh) is False


@pytest.mark.asyncio
async def test_partial_fresh_extraction_can_verify_exact_historical_evidence(case):
    fresh = restore(case)
    fresh["status"] = "partial"
    result = await verdict(case)
    assert result["reference_validity"] == "verified"
    assert result["reason"] is None
    assert result["quote"] == "甲乙丙丁"
    assert case[0].store.get.await_args_list == [
        call("evidence", "ev_one"),
        call("extraction", "ex_old"),
        call("extraction", "ex_fresh"),
        call("version", "sv_one"),
    ]


@pytest.mark.asyncio
async def test_extraction_alone_restored_marker_requires_fresh_verification(case):
    _, rows = case
    rows["extraction", "ex_old"]["verification_origin"] = "restored_archive"
    assert "verification_origin" not in rows["evidence", "ev_one"]
    result = await verdict(case)
    assert result["reference_validity"] == "unverified"
    assert "fresh local extraction" in result["reason"]
    assert case[0].store.get.await_args_list == [
        call("evidence", "ev_one"),
        call("extraction", "ex_old"),
        call("version", "sv_one"),
    ]
