"""Composed offline journey, not live SQL/provider/queue or quality acceptance.

Only storage RPCs, model output and queue transport are fake. Real ingest/parser,
repository scope/manifest/vector checks, indexing admission/worker, retrieval,
grounded generation/citation validation and unlink route remain in the path.
"""

import asyncio
import importlib
import json
from contextlib import asynccontextmanager
from copy import deepcopy
from typing import Any

import pytest
from test_evidence_indexing_jobs import IndexDatabase
from test_v1_evidence_ingest import MemoryStore

from api.evidence_indexing import EvidenceIndexingService, IndexRequest
from api.evidence_retrieval import EvidenceRetrievalService
from api.evidence_service import EvidenceService
from api.personal_store import record_key
from open_notebook.ai.evidence_embeddings import EmbeddingOutcomeUnknown
from open_notebook.database.evidence_embedding_repository import (
    EvidenceEmbeddingRepository,
    _hash,
)
from open_notebook.domain.evidence_retrieval import EmbeddingProfile
from open_notebook.exceptions import InvalidInputError
from open_notebook.graphs.grounded_chat import GroundedChatService

NB = "notebook:allowed"
OTHER = "notebook:private"


class AcceptanceStore(MemoryStore):
    """Physical reads and the same project barrier used by repository services."""

    def __init__(self):
        super().__init__()
        self.rows = self.data  # Existing fake transaction adapter's backing table.
        self.content_reads = []

    async def get_many(self, kind, identities):
        rows = await super().get_many(kind, identities)
        for identity, row in rows.items():
            if row is not None:
                row["id"] = record_key(kind, identity)
        if kind in {"evidence", "extraction"}:
            self.content_reads.append((kind, tuple(identities)))
        return rows

    async def list(self, kind, *args, **kwargs):
        assert kind not in {"evidence", "extraction"}, "Global content scan"
        return await super().list(kind, *args, **kwargs)

    @asynccontextmanager
    async def project_lock(self, notebook_id):
        from open_notebook.database.project_locks import project_lock

        async with project_lock(notebook_id):
            yield

    async def invalidate_evidence_scope(self, notebook_id, ids, reason):
        await EvidenceEmbeddingRepository().invalidate_locked(notebook_id, ids, reason)


