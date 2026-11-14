"""Offline scope/ranking contracts, not model quality or live database acceptance."""

import hashlib
import importlib
import json
import math
from copy import deepcopy
from pathlib import Path

import pytest
from test_evidence_embedding_repository import FakeDatabase, profile
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from api.personal_store import record_key
from open_notebook.ai.evidence_embeddings import (
    EmbeddingOutcomeUnknown,
    EmbeddingResponseInvalid,
    EmbeddingUnavailable,
)
from open_notebook.database.evidence_embedding_repository import (
    EvidenceEmbeddingRepository,
    _hash,
    _vector_key,
)
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

NB = "notebook:allowed"
PRIVATE = "SYNTHETIC_PRIVATE_PROVIDER_BODY"
FIXTURE = json.loads(Path("tests/fixtures/workbench_hybrid_retrieval.json").read_text())


class PhysicalStore(MemoryStore):
    def __init__(self):
        super().__init__()
        self.reads = []
        self.fail = False
        self.transform = None

    async def get_many(self, kind, identities):
        self.reads.append((kind, list(identities)))
        if self.fail:
            raise RuntimeError(PRIVATE)
        rows = await super().get_many(kind, identities)
        for identity, row in rows.items():
            if row is not None:
                row["id"] = record_key(kind, identity)
        if self.transform:
            self.transform(kind, rows)
        return rows

    async def list(self, *args, **kwargs):
        raise AssertionError("Global content listing is forbidden")


class RetrievalDatabase(FakeDatabase):
    """Honor actual repository bound scope/namespace predicates in fake reads."""

    def __init__(self, store):
        super().__init__()
        self.store = store
        self.members = set()
        self.manifests = []
        self.vectors = []
        self.error_at = None

    async def query(self, sql, params=None):
        if self.error_at and self.error_at in sql:
            raise RuntimeError(PRIVATE)
        self.versions = {
            identity: deepcopy(v)
            for (kind, identity), v in self.store.data.items()
            if kind == "version"
        }
        self.extractions = {
            identity: deepcopy(v)
            for (kind, identity), v in self.store.data.items()
            if kind == "extraction"
        }
        params = params or {}
        vectors = self.vectors
        manifests = self.manifests
        if "vector-" in sql:
            self.vectors = [
                r
                for r in vectors
                if r["notebook_id"] == params["notebook_id"]
                and r["namespace"] == params["namespace"]
                and r["dimension"] == params["dimension"]
                and r["preprocessing_revision"] == params["preprocessing_revision"]
                and [
                    r[k]
                    for k in (
                        "version_id",
                        "extraction_id",
                        "attempt_id",
                        "scope_epoch",
                        "manifest_hash",
                    )
                ]
                in params["bindings"]
            ]
        if "index-manifests" in sql:
            self.manifests = [
                m
                for m in manifests
                if m["notebook_id"] == params["notebook_id"]
                and m["version_id"] in params["version_ids"]
                and m["namespace"] == params["namespace"]
                and m["dimension"] == params["dimension"]
                and m["preprocessing_revision"] == params["preprocessing_revision"]
            ]
        try:
            rows = await super().query(sql, params)
        finally:
            self.vectors = vectors
            self.manifests = manifests
        if "canonical-evidence" in sql:
            for row in rows:
                item = self.store.data.get(("evidence", row["evidence_id"]))
                if item is not None:
                    row["quote_hash"] = item["quote_hash"]
        return rows


class QueryProvider:
    def __init__(self):
        self.profile = profile()
        self.calls = []
        self.resolutions = []
        self.error = None
        self.on_call = None
        self.vector = [1.0, 0.0]

    def resolve_profile(self, identity):
        self.resolutions.append(identity)
        if identity != self.profile.profile_id:
            raise EmbeddingUnavailable("PROFILE_UNAVAILABLE")
        return self.profile

    async def embed_query(self, chosen, query, *, disclosure, dispatch_admission=None):
        if dispatch_admission is not None:
            await dispatch_admission()
        self.calls.append((chosen, query, disclosure))
        if self.on_call:
            await self.on_call()
        if self.error:
            raise self.error
        return self.vector


