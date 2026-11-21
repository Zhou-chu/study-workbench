"""Real canonical retrieval binding; collaborating evidence service is explicitly stubbed."""

import hashlib
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import evidence_retrieval as mod
from open_notebook.domain.evidence import EvidenceRecord, Extraction, SourceVersion
from open_notebook.domain.evidence_retrieval import ScopeEntry, ScopeSnapshot
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def binding():
    version = SourceVersion(
        source_version_id="sv_one",
        source_id="source:one",
        notebook_id="notebook:one",
        source_title="Synthetic",
        sha256="a" * 64,
        mime_type="text/plain",
        byte_size=20,
        file_path="synthetic.txt",
        created_at="2026-11-15",
        current_extraction_id="ex_one",
        status="ready",
    ).model_dump()
    records = []
    blocks = []
    for identity, quote in (
        ("ev_z", "solar power"),
        ("ev_a", "solar power"),
        ("ev_other", "lunar"),
    ):
        block_id = "block_" + identity
        blocks.append({"block_id": block_id, "text": quote, "page_index": None})
        records.append(
            EvidenceRecord(
                evidence_id=identity,
                source_version_id="sv_one",
                extraction_id="ex_one",
                notebook_id="notebook:one",
                source_title="Synthetic",
                locator={
                    "block_id": block_id,
                    "start_offset": 0,
                    "end_offset": len(quote),
                },
                quote=quote,
                quote_hash=hashlib.sha256(quote.encode()).hexdigest(),
                evidence_kind="text",
            ).model_dump()
        )
    extraction = Extraction(
        extraction_id="ex_one",
        source_version_id="sv_one",
        notebook_id="notebook:one",
        parser_name="utf8",
        parser_version="1",
        status="ready",
        evidence_ids=[r["evidence_id"] for r in records],
        blocks=blocks,
        created_at="2026-11-15",
    ).model_dump()
    digest = hashlib.sha256(
        json.dumps(
            [[r["evidence_id"], r["quote_hash"]] for r in records],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    snapshot = ScopeSnapshot(
        notebook_id="notebook:one",
        entries=(
            ScopeEntry(
                version_id="sv_one",
                extraction_id="ex_one",
                manifest_hash=digest,
                scope_epoch=1,
            ),
        ),
    )
    rows = {("version", "sv_one"): version, ("extraction", "ex_one"): extraction}
    rows.update({("evidence", r["evidence_id"]): r for r in records})

    async def get_many(kind, identities):
        return {
            i: {"id": mod.record_key(kind, i), "payload": deepcopy(rows[kind, i])}
            if (kind, i) in rows
            else None
            for i in identities
        }

    store = SimpleNamespace(get_many=AsyncMock(side_effect=get_many))

    async def selected(version_id, extraction_id, *, _reads):
        assert version_id == "sv_one" and extraction_id == "ex_one"
        assert isinstance(_reads, mod._CanonicalReads)
        return deepcopy(records)

    evidence = SimpleNamespace(
        store=store,
        list_evidence=AsyncMock(side_effect=selected),
        validate_citation=AsyncMock(
            return_value={
                "reference_validity": "verified",
                "reason": None,
                "provenance": None,
                "independent_support": None,
            }
        ),
    )
    repository = SimpleNamespace(assert_scope=AsyncMock())
    service = mod.EvidenceRetrievalService(
        evidence=evidence, repository=repository, embeddings=SimpleNamespace()
    )
    return SimpleNamespace(
        service=service,
        snapshot=snapshot,
        rows=rows,
        records=records,
        version=version,
        extraction=extraction,
        evidence=evidence,
        repository=repository,
        store=store,
    )


async def lexical(s):
    return await s.service._lexical("ＳＯＬＡＲ", s.snapshot)


async def reread(s, original, ranked=None):
    ranks, records, metadata = original
    return await s.service._reread(
        s.snapshot,
        ranks if ranked is None else ranked,
        records,
        metadata,
        "hybrid",
        {"ev_z", "ev_a"},
        {"ev_a"},
    )


@pytest.mark.asyncio
async def test_lexical_uses_real_normalization_tie_order_and_binds_all_canonical_rows(
    binding,
):
    s = binding
    ranks, records, metadata = await lexical(s)
    assert ranks == [("ev_a", 6.1), ("ev_z", 6.1)]
    assert set(records) == {"ev_z", "ev_a", "ev_other"}
    assert metadata["sv_one"] == (s.version, s.extraction)
    s.repository.assert_scope.assert_awaited_once_with(s.snapshot)
    assert [c.args for c in s.store.get_many.await_args_list] == [
        ("version", ["sv_one"]),
        ("extraction", ["ex_one"]),
    ]
    assert s.evidence.list_evidence.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,field,value",
    [
        ("version", "notebook_id", "notebook:other"),
        ("version", "source_version_id", "sv_other"),
        ("version", "current_extraction_id", "ex_other"),
        ("version", "status", "extracting"),
        ("extraction", "notebook_id", "notebook:other"),
        ("extraction", "extraction_id", "ex_other"),
        ("extraction", "source_version_id", "sv_other"),
        ("extraction", "status", "failed"),
    ],
)
async def test_metadata_scope_change_prevents_collaborating_content_reads(
    binding, kind, field, value
):
    s = binding
    s.rows[kind, "sv_one" if kind == "version" else "ex_one"][field] = value
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await lexical(s)
    s.evidence.list_evidence.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("mutation", ["schema", "duplicate", "empty", "long"])
async def test_metadata_schema_and_evidence_manifest_shape_are_checked(
    binding, mutation
):
    s = binding
    if mutation == "schema":
        s.version["byte_size"] = "20"
    else:
        s.extraction["evidence_ids"] = {
            "duplicate": ["ev_a", "ev_a"],
            "empty": [""],
            "long": ["x" * 513],
        }[mutation]
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await lexical(s)
    s.evidence.list_evidence.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("evidence_id", "ev_foreign"),
        ("source_version_id", "sv_other"),
        ("extraction_id", "ex_other"),
        ("notebook_id", "notebook:other"),
        ("source_title", "Other title"),
        ("quote_hash", "b" * 64),
        ("evidence_kind", "pdf_text"),
    ],
)
async def test_canonical_record_identity_metadata_hash_and_kind_cannot_drift(
    binding, field, value
):
    s = binding
    s.records[0][field] = value
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await lexical(s)
    s.repository.assert_scope.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutation", ["duplicate_block", "text", "page", "range", "typed_offset"]
)
async def test_record_locator_is_bound_to_one_exact_block(binding, mutation):
    s = binding
    if mutation == "duplicate_block":
        s.extraction["blocks"].append(deepcopy(s.extraction["blocks"][0]))
    elif mutation == "text":
        s.extraction["blocks"][0]["text"] = "changed"
    elif mutation == "page":
        s.records[0]["locator"]["page_index"] = 1
    elif mutation == "range":
        s.records[0]["locator"]["end_offset"] = 999
    else:
        s.records[0]["locator"]["end_offset"] = True
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await lexical(s)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error", [InvalidInputError("synthetic-secret"), NotFoundError("synthetic-secret")]
)
async def test_collaborator_missing_or_invalid_evidence_is_safe_integrity_error(
    binding, error
):
    s = binding
    s.evidence.list_evidence.side_effect = error
    with pytest.raises(InvalidInputError, match="^INDEX_INTEGRITY$") as caught:
        await lexical(s)
    assert caught.value.__context__ is None