class AcceptanceDatabase(IndexDatabase):
    """Bound query projections plus existing fake transactional job/CAS adapter.

    This fake intentionally retains revoked vector bytes. Epoch/manifest guards,
    rather than successful physical deletion, must make them unusable.
    """

    def __init__(self, store):
        super().__init__(store)
        self.links: dict[str, set[str]] = {NB: set(), OTHER: set()}
        self.vectors: list[dict[str, Any]] = []
        self.manifests: list[dict[str, Any]] = []

    def sync(self):
        self.versions = {
            identity: deepcopy(row)
            for (kind, identity), row in self.store.data.items()
            if kind == "version"
        }
        self.extractions = {
            identity: deepcopy(row)
            for (kind, identity), row in self.store.data.items()
            if kind == "extraction"
        }

    async def query(self, sql, params=None):
        self.sync()
        params = params or {}
        self.calls.append((sql, deepcopy(params)))
        if "scope-notebook" in sql:
            identity = str(params["notebook_target"])
            return [{"id": identity}] if identity in self.links else []
        if "scope-versions" in sql or "scope-extractions" in sql:
            versions = "scope-versions" in sql
            rows = self.versions if versions else self.extractions
            fields = (
                (
                    "source_version_id",
                    "source_id",
                    "notebook_id",
                    "status",
                    "current_extraction_id",
                )
                if versions
                else (
                    "extraction_id",
                    "source_version_id",
                    "notebook_id",
                    "status",
                    "parser_name",
                    "parser_version",
                    "schema_version",
                    "evidence_ids",
                )
            )
            return [
                {
                    "id": record_key("version" if versions else "extraction", identity),
                    **{field: deepcopy(row.get(field)) for field in fields},
                }
                for identity, row in rows.items()
                if identity in params["version_ids" if versions else "extraction_ids"]
            ]
        if "scope-membership" in sql:
            return [
                {"in": source, "out": str(params["notebook_target"])}
                for source in self.links.get(str(params["notebook_target"]), set())
                if source in {str(value) for value in params["sources"]}
            ]
        if sql.startswith("DELETE FROM reference"):
            notebook = str(params["notebook_id"])
            source = str(params["source_id"])
            self.links[notebook].discard(source)
            return []
        if "index-input-membership" in sql:
            return [
                {"id": target, **deepcopy(self.extractions[identity])}
                for target, identity in zip(params["targets"], params["extraction_ids"])
            ]
        if "index-input-content" in sql or "canonical-evidence" in sql:
            content = "index-input-content" in sql
            return [
                {
                    "id": record_key("evidence", identity),
                    "evidence_id": identity,
                    "version_id": row["source_version_id"],
                    "extraction_id": row["extraction_id"],
                    "notebook_id": row["notebook_id"],
                    "quote_hash": row["quote_hash"],
                    **({"quote": row["quote"]} if content else {}),
                }
                for (kind, identity), row in self.store.data.items()
                if kind == "evidence"
                and identity in params["evidence_ids"]
                and row["notebook_id"] == params["notebook_id"]
                and row["source_version_id"] in params["version_ids"]
                and [row["source_version_id"], row["extraction_id"]] in params["pairs"]
            ]
        # Evaluate the real repository's bound predicates before payload access.
        vectors, manifests = self.vectors, self.manifests
        if "vector-" in sql:
            assert "WHERE notebook_id = $notebook_id" in sql
            assert "IN $bindings" in sql
            self.vectors = [
                row
                for row in vectors
                if row["notebook_id"] == params["notebook_id"]
                and all(
                    row[key] == params[key]
                    for key in ("namespace", "dimension", "preprocessing_revision")
                )
                and [
                    row[key]
                    for key in (
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
                row
                for row in manifests
                if row["notebook_id"] == params["notebook_id"]
                and row["version_id"] in params["version_ids"]
                and all(
                    row[key] == params[key]
                    for key in ("namespace", "dimension", "preprocessing_revision")
                )
            ]
        try:
            return await super().query(sql, params)
        finally:
            self.vectors, self.manifests = vectors, manifests

    async def query_raw(self, sql, params):
        self.sync()
        return await super().query_raw(sql, params)


class AcceptanceProvider:
    def __init__(self):
        self.profile = EmbeddingProfile(
            profile_id="synthetic-offline-only",
            model_id="model:nonfunctional-placeholder",
            provider="ollama",
            model_name="NONFUNCTIONAL_OFFLINE_FIXTURE",
            revision="NONFUNCTIONAL_REVISION",
            endpoint="https://embedding.invalid/offline-only",
            credential_binding_id="credential:nonfunctional-placeholder",
            dimension=2,
            document_prefix="",
            query_prefix="",
            preprocessing_revision="evidence-identity-v1",
            max_input_bytes=2000,
            cosine_min_score=0.4,
            destination_descriptor_version="offline-v1",
        )
        self.documents = []
        self.queries = []
        self.resolutions = []
        self.document_hook = None
        self.query_error = None

    def resolve_profile(self, identity):
        assert identity == self.profile.profile_id
        self.resolutions.append(identity)
        return self.profile

    async def embed_documents(self, chosen, texts, *, dispatch_admission=None):
        if dispatch_admission is not None:
            await dispatch_admission()
        assert chosen == self.profile
        self.documents.append(list(texts))
        if self.document_hook:
            await self.document_hook()
        return [[1.0, 0.0] for _ in texts]

    async def embed_query(self, chosen, query, *, disclosure, dispatch_admission):
        assert chosen == self.profile
        await dispatch_admission()
        self.queries.append(query)
        if self.query_error:
            raise self.query_error
        return [1.0, 0.0]


class AcceptanceJourney:
    def __init__(self, tmp_path, monkeypatch):
        self.store = AcceptanceStore()
        self.db = AcceptanceDatabase(self.store)
        repository_module = importlib.import_module(
            "open_notebook.database.evidence_embedding_repository"
        )
        monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("STUDY_WORKBENCH_HYBRID_ENABLED", "true")
        monkeypatch.setattr(
            "open_notebook.database.project_locks.data_root", lambda: tmp_path
        )
        monkeypatch.setattr(repository_module, "repo_query", self.db.query)

        @asynccontextmanager
        async def connection():
            yield self.db

        monkeypatch.setattr(repository_module, "db_connection", connection)
        self.repository = EvidenceEmbeddingRepository()
        self.provider = AcceptanceProvider()
        self.queue = []
        self.indexing = EvidenceIndexingService(
            store=self.store,
            repository=self.repository,
            embeddings=self.provider,
            submit=self.enqueue,
            profiles=lambda: {self.provider.profile.profile_id: self.provider.profile},
        )
        self.evidence = EvidenceService(store=self.store, data_root=tmp_path)
        self.retrieval = EvidenceRetrievalService(
            evidence=self.evidence,
            repository=self.repository,
            embeddings=self.provider,
        )
        self.prompts = []
        self.chat = GroundedChatService(
            evidence_service=self.evidence,
            retrieval_service=self.retrieval,
            model=self.answer,
        )

    async def enqueue(self, command, args):
        assert command == "index_evidence" and set(args) == {"job_id"}
        self.queue.append((command, deepcopy(args)))
        return "command:" + args["job_id"]

    async def answer(self, messages):
        payload = json.loads(messages[-1]["content"])
        self.prompts.append(payload)
        hit = payload["evidence"][0]
        return {
            "answer": "Supported excerpt [c1]",
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": hit["evidence_id"],
                    "quote": hit["quote"],
                }
            ],
        }

    async def add(self, notebook, source, content):
        self.db.links[notebook].add(source)
        version = await self.evidence.ingest(
            notebook,
            source,
            "Synthetic source",
            content.encode(),
            filename="fixture.txt",
        )
        extraction = await self.evidence.extract(version["source_version_id"])
        return version["source_version_id"], extraction

    def options(self):
        return dict(
            mode="hybrid",
            profile_id=self.provider.profile.profile_id,
            acknowledge_query_processing=True,
            disclosed_profile_fingerprint=self.provider.profile.fingerprint,
            destination_descriptor_version=self.provider.profile.destination_descriptor_version,
        )

    async def build(self, notebook, ids, key):
        preview = await self.indexing.preview(
            notebook, ids, self.provider.profile.profile_id
        )
        request = IndexRequest(
            source_version_ids=ids,
            profile_id=preview.profile.profile_id,
            preview_hash=preview.preview_hash,
            acknowledge_external_processing=True,
            idempotency_key=key,
        )
        receipt = await self.indexing.submit(notebook, request)
        assert await self.indexing.submit(notebook, request) == receipt
        return preview, receipt