class Harness:
    def __init__(self, tmp_path, monkeypatch):
        module = importlib.import_module("api.evidence_retrieval")
        self.store = PhysicalStore()
        self.db = RetrievalDatabase(self.store)
        self.repository = EvidenceEmbeddingRepository(query=self.db.query)
        self.provider = QueryProvider()
        self.enabled = True
        self.evidence = EvidenceService(store=self.store, data_root=tmp_path)
        self.service = module.EvidenceRetrievalService(
            evidence=self.evidence,
            repository=self.repository,
            embeddings=self.provider,
            enabled=lambda: self.enabled,
        )
        monkeypatch.setattr(
            "open_notebook.database.project_locks.data_root", lambda: tmp_path
        )

    async def add(
        self, identity, texts, *, notebook=NB, origin="upload", restored=False
    ):
        extraction_id = "ex_" + identity
        version = {
            "source_version_id": identity,
            "source_id": "source:" + identity,
            "notebook_id": notebook,
            "source_title": identity,
            "origin": origin,
            "sha256": "a" * 64,
            "mime_type": "text/plain",
            "byte_size": 1,
            "file_path": "unused",
            "created_at": "2026-11-02T00:00:00+00:00",
            "current_extraction_id": extraction_id,
            "status": "ready",
        }
        if origin == "derived_snapshot":
            version["provenance"] = {
                "kind": "derived",
                "origin_kind": "note",
                "origin_id": "note:one",
                "origin_title": "A note",
                "authorship": "ai",
                "captured_at": version["created_at"],
                "content_sha256": "b" * 64,
            }
        self.db.members.add(version["source_id"])
        records = []
        blocks = []
        for index, text in enumerate(texts):
            eid = f"{identity}_{index:04d}"
            locator = {
                "block_id": str(index),
                "page_index": None,
                "start_offset": 0,
                "end_offset": len(text),
            }
            records.append(
                {
                    "evidence_id": eid,
                    "source_version_id": identity,
                    "extraction_id": extraction_id,
                    "notebook_id": notebook,
                    "source_title": identity,
                    "quote": text,
                    "quote_hash": hashlib.sha256(text.encode()).hexdigest(),
                    "locator": locator,
                    "evidence_kind": "derived_snapshot"
                    if origin == "derived_snapshot"
                    else "text",
                }
            )
            blocks.append({"block_id": str(index), "page_index": None, "text": text})
        extraction = {
            "extraction_id": extraction_id,
            "source_version_id": identity,
            "notebook_id": notebook,
            "status": "ready",
            "parser_name": "utf8",
            "parser_version": "1",
            "schema_version": 1,
            "blocks": blocks,
            "evidence_ids": [r["evidence_id"] for r in records],
            "created_at": version["created_at"],
        }
        if restored:
            extraction["verification_origin"] = "restored_archive"
        await self.store.put("version", identity, version)
        await self.store.put("extraction", extraction_id, extraction)
        for record in records:
            await self.store.put("evidence", record["evidence_id"], record)
        return records

    async def index(self, version_ids, vectors=None):
        p = self.provider.profile
        snapshot = await self.repository.capture_scope(NB, version_ids)
        self.db.manifests = []
        self.db.vectors = []
        for entry in snapshot.entries:
            extraction = self.store.data[("extraction", entry.extraction_id)]
            ids = extraction["evidence_ids"]
            pairs = [
                [eid, self.store.data[("evidence", eid)]["quote_hash"]] for eid in ids
            ]
            manifest = {
                "notebook_id": NB,
                "version_id": entry.version_id,
                "extraction_id": entry.extraction_id,
                "manifest_hash": entry.manifest_hash,
                "scope_epoch": entry.scope_epoch,
                "namespace": p.fingerprint,
                "dimension": p.dimension,
                "preprocessing_revision": p.preprocessing_revision,
                "attempt_id": "attempt:" + entry.version_id,
                "expected_count": len(ids),
                "vector_manifest_hash": _hash(sorted(pairs)),
                "state": "complete",
            }
            self.db.manifests.append(manifest)
            if len(ids) * p.dimension > 2_000_000 or len(ids) > 5000:
                continue
            for eid in ids:
                row = {
                    k: v
                    for k, v in manifest.items()
                    if k not in {"expected_count", "vector_manifest_hash", "state"}
                }
                row.update(
                    evidence_id=eid,
                    quote_hash=self.store.data[("evidence", eid)]["quote_hash"],
                    vector=(vectors or {}).get(eid, [1.0, 0.0]),
                )
                row["row_key"] = _vector_key(p, row)
                self.db.vectors.append(row)
        self.store.reads.clear()
        self.db.calls.clear()

    async def retrieve(self, query="quasar", ids=None, **kwargs):
        args = {
            "mode": "hybrid",
            "profile_id": self.provider.profile.profile_id,
            "acknowledge_query_processing": True,
            "disclosed_profile_fingerprint": self.provider.profile.fingerprint,
            "destination_descriptor_version": self.provider.profile.destination_descriptor_version,
        }
        args.update(kwargs)
        return await self.service.retrieve(
            query, NB, ["v1"] if ids is None else ids, **args
        )


@pytest.fixture
def h(tmp_path, monkeypatch):
    return Harness(tmp_path, monkeypatch)