@pytest.mark.asyncio
async def test_complete_content_manifest_must_match_captured_scope(binding):
    s = binding
    entry = s.snapshot.entries[0].model_copy(update={"manifest_hash": "f" * 64})
    s.snapshot = s.snapshot.model_copy(update={"entries": (entry,)})
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await lexical(s)
    s.repository.assert_scope.assert_not_awaited()


@pytest.mark.asyncio
async def test_fresh_reread_projects_collaborator_verdict_and_channel_membership(
    binding,
):
    s = binding
    original = await lexical(s)
    before = len(s.store.get_many.await_args_list)
    s.evidence.validate_citation.return_value = {
        "reference_validity": "unverified",
        "reason": "restored",
        "provenance": {"synthetic": True},
        "independent_support": False,
    }
    hits = await reread(s, original)
    assert [h["evidence_id"] for h in hits] == ["ev_a", "ev_z"]
    assert [h["channels"] for h in hits] == [["lexical", "semantic"], ["lexical"]]
    assert all(
        h["reference_validity"] == "unverified"
        and h["reference_reason"] == "restored"
        and h["independent_support"] is False
        and h["retrieval_method"] == "hybrid"
        for h in hits
    )
    assert [c.args for c in s.store.get_many.await_args_list[before:]] == [
        ("version", ["sv_one"]),
        ("extraction", ["ex_one"]),
        ("evidence", ["ev_a", "ev_z"]),
    ]
    assert s.repository.assert_scope.await_count == 3
    for call in s.evidence.validate_citation.await_args_list:
        identity = call.args[0]["evidence_id"]
        assert call.args[1] == ["sv_one"]
        assert call.kwargs["evidence_ids"] == [identity]
        assert isinstance(call.kwargs["_reads"], mod._CanonicalReads)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutation", ["origin_marker", "title", "record", "invalid_citation"]
)
async def test_reread_detects_changes_instead_of_trusting_predispatch_cache(
    binding, mutation
):
    s = binding
    original = await lexical(s)
    if mutation == "origin_marker":
        s.extraction["verification_origin"] = "restored_archive"
    elif mutation == "title":
        s.version["source_title"] = "changed"
        for row in s.records:
            row["source_title"] = "changed"
    elif mutation == "record":
        s.records[1]["verification_origin"] = "restored_archive"
    else:
        s.evidence.validate_citation.return_value = {"reference_validity": "invalid"}
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await reread(s, original)