@pytest.fixture
def journey(tmp_path, monkeypatch):
    return AcceptanceJourney(tmp_path, monkeypatch)


@pytest.mark.asyncio
async def test_explicit_index_search_turn_citation_and_revoke(journey, monkeypatch):
    f = journey
    old, old_extraction = await f.add(
        NB, "source:public", "Old retained sunlight wording."
    )
    new, new_extraction = await f.add(
        NB,
        "source:public",
        "太阳能板把光转成电流。\n\nA photovoltaic cell converts light into electric current.",
    )
    private, _ = await f.add(OTHER, "source:private", "PRIVATE OTHER NOTEBOOK SENTINEL")
    assert old != new
    assert (
        await f.evidence.resolve_file(old)
    ).read_text() == "Old retained sunlight wording."
    assert (await f.evidence.evidence(old_extraction["evidence_ids"][0]))[
        "source_version_id"
    ] == old
    assert f.provider.documents == f.provider.queries == f.queue == []

    # Preview/status do not embed, and even one invalid selection blocks ALL work.
    before = len(f.db.calls), len(f.store.content_reads), len(f.provider.resolutions)
    for invalid in ([], [new, private], [new, "missing"]):
        with pytest.raises(InvalidInputError):
            await f.retrieval.retrieve("electrical output", NB, invalid, **f.options())
    assert len(f.store.content_reads) == before[1]
    assert len(f.provider.resolutions) == before[2]
    assert not any(
        "index-input-content" in sql or "vector-payload" in sql
        for sql, _ in f.db.calls[before[0] :]
    )

    _, private_receipt = await f.build(OTHER, [private], "private-explicit-build")
    assert (await f.indexing.run(private_receipt.job_ids[0]))["state"] == "succeeded"
    public_queue_start = len(f.queue)
    preview, receipt = await f.build(NB, [new, old], "one-explicit-build")
    assert preview.evidence_count == len(old_extraction["evidence_ids"]) + len(
        new_extraction["evidence_ids"]
    )
    assert (
        len(receipt.jobs)
        == len(receipt.job_ids)
        == len(f.queue) - public_queue_start
        == 2
    )
    await f.indexing.status(NB, [old, new])
    assert len(f.provider.documents) == 1 and f.provider.queries == []
    for _, args in f.queue[public_queue_start:]:
        assert (await f.indexing.run(args["job_id"]))["state"] == "succeeded"
    assert len(f.provider.documents) == 3
    public_texts = [text for batch in f.provider.documents[1:] for text in batch]
    expected_texts = [
        (await f.evidence.evidence(identity))["quote"]
        for identity in old_extraction["evidence_ids"] + new_extraction["evidence_ids"]
    ]
    assert sorted(public_texts) == sorted(expected_texts)
    snapshot = await f.repository.capture_scope(NB, [old, new])
    status = await f.repository.status(snapshot, f.provider.profile)
    assert status["state"] == "ready" and status["indexed_version_count"] == 2
    assert (
        sum(m["expected_count"] for m in status["manifests"]) == preview.evidence_count
    )
    vectors = await f.repository.scoped_vectors(snapshot, f.provider.profile)
    assert len(vectors) == preview.evidence_count
    assert {row["evidence_id"] for row in vectors} == set(
        old_extraction["evidence_ids"] + new_extraction["evidence_ids"]
    )
    for manifest in status["manifests"]:
        pairs = sorted(
            [
                [row["evidence_id"], row["quote_hash"]]
                for row in vectors
                if row["version_id"] == manifest["version_id"]
            ]
        )
        assert manifest["vector_manifest_hash"] == _hash(pairs)

    result = await f.retrieval.retrieve("electrical output", NB, [new], **f.options())
    assert result.retrieval_method == "hybrid" and result.hits
    assert {hit["source_version_id"] for hit in result.hits} == {new}
    assert all(
        "PRIVATE" not in hit["quote"] and "Old retained" not in hit["quote"]
        for hit in result.hits
    )
    request = dict(
        engine="independent",
        selection_origin="local",
        source_version_ids=[new],
        message="electrical output",
        idempotency_key="one-turn",
        retrieval_mode="hybrid",
        embedding_profile_id=f.provider.profile.profile_id,
        acknowledge_query_processing=True,
        disclosed_profile_fingerprint=f.provider.profile.fingerprint,
        destination_descriptor_version=f.provider.profile.destination_descriptor_version,
    )
    turn = await f.chat.turn(NB, "chat:synthetic", request)
    assert (
        turn["status"] == "succeeded"
        and turn["grounding_status"] == "references_verified"
    )
    assert turn["retrieval"]["retrieval_method"] == "hybrid"
    assert all(hit["source_version_id"] == new for hit in f.prompts[0]["evidence"])
    citation = turn["citations"][0]
    canonical = await f.evidence.evidence(citation["evidence_id"])
    assert (
        citation["source_version_id"] == new
        and canonical["extraction_id"] == new_extraction["extraction_id"]
    )
    assert (
        citation["locator"] == canonical["locator"]
        and citation["quote"] == canonical["quote"]
    )
    reread = await f.evidence.validate_citation(citation, [new], turn["evidence_ids"])
    assert (
        reread["reference_validity"] == "verified"
        and reread["locator"] == citation["locator"]
    )
    calls = len(f.provider.queries), len(f.prompts), len(f.queue)
    assert await f.chat.turn(NB, "chat:synthetic", request) == turn
    assert (len(f.provider.queries), len(f.prompts), len(f.queue)) == calls

    # Unknown query outcome falls back once, never silently replays.
    f.provider.query_error = EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")
    fallback = await f.retrieval.retrieve("photovoltaic", NB, [new], **f.options())
    assert fallback.retrieval_method == "lexical_fallback"
    assert fallback.fallback_reason == "EMBEDDING_OUTCOME_UNKNOWN"
    assert len(f.provider.queries) == calls[0] + 1
    f.provider.query_error = None

    # Real worker is suspended inside the fake provider, then real unlink route
    # revokes every retained version before removing the membership reference.
    _, late = await f.build(NB, [new], "explicit-late-build")
    entered, release = asyncio.Event(), asyncio.Event()

    async def delayed():
        entered.set()
        await release.wait()

    f.provider.document_hook = delayed
    running = asyncio.create_task(f.indexing.run(late.job_ids[0]))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        from api.routers import notebooks

        async def notebook_metadata(identity):
            assert identity == NB
            return {"id": identity}

        monkeypatch.setattr(notebooks.Notebook, "get", notebook_metadata)
        monkeypatch.setattr(notebooks, "repo_query", f.db.query)
        await notebooks.remove_source_from_notebook(NB, "source:public")
    finally:
        release.set()
    finished = await asyncio.wait_for(running, 3)
    assert (
        finished["state"] == "failed" and finished["error"]["code"] == "SCOPE_CHANGED"
    )
    assert f.db.epochs[old] == f.db.epochs[new] == 1
    assert f.db.vectors  # Cleanup was deliberately ineffective in the fake DB.
    assert not any(row["attempt_id"] == late.job_ids[0] for row in f.db.vectors)
    after = len(f.provider.documents), len(f.provider.queries), len(f.queue)
    assert await f.indexing.run(late.job_ids[0]) == finished
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await f.retrieval.retrieve("photovoltaic", NB, [new], **f.options())
    assert (len(f.provider.documents), len(f.provider.queries), len(f.queue)) == after
    # Restoring membership alone cannot revive the revoked epoch's vectors.
    f.db.links[NB].add("source:public")
    stale = await f.retrieval.retrieve("photovoltaic", NB, [new], **f.options())
    assert (
        stale.retrieval_method == "lexical_fallback"
        and stale.fallback_reason == "INDEX_STALE"
    )
    assert len(f.provider.queries) == after[1]
    # Historical canonical citation identity survives derived-vector revocation.
    assert (await f.evidence.evidence(citation["evidence_id"]))["locator"] == citation[
        "locator"
    ]