def test_rrf_one_based_deduplicated_stable_top_48_and_limits():
    rrf = importlib.import_module("api.evidence_retrieval").rrf
    assert rrf(["a"], ["a"])[0] == ("a", 2 / 61)
    assert rrf(["b", "a"], ["a", "b"]) == [
        ("a", 1 / 61 + 1 / 62),
        ("b", 1 / 61 + 1 / 62),
    ]
    assert rrf(["a", "a", "b"], ["b"]) == [("b", 1 / 61 + 1 / 62), ("a", 1 / 61)]
    assert rrf([], []) == []
    assert len(rrf([f"a{i:03d}" for i in range(100)], [])) == 12
    result = rrf(
        [f"a{i:03d}" for i in range(100)], [f"b{i:03d}" for i in range(100)], limit=100
    )
    assert len(result) == 96
    assert not any(identity.endswith("048") for identity, _ in result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "selection", [[], ["missing"], ["v1", "missing"], ["foreign"], ["v1", "unready"]]
)
async def test_entire_scope_validates_before_content_or_profile(h, selection):
    await h.add("v1", ["Solar"])
    await h.add("foreign", ["private"], notebook="notebook:foreign")
    await h.add("unready", ["pending"])
    h.store.data[("version", "unready")]["status"] = "queued"
    with pytest.raises(InvalidInputError, match="NO_SOURCES_SELECTED|SCOPE_CHANGED"):
        await h.retrieve(ids=selection)
    assert h.store.reads == []
    assert h.provider.calls == []
    assert h.provider.resolutions == []
    assert not any("vector-" in sql for sql, _ in h.db.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["notebook", "membership", "extraction"])
async def test_metadata_authority_precedes_every_content_read(h, change):
    await h.add("v1", ["Solar"])
    if change == "notebook":
        h.db.notebook = False
    elif change == "membership":
        h.db.members.clear()
    else:
        h.store.data[("extraction", "ex_v1")]["status"] = "empty"
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await h.retrieve()
    assert h.store.reads == []
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["Solar", "太阳能"])
async def test_exact_lexical_is_legacy_algorithm_without_model_or_index(h, query):
    await h.add("v1", [d["text"] for d in FIXTURE["documents"]])
    legacy = await h.evidence.retrieve(query, ["v1"])
    result = await h.service.retrieve(query, NB, ["v1"])
    assert result.requested_method == result.retrieval_method == "lexical"
    assert [(v["evidence_id"], v["score"]) for v in result.hits] == [
        (v["evidence_id"], v["score"]) for v in legacy
    ]
    assert result.hits[0]["score"] == (6.1 if query == "Solar" else 7.2)
    assert result.selected_version_count == 1
    assert result.indexed_version_count == 0
    assert h.provider.resolutions == h.provider.calls == []
    assert not any(
        "index-manifests" in sql or "vector-" in sql for sql, _ in h.db.calls
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", FIXTURE["queries"][:2], ids=["synonym", "cross-lingual"]
)
async def test_synthetic_semantic_synonym_and_cross_lingual_routing(h, case):
    records = await h.add("v1", [d["text"] for d in FIXTURE["documents"]])
    await h.index(
        ["v1"],
        {r["evidence_id"]: d["vector"] for r, d in zip(records, FIXTURE["documents"])},
    )
    h.provider.vector = case["vector"]
    result = await h.retrieve(case["text"])
    expected = next(
        i for i, d in enumerate(FIXTURE["documents"]) if d["id"] == case["expected"]
    )
    assert result.hits[0]["evidence_id"] == records[expected]["evidence_id"]
    assert result.hits[0]["channels"] == ["semantic"]
    assert result.retrieval_method == "hybrid"
    assert result.indexed_version_count == result.selected_version_count == 1
    assert len(h.provider.calls) == 1
    pinned, sent, disclosure = h.provider.calls[0]
    assert pinned == h.provider.profile
    assert sent == case["text"]
    assert disclosure.disclosed_profile_fingerprint == pinned.fingerprint
    assert (
        disclosure.destination_descriptor_version
        == pinned.destination_descriptor_version
    )
    assert disclosure.acknowledge_query_processing is True


@pytest.mark.asyncio
async def test_below_threshold_is_hybrid_zero_hits_not_manufactured_or_fallback(h):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.provider.vector = FIXTURE["queries"][2]["vector"]
    empty_result = await h.retrieve(FIXTURE["queries"][2]["text"])
    assert empty_result.hits == []
    assert empty_result.retrieval_method == "hybrid"
    assert empty_result.fallback_reason is None
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_top_48_channels_fuse_and_default_12_final_hits(h):
    records = await h.add("v1", [f"Solar paragraph {i}" for i in range(60)])
    await h.index(["v1"])
    result = await h.retrieve("Solar")
    assert len(result.hits) == 12
    assert all(hit["channels"] == ["lexical", "semantic"] for hit in result.hits)
    assert result.hits[0]["score"] == 2 / 61
    assert [r["evidence_id"] for r in result.hits] == [
        r["evidence_id"] for r in records[:12]
    ]
    result = await h.retrieve("Solar", limit=100)
    assert len(result.hits) == 48