@pytest.mark.asyncio
async def test_zero_hits_still_reread_and_reauthorize_whole_scope(binding):
    s = binding
    original = await lexical(s)
    s.version["status"] = "extracting"
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await reread(s, original, ranked=[])
    s.evidence.validate_citation.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "origin,mime,kind",
    [
        ("derived_snapshot", "text/plain", "derived_snapshot"),
        ("remote_text_snapshot", "text/plain", "remote_text_snapshot"),
        ("web_snapshot", "text/plain", "remote_text_snapshot"),
        ("upload", "application/pdf", "pdf_text"),
    ],
)
async def test_supported_origin_kind_pairs_are_accepted_without_relabelling(
    binding, origin, mime, kind
):
    s = binding
    s.version.update(origin=origin, mime_type=mime)
    for record in s.records:
        record["evidence_kind"] = kind
    ranks, records, _ = await lexical(s)
    assert [identity for identity, _ in ranks] == ["ev_a", "ev_z"]
    assert all(record["evidence_kind"] == kind for record in records.values())


@pytest.mark.asyncio
async def test_invented_rank_identity_not_present_in_original_scope_is_rejected(
    binding,
):
    s = binding
    original = await lexical(s)
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await reread(s, original, ranked=[("ev_invented", 1.0)])
    s.evidence.validate_citation.assert_not_awaited()


@pytest.mark.asyncio
async def test_final_scope_revocation_prevents_returning_prepared_hits(binding):
    s = binding
    original = await lexical(s)
    s.repository.assert_scope.side_effect = [None, InvalidInputError("SCOPE_CHANGED")]
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await reread(s, original)
    assert s.evidence.validate_citation.await_count == 2