@pytest.mark.asyncio
async def test_lexical_remains_usable_with_hybrid_disabled(journey, monkeypatch):
    f = journey
    version, _ = await f.add(
        NB, "source:lexical", "A photovoltaic cell converts sunlight into electricity."
    )
    monkeypatch.setenv("STUDY_WORKBENCH_HYBRID_ENABLED", "false")
    result = await f.retrieval.retrieve("photovoltaic", NB, [version])
    assert result.retrieval_method == "lexical" and len(result.hits) == 1
    turn = await f.chat.turn(
        NB,
        "chat:lexical",
        dict(
            engine="independent",
            selection_origin="local",
            source_version_ids=[version],
            message="photovoltaic",
            idempotency_key="lexical",
        ),
    )
    assert (
        turn["status"] == "succeeded"
        and turn["retrieval"]["retrieval_method"] == "lexical"
    )
    outline = await f.chat.turn(
        NB,
        "chat:outline",
        dict(
            engine="independent",
            selection_origin="local",
            task="outline",
            source_version_ids=[version],
            message="Outline",
            idempotency_key="outline",
        ),
    )
    assert outline["retrieval"]["retrieval_method"] == "selected_overview"
    assert (
        f.provider.documents
        == f.provider.queries
        == f.provider.resolutions
        == f.queue
        == []
    )