@pytest.mark.asyncio
async def test_tiny_scope_and_same_dim_foreign_namespace_never_supply_candidates(h):
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"], {records[0]["evidence_id"]: [0.0, 1.0]})
    for changes in [
        {"notebook_id": "notebook:foreign"},
        {"version_id": "foreign"},
        {"namespace": "f" * 64},
    ]:
        foreign = {
            **h.db.vectors[0],
            **changes,
            "evidence_id": "private",
            "vector": [1.0, 0.0],
        }
        h.db.vectors.append(foreign)
    result = await h.retrieve()
    assert result.hits == []
    assert result.retrieval_method == "hybrid"
    assert not any("private" in str(ids) for _, ids in h.store.reads)
    for sql, params in h.db.calls:
        if "vector-" in sql:
            assert "notebook_id = $notebook_id" in sql
            assert "namespace = $namespace" in sql
            assert "IN $bindings" in sql
            assert params["namespace"] == h.provider.profile.fingerprint


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reason",
    [
        "FEATURE_DISABLED",
        "PROFILE_UNAVAILABLE",
        "INDEX_NOT_READY",
        "INDEX_STALE",
        "QUERY_TOO_LONG",
    ],
)
async def test_preflight_fallback_uses_whole_lexical_scope_without_embedding(h, reason):
    await h.add("v1", ["Solar one"])
    await h.add("v2", ["Solar two"])
    await h.index(["v1", "v2"])
    kwargs = {}
    query = "Solar"
    if reason == "FEATURE_DISABLED":
        h.enabled = False
    elif reason == "PROFILE_UNAVAILABLE":
        kwargs["profile_id"] = "not-configured"
    elif reason == "INDEX_NOT_READY":
        h.db.manifests.pop()
    elif reason == "INDEX_STALE":
        h.db.manifests[-1]["scope_epoch"] += 1
    else:
        h.provider.profile = h.provider.profile.model_copy(
            update={"max_input_bytes": 2}
        )
    unready_result = await h.retrieve(query, ["v1", "v2"], **kwargs)
    assert unready_result.retrieval_method == "lexical_fallback"
    assert unready_result.fallback_reason == reason
    assert len(unready_result.hits) == 2
    assert {r["source_version_id"] for r in unready_result.hits} == {"v1", "v2"}
    unready_provider = h.provider
    assert unready_provider.calls == []
    assert not any("vector-payload" in sql for sql, _ in h.db.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("count,dimension", [(5001, 2), (489, 4096)])
async def test_row_and_actual_total_element_caps_fall_back_without_payload_or_call(
    h, count, dimension
):
    h.provider.profile = h.provider.profile.model_copy(update={"dimension": dimension})
    await h.add("v1", ["Solar"] * count)
    await h.index(["v1"])
    result = await h.retrieve("Solar")
    assert result.retrieval_method == "lexical_fallback"
    assert result.fallback_reason == "SCOPE_TOO_LARGE"
    assert len(result.hits) == 12
    assert h.provider.calls == []
    assert not any("vector-payload" in sql for sql, _ in h.db.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,reason",
    [
        (EmbeddingUnavailable(PRIVATE), "EMBEDDING_UNAVAILABLE"),
        (EmbeddingOutcomeUnknown(PRIVATE), "EMBEDDING_OUTCOME_UNKNOWN"),
        (EmbeddingResponseInvalid(PRIVATE), "EMBEDDING_UNAVAILABLE"),
    ],
)
async def test_provider_failure_fallback_is_sanitized_and_never_retried(
    h, error, reason
):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.provider.error = error
    result = await h.retrieve("Solar")
    assert result.retrieval_method == "lexical_fallback"
    assert result.fallback_reason == reason
    assert PRIVATE not in result.model_dump_json()
    assert len(h.provider.calls) == 1
    assert ("EMBEDDING_OUTCOME_UNKNOWN" in result.warnings) == (
        reason == "EMBEDDING_OUTCOME_UNKNOWN"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"disclosed_profile_fingerprint": "stale"}, "EMBEDDING_DISCLOSURE_STALE"),
        ({"destination_descriptor_version": "stale"}, "EMBEDDING_DISCLOSURE_STALE"),
        ({"disclosed_profile_fingerprint": None}, "EMBEDDING_DISCLOSURE_STALE"),
        ({"acknowledge_query_processing": False}, "EMBEDDING_ACKNOWLEDGMENT_REQUIRED"),
        ({"acknowledge_query_processing": "true"}, "EMBEDDING_ACKNOWLEDGMENT_REQUIRED"),
    ],
)
async def test_disclosure_is_strict_pinned_and_checked_even_when_index_unready(
    h, kwargs, code
):
    await h.add("v1", ["Solar"])
    with pytest.raises(InvalidInputError, match=code):
        await h.retrieve(**kwargs)
    assert h.provider.calls == []
    assert not any("vector-payload" in sql for sql, _ in h.db.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["delete", "reparse", "unlink", "epoch"])
async def test_scope_changes_after_query_dispatch_abort_instead_of_lexical_fallback(
    h, change
):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])

    async def mutate():
        if change == "delete":
            await h.store.delete("version", "v1")
        elif change == "reparse":
            h.store.data[("version", "v1")]["current_extraction_id"] = "fresh"
        elif change == "unlink":
            h.db.members.clear()
        else:
            h.db.epochs["v1"] = 1

    h.provider.on_call = mutate
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await h.retrieve("Solar")
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("evidence_id", "forged"),
        ("source_version_id", "foreign"),
        ("extraction_id", "old"),
        ("notebook_id", "notebook:foreign"),
        ("quote", "changed"),
        ("quote_hash", "f" * 64),
        (
            "locator",
            {"block_id": "0", "page_index": None, "start_offset": -1, "end_offset": 5},
        ),
        (
            "locator",
            {"block_id": "0", "page_index": 99, "start_offset": 0, "end_offset": 5},
        ),
    ],
)
async def test_canonical_corruption_is_hard_failure(h, field, value):
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.store.data[("evidence", records[0]["evidence_id"])][field] = value
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY|SCOPE_CHANGED"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["version", "extraction", "evidence"])
async def test_physical_canonical_ids_are_checked_not_just_payload_claims(h, kind):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])

    def corrupt(k, rows):
        if k == kind:
            next(iter(rows.values()))["id"] = record_key(kind, "rogue")

    h.store.transform = corrupt
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY|SCOPE_CHANGED"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_final_reread_rejects_content_mutation_after_embedding(h):
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"])

    async def mutate():
        h.store.data[("evidence", records[0]["evidence_id"])]["locator"]["block_id"] = (
            "missing"
        )

    h.provider.on_call = mutate
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert len([ids for kind, ids in h.store.reads if kind == "evidence"]) >= 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "point", ["scope-versions", "index-manifests", "vector-payload", "canonical-read"]
)
async def test_unreadable_scope_or_index_is_error_not_fallback_and_sanitized(h, point):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    if point == "canonical-read":
        h.store.fail = True
    else:
        h.db.error_at = point
    with pytest.raises(
        DatabaseOperationError, match="INDEX_READ_UNAVAILABLE"
    ) as caught:
        await h.retrieve("Solar")
    assert PRIVATE not in str(caught.value)
    assert caught.value.__cause__ is caught.value.__context__ is None
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code", ["INDEX_INTEGRITY", "INDEX_READ_UNAVAILABLE", "INDEX_COMMIT_UNKNOWN"]
)
async def test_repository_hard_errors_are_not_readiness_fallback(h, monkeypatch, code):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])

    async def fail(*args, **kwargs):
        raise DatabaseOperationError(code)

    monkeypatch.setattr(h.repository, "scoped_vectors", fail)
    with pytest.raises(DatabaseOperationError, match=code):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_restored_and_derived_provenance_are_not_upgraded_by_semantic_score(h):
    await h.add("restored", ["Solar archive"], restored=True)
    await h.add("derived", ["Solar derived"], origin="derived_snapshot")
    await h.index(["restored", "derived"])
    result = await h.retrieve("Solar", ["restored", "derived"])
    restored_hit = next(r for r in result.hits if r["source_version_id"] == "restored")
    derived_hit = next(r for r in result.hits if r["source_version_id"] == "derived")
    assert restored_hit["reference_validity"] == "unverified"
    assert derived_hit["independent_support"] is False
    assert derived_hit["provenance"]["authorship"] == "ai"
    assert all(r["channels"] == ["lexical", "semantic"] for r in result.hits)


@pytest.mark.asyncio
async def test_retained_old_version_allowed_newer_version_is_not_auto_selected(h):
    await h.add("v1", ["Solar old"])
    await h.add("v2", ["Solar new"])
    await h.index(["v1"])
    result = await h.retrieve("Solar", ["v1", "v1"])
    assert result.selected_version_count == 1
    assert {r["source_version_id"] for r in result.hits} == {"v1"}
    assert not any("v2" in ids or "ex_v2" in ids for _, ids in h.store.reads)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query,kwargs",
    [
        ("", {}),
        ("  ", {}),
        ("x" * 50001, {}),
        ("Solar", {"limit": 0}),
        ("Solar", {"limit": 101}),
        ("Solar", {"limit": True}),
        ("Solar", {"mode": "semantic"}),
        ("Solar", {"mode": "hybrid", "profile_id": None}),
        ("Solar", {"mode": "lexical", "profile_id": "chosen"}),
    ],
)
async def test_invalid_request_combinations_reject_before_any_io(h, query, kwargs):
    args = {"mode": "hybrid", "profile_id": "chosen"}
    args.update(kwargs)
    with pytest.raises(InvalidInputError):
        await h.service.retrieve(query, NB, ["v1"], **args)
    assert h.store.reads == h.provider.calls == h.db.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("vector", [[math.nan, 0.0], [0.0, 0.0], [1.0], [True, 0.0]])
async def test_corrupt_vectors_never_score_or_dispatch_query(h, vector):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.db.vectors[0]["vector"] = vector
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_lexical_no_hits_has_complete_metadata_without_embedding(h):
    await h.add("v1", ["Solar"])
    result = await h.service.retrieve("quasar", NB, ["v1"])
    assert result.hits == []
    assert result.requested_method == result.retrieval_method == "lexical"
    assert result.fallback_reason is result.profile_id is None
    assert result.selected_version_count == 1
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_explicit_on_device_descriptor_does_not_require_remote_ack(h):
    h.provider.profile = h.provider.profile.model_copy(
        update={"destination_kind": "on_device"}
    )
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    result = await h.retrieve("Solar", acknowledge_query_processing=False)
    assert result.retrieval_method == "hybrid"
    assert h.provider.calls[0][2].acknowledge_query_processing is False


@pytest.mark.asyncio
async def test_stale_disclosure_rejects_even_if_feature_disabled(h):
    await h.add("v1", ["Solar"])
    h.enabled = False
    with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
        await h.retrieve(disclosed_profile_fingerprint="old")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_profile_rotation_between_acceptance_and_dispatch_rejects(h, monkeypatch):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    original = h.repository.scoped_vectors

    async def rotate(*args, **kwargs):
        rows = await original(*args, **kwargs)
        h.provider.profile = h.provider.profile.model_copy(
            update={"revision": "rotated"}
        )
        return rows

    monkeypatch.setattr(h.repository, "scoped_vectors", rotate)
    with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_embedding_byte_budget_includes_query_prefix_without_truncation(h):
    h.provider.profile = h.provider.profile.model_copy(
        update={"query_prefix": "prefix:", "max_input_bytes": 10}
    )
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    result = await h.retrieve("Solar")
    assert result.fallback_reason == "QUERY_TOO_LONG"
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_inclusive_cosine_threshold_and_stable_id_ties(h):
    h.provider.profile = h.provider.profile.model_copy(update={"cosine_min_score": 0.4})
    records = await h.add("v1", ["one", "two", "three"])
    await h.index(["v1"], {r["evidence_id"]: [0.4, math.sqrt(0.84)] for r in records})
    result = await h.retrieve()
    assert [r["evidence_id"] for r in result.hits] == [
        r["evidence_id"] for r in records
    ]


@pytest.mark.asyncio
async def test_provider_failure_cannot_hide_concurrent_scope_deletion(h):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])

    async def mutate():
        await h.store.delete("version", "v1")

    h.provider.on_call = mutate
    h.provider.error = EmbeddingUnavailable("EMBEDDING_UNAVAILABLE")
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await h.retrieve("Solar")
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_provenance_is_reread_and_cannot_change_after_dispatch(h):
    await h.add("v1", ["Solar"], origin="derived_snapshot")
    await h.index(["v1"])

    async def mutate():
        h.store.data[("version", "v1")]["provenance"]["authorship"] = "human"

    h.provider.on_call = mutate
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")


@pytest.mark.asyncio
async def test_locator_end_must_be_within_canonical_block_not_python_slice_clamped(h):
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.store.data[("evidence", records[0]["evidence_id"])]["locator"]["end_offset"] = 999
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_cosine_divides_small_allowed_stored_norm_roundoff(h):
    h.provider.profile = h.provider.profile.model_copy(update={"cosine_min_score": 1.0})
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"], {records[0]["evidence_id"]: [0.999999, 0.0]})
    result = await h.retrieve()
    assert result.hits[0]["evidence_id"] == records[0]["evidence_id"]


@pytest.mark.asyncio
async def test_final_candidate_binding_cannot_trust_corrupt_repository_adapter(
    h, monkeypatch
):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    original = h.repository.scoped_vectors

    async def corrupted(*args, **kwargs):
        rows = await original(*args, **kwargs)
        rows[0]["quote_hash"] = "f" * 64
        return rows

    monkeypatch.setattr(h.repository, "scoped_vectors", corrupted)
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_invalid_unicode_query_is_sanitized_before_io(h):
    with pytest.raises(InvalidInputError, match="RETRIEVAL_QUERY_INVALID"):
        await h.retrieve("\ud800")
    assert h.store.reads == h.provider.calls == h.db.calls == []


@pytest.mark.asyncio
async def test_missing_canonical_evidence_is_integrity_failure(h):
    records = await h.add("v1", ["Solar"])
    await h.index(["v1"])
    await h.store.delete("evidence", records[0]["evidence_id"])
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_compatible_rebuild_between_status_and_vector_read_is_not_corruption(
    h, monkeypatch
):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    original = h.repository.status

    async def rebuild(*args, **kwargs):
        result = await original(*args, **kwargs)
        h.db.manifests[0]["attempt_id"] = "attempt:replacement"
        h.db.vectors[0]["attempt_id"] = "attempt:replacement"
        h.db.vectors[0]["row_key"] = _vector_key(h.provider.profile, h.db.vectors[0])
        return result

    monkeypatch.setattr(h.repository, "status", rebuild)
    result = await h.retrieve("Solar")
    assert result.retrieval_method == "hybrid"
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_profile_removed_before_dispatch_requires_fresh_disclosure(
    h, monkeypatch
):
    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    original = h.repository.scoped_vectors

    async def remove(*args, **kwargs):
        rows = await original(*args, **kwargs)
        h.provider.profile = h.provider.profile.model_copy(
            update={"profile_id": "other"}
        )
        return rows

    monkeypatch.setattr(h.repository, "scoped_vectors", remove)
    with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
        await h.retrieve("Solar")
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_malformed_revalidation_fresh_identity_is_integrity_not_raw_typeerror(h):
    await h.add("v1", ["Solar"], restored=True)
    await h.index(["v1"])
    extraction = h.store.data[("extraction", "ex_v1")]
    extraction["revalidation"] = {
        "fresh_extraction_id": {"not": "identity"},
        "evidence_ids": extraction["evidence_ids"],
    }
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.service.retrieve("Solar", NB, ["v1"])


@pytest.mark.asyncio
async def test_twenty_source_limit_rejects_before_content_and_model(h):
    with pytest.raises(InvalidInputError, match="SOURCE_LIMIT"):
        await h.retrieve(ids=[f"v{i}" for i in range(21)])
    assert h.store.reads == h.provider.calls == []


@pytest.mark.asyncio
async def test_cancellation_propagates_without_retry_or_fallback(h):
    import asyncio

    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    h.provider.error = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await h.retrieve("Solar")
    assert len(h.provider.calls) == 1


class ComposedQueryResolver:
    """Real client control flow, but no provider, credentials, sockets or DB."""

    def __init__(self):
        self.resolutions = []
        self.provisions = []
        self.calls = []
        self.closes = 0
        self.hooks = {}

    async def stage(self, name):
        from open_notebook.database.project_locks import try_project_lock

        # Every resolver/provision/backend boundary must run outside the project
        # barrier, including when the query admission seam is active.
        async with try_project_lock(NB) as acquired:
            assert acquired, "Project lock held over model/provider I/O"
        if callback := self.hooks.get(name):
            await callback()

    async def resolve(self, chosen):
        from open_notebook.ai.evidence_embeddings import FrozenEmbeddingConfiguration

        self.resolutions.append(chosen.model_id)
        await self.stage("resolve")
        return FrozenEmbeddingConfiguration(
            model_id=chosen.model_id,
            model_type="embedding",
            provider=chosen.provider,
            model_name=chosen.model_name,
            credential_binding_id=chosen.credential_binding_id,
            endpoint=chosen.endpoint,
            no_retry=True,
        )

    async def provision(self, config):
        self.provisions.append(config.model_id)
        await self.stage("provision")
        return self

    async def aembed(self, texts):
        self.calls.append(list(texts))
        await self.stage("send")
        return [[1.0, 0.0] for _ in texts]

    async def aclose(self):
        self.closes += 1


def compose_real_client(h, monkeypatch, profiles=None):
    import asyncio

    from open_notebook.ai import evidence_embeddings as embedding_module

    class SlotObservedClient(embedding_module.EvidenceEmbeddingClient):
        async def _batch(self, profile, texts, disclosure):
            entered.set()
            return await super()._batch(profile, texts, disclosure)

    entered = asyncio.Event()
    resolver = ComposedQueryResolver()
    current = (
        {h.provider.profile.profile_id: h.provider.profile}
        if profiles is None
        else profiles
    )
    client = SlotObservedClient(
        profile_loader=lambda: current,
        resolver=resolver,
        enabled=lambda: True,
    )
    h.service.embeddings = client
    monkeypatch.setattr(
        embedding_module, "_ensure_safe_transport_logging", lambda: None
    )
    return client, resolver, entered, current


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["slot", "resolve", "provision"])
async def test_real_client_scope_admission_after_slot_and_each_dispatch_boundary(
    h, monkeypatch, stage
):
    import asyncio

    from open_notebook.ai import evidence_embeddings as embedding_module
    from open_notebook.database.project_locks import project_lock

    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    _, resolver, entered, _ = compose_real_client(h, monkeypatch)

    async def revoke():
        async with project_lock(NB):
            h.db.members.clear()
            h.db.epochs["v1"] = 1

    if stage == "slot":
        async with embedding_module._slot():
            pending = asyncio.create_task(h.retrieve("Solar"))
            await asyncio.wait_for(entered.wait(), timeout=2)
            await revoke()
        with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
            await pending
    else:
        resolver.hooks[stage] = revoke
        with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
            await h.retrieve("Solar")
    assert resolver.provisions == (
        [] if stage != "provision" else [h.provider.profile.model_id]
    )
    assert resolver.calls == []
    assert resolver.closes == (1 if stage == "provision" else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["slot", "resolve", "provision"])
@pytest.mark.parametrize("change", ["remove", "invalid"])
async def test_real_client_accepted_profile_unavailable_at_every_check_is_stale(
    h, monkeypatch, stage, change
):
    import asyncio

    from open_notebook.ai import evidence_embeddings as embedding_module

    await h.add("v1", ["Solar"])
    await h.index(["v1"])
    _, resolver, entered, current = compose_real_client(h, monkeypatch)

    async def rotate():
        if change == "remove":
            current.clear()
        else:
            current[h.provider.profile.profile_id] = h.provider.profile.model_copy(
                update={"dimension": 0}
            )

    if stage == "slot":
        async with embedding_module._slot():
            pending = asyncio.create_task(h.retrieve("Solar"))
            await asyncio.wait_for(entered.wait(), timeout=2)
            await rotate()
        with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
            await pending
    else:
        resolver.hooks[stage] = rotate
        with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
            await h.retrieve("Solar")
    assert resolver.provisions == (
        [] if stage != "provision" else [h.provider.profile.model_id]
    )
    assert resolver.calls == []


@pytest.mark.asyncio
async def test_real_client_initial_unavailable_profile_retains_explicit_fallback(
    h, monkeypatch
):
    await h.add("v1", ["Solar"])
    _, resolver, _, _ = compose_real_client(h, monkeypatch, profiles={})
    result = await h.retrieve("Solar")
    assert result.retrieval_method == "lexical_fallback"
    assert result.fallback_reason == "PROFILE_UNAVAILABLE"
    assert resolver.resolutions == resolver.provisions == resolver.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", [None, "local", "unknown"])
async def test_real_client_cannot_upgrade_extraction_verification_origin(
    h, monkeypatch, replacement
):
    await h.add("v1", ["Solar"], restored=True)
    await h.index(["v1"])
    _, resolver, _, _ = compose_real_client(h, monkeypatch)

    async def mutate():
        extraction = h.store.data[("extraction", "ex_v1")]
        if replacement is None:
            extraction.pop("verification_origin")
        else:
            extraction["verification_origin"] = replacement

    resolver.hooks["send"] = mutate
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await h.retrieve("Solar")
    assert len(resolver.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("fresh_state", ["valid", "restored", "wrong_text"])
async def test_real_client_unchanged_archive_marker_allows_only_independent_revalidation(
    h, monkeypatch, fresh_state
):
    await h.add("v1", ["Solar"], restored=True)
    await h.index(["v1"])
    _, resolver, _, _ = compose_real_client(h, monkeypatch)

    async def revalidate():
        original = h.store.data[("extraction", "ex_v1")]
        fresh = {**deepcopy(original), "extraction_id": "ex_fresh"}
        if fresh_state != "restored":
            fresh.pop("verification_origin")
        if fresh_state == "wrong_text":
            fresh["blocks"][0]["text"] = "Other"
        await h.store.put("extraction", "ex_fresh", fresh)
        original["revalidation"] = {
            "fresh_extraction_id": "ex_fresh",
            "evidence_ids": original["evidence_ids"],
        }

    resolver.hooks["send"] = revalidate
    result = await h.retrieve("Solar")
    assert result.hits[0]["reference_validity"] == (
        "verified" if fresh_state == "valid" else "unverified"
    )
    assert (
        h.store.data[("extraction", "ex_v1")]["verification_origin"]
        == "restored_archive"
    )
