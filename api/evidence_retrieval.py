"""Explicit whole-scope lexical/hybrid retrieval over canonical evidence.

Vector rows are candidates, never citations. Each request authorizes its complete
scope before content/model work, and fresh canonical reads plus scope validation
bind the final response. This adds no automatic indexing, provider selection or
application retries. Ranking scores are not confidence or evidence validity.
"""

from copy import deepcopy
from typing import Literal

import numpy as np

from api.evidence_service import EvidenceService, _lexical_score, _sha, _terms
from api.personal_store import READ_BATCH_SIZE, record_key
from open_notebook.ai.evidence_embeddings import (
    DispatchAdmission,
    EmbeddingDisclosureStale,
    EmbeddingInputInvalid,
    EmbeddingOutcomeUnknown,
    EmbeddingResponseInvalid,
    EmbeddingUnavailable,
    EvidenceEmbeddingClient,
    hybrid_enabled,
)
from open_notebook.database.evidence_embedding_repository import (
    EvidenceEmbeddingRepository,
    _hash,
)
from open_notebook.domain.evidence import EvidenceRecord, Extraction, SourceVersion
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    QueryEmbeddingDisclosure,
    RetrievalResult,
    ScopeSnapshot,
)
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

CHANNEL_LIMIT = 48
RRF_CONSTANT = 60
ROW_CAP = 5000
ELEMENT_CAP = 2_000_000
QUERY_CHAR_CAP = 50_000


def _limit(limit: int) -> None:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise InvalidInputError("RETRIEVAL_LIMIT_INVALID")


def rrf(
    lexical_ids: list[str], semantic_ids: list[str], limit: int = 12
) -> list[tuple[str, float]]:
    """One-based RRF; duplicates do not consume ranks, ties use evidence ID."""
    _limit(limit)
    scores: dict[str, float] = {}
    for channel in (lexical_ids, semantic_ids):
        for rank, identity in enumerate(
            list(dict.fromkeys(channel))[:CHANNEL_LIMIT], start=1
        ):
            scores[identity] = scores.get(identity, 0.0) + 1 / (RRF_CONSTANT + rank)
    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:limit]


class _CanonicalReads:
    """Fresh per-phase physical-ID reads; never reused for final rerevalidation."""

    def __init__(self, store):
        self.store = store
        self.rows: dict[tuple[str, str], dict | None] = {}

    async def prefetch(self, kind, identities):
        invalid = False
        try:
            for identity in identities:
                record_key(kind, identity)
        except ValueError:
            invalid = True
        if invalid:
            raise InvalidInputError("INDEX_INTEGRITY") from None
        pending = list(
            dict.fromkeys(i for i in identities if (kind, i) not in self.rows)
        )
        for offset in range(0, len(pending), READ_BATCH_SIZE):
            batch = pending[offset : offset + READ_BATCH_SIZE]
            failed = False
            try:
                rows = await self.store.get_many(kind, batch)
            except Exception:
                failed = True
            # Raise outside the handler: diagnostics/cause/context are not safe.
            if failed:
                raise DatabaseOperationError("INDEX_READ_UNAVAILABLE") from None
            if not isinstance(rows, dict) or set(rows) != set(batch):
                raise InvalidInputError("INDEX_INTEGRITY")
            for identity in batch:
                row = rows[identity]
                if row is None:
                    self.rows[kind, identity] = None
                elif (
                    not isinstance(row, dict)
                    or str(row.get("id")) != record_key(kind, identity)
                    or not isinstance(row.get("payload"), dict)
                ):
                    raise InvalidInputError("INDEX_INTEGRITY")
                else:
                    self.rows[kind, identity] = deepcopy(row["payload"])

    async def get(self, kind, identity):
        await self.prefetch(kind, [identity])
        return deepcopy(self.rows[kind, identity])


class EvidenceRetrievalService:
    def __init__(
        self, *, evidence=None, repository=None, embeddings=None, enabled=hybrid_enabled
    ):
        self.evidence = evidence or EvidenceService()
        self.repository = repository or EvidenceEmbeddingRepository()
        self.embeddings = embeddings or EvidenceEmbeddingClient()
        self.enabled = enabled

    async def _metadata(self, snapshot, reads):
        versions = [e.version_id for e in snapshot.entries]
        await reads.prefetch("version", versions)
        await reads.prefetch("extraction", [e.extraction_id for e in snapshot.entries])
        result = {}
        for entry in snapshot.entries:
            version = await reads.get("version", entry.version_id)
            extraction = await reads.get("extraction", entry.extraction_id)
            if (
                not version
                or not extraction
                or version.get("source_version_id") != entry.version_id
                or version.get("notebook_id") != snapshot.notebook_id
                or version.get("current_extraction_id") != entry.extraction_id
                or version.get("status") not in {"ready", "partial"}
                or extraction.get("extraction_id") != entry.extraction_id
                or extraction.get("source_version_id") != entry.version_id
                or extraction.get("notebook_id") != snapshot.notebook_id
                or extraction.get("status") not in {"ready", "partial"}
            ):
                raise InvalidInputError("SCOPE_CHANGED")
            invalid = False
            try:
                SourceVersion.model_validate(version, strict=True)
                Extraction.model_validate(extraction, strict=True)
            except Exception:
                invalid = True
            if invalid:
                raise InvalidInputError("INDEX_INTEGRITY") from None
            ids = extraction.get("evidence_ids")
            if (
                not isinstance(ids, list)
                or any(not i or len(i) > 512 for i in ids)
                or len(ids) != len(set(ids))
            ):
                raise InvalidInputError("INDEX_INTEGRITY")
            result[entry.version_id] = (version, extraction)
        return result

    @staticmethod
    def _checked_record(record, identity, snapshot, version, extraction):
        invalid = False
        try:
            EvidenceRecord.model_validate(record, strict=True)
            quote_hash = _sha(record["quote"].encode())
        except Exception:
            invalid = True
        if invalid:
            raise InvalidInputError("INDEX_INTEGRITY") from None
        if (
            record["evidence_id"] != identity
            or record["source_version_id"] != version["source_version_id"]
            or record["extraction_id"] != extraction["extraction_id"]
            or record["notebook_id"] != snapshot.notebook_id
            or record["source_title"] != version["source_title"]
            or identity not in extraction["evidence_ids"]
            or not record["quote"].strip()
            or quote_hash != record["quote_hash"]
        ):
            raise InvalidInputError("INDEX_INTEGRITY")
        kind = (
            "derived_snapshot"
            if version.get("origin", "upload") == "derived_snapshot"
            else "remote_text_snapshot"
            if version.get("origin", "upload")
            in {"remote_text_snapshot", "web_snapshot"}
            else "pdf_text"
            if version["mime_type"] == "application/pdf"
            else "text"
        )
        locator = record["locator"]
        blocks = [
            b for b in extraction["blocks"] if b.get("block_id") == locator["block_id"]
        ]
        if (
            record["evidence_kind"] != kind
            or len(blocks) != 1
            or not isinstance(blocks[0].get("text"), str)
            or locator.get("page_index") != blocks[0].get("page_index")
            or locator["end_offset"] <= locator["start_offset"]
            or locator["end_offset"] > len(blocks[0]["text"])
            or blocks[0]["text"][locator["start_offset"] : locator["end_offset"]]
            != record["quote"]
        ):
            raise InvalidInputError("INDEX_INTEGRITY")
        return record

    async def _lexical(self, query, snapshot):
        # capture_scope already validated ALL selected metadata before this phase.
        reads = _CanonicalReads(self.evidence.store)
        metadata = await self._metadata(snapshot, reads)
        records = {}
        normalized_query, terms = _terms(query)
        candidates = []
        for entry in snapshot.entries:
            version, extraction = metadata[entry.version_id]
            invalid = False
            try:
                selected = await self.evidence.list_evidence(
                    entry.version_id, entry.extraction_id, _reads=reads
                )
            except (InvalidInputError, NotFoundError):
                invalid = True
            if invalid:
                raise InvalidInputError("INDEX_INTEGRITY") from None
            for identity, record in zip(extraction["evidence_ids"], selected):
                self._checked_record(record, identity, snapshot, version, extraction)
                if identity in records:
                    raise InvalidInputError("INDEX_INTEGRITY")
                records[identity] = record
                score = _lexical_score(normalized_query, terms, record["quote"])
                if score > 0:
                    candidates.append((identity, score))
            if (
                _hash([[r["evidence_id"], r["quote_hash"]] for r in selected])
                != entry.manifest_hash
            ):
                raise InvalidInputError("SCOPE_CHANGED")
        await self.repository.assert_scope(snapshot)
        return (
            sorted(candidates, key=lambda item: (-item[1], item[0]))[:CHANNEL_LIMIT],
            records,
            metadata,
        )

    @staticmethod
    def _disclosure(profile, fingerprint, descriptor_version, acknowledge):
        if (
            fingerprint != profile.fingerprint
            or descriptor_version != profile.destination_descriptor_version
        ):
            raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE")
        if type(acknowledge) is not bool or (
            profile.destination_kind != "on_device" and not acknowledge
        ):
            raise EmbeddingInputInvalid("EMBEDDING_ACKNOWLEDGMENT_REQUIRED")
        return QueryEmbeddingDisclosure(
            disclosed_profile_fingerprint=fingerprint,
            destination_descriptor_version=descriptor_version,
            acknowledge_query_processing=acknowledge,
        )

    @staticmethod
    def _bind_vectors(vectors, snapshot, profile, records):
        # The repository already validates bounded payloads. Independently bind
        # every returned identity/hash to this request's canonical read BEFORE
        # dispatch, so candidates cannot cross namespaces or invent evidence.
        entries = {e.version_id: e for e in snapshot.entries}
        seen = set()
        if len(vectors) != len(records):
            raise InvalidInputError("INDEX_INTEGRITY")
        for row in vectors:
            record = records.get(row.get("evidence_id"))
            entry = entries.get(row.get("version_id"))
            if (
                record is None
                or entry is None
                or row["evidence_id"] in seen
                or row.get("notebook_id") != snapshot.notebook_id
                or row.get("version_id") != record["source_version_id"]
                or row.get("extraction_id") != entry.extraction_id
                or row.get("manifest_hash") != entry.manifest_hash
                or row.get("scope_epoch") != entry.scope_epoch
                or row.get("namespace") != profile.fingerprint
                or row.get("dimension") != profile.dimension
                or row.get("preprocessing_revision") != profile.preprocessing_revision
                or row.get("quote_hash") != record["quote_hash"]
            ):
                raise InvalidInputError("INDEX_INTEGRITY")
            seen.add(row["evidence_id"])

    async def _semantic(
        self, query, snapshot, profile, disclosure, records, operation_admission=None
    ):
        status = await self.repository.status(snapshot, profile)
        indexed = status["indexed_version_count"]
        if status["state"] != "ready":
            return (
                [],
                indexed,
                "INDEX_STALE" if status["state"] == "stale" else "INDEX_NOT_READY",
            )
        try:
            vectors = await self.repository.scoped_vectors(
                snapshot, profile, row_cap=ROW_CAP, element_cap=ELEMENT_CAP
            )
        except InvalidInputError as exc:
            code = str(exc).split(":", 1)[0]
            if code not in {"SCOPE_TOO_LARGE", "INDEX_NOT_READY", "INDEX_STALE"}:
                raise
            return [], indexed, code
        # A compatible rebuild may publish between status and this read. The
        # repository binds attempts to its own fresh manifest snapshot; never
        # compare them to the earlier status response here.
        self._bind_vectors(vectors, snapshot, profile, records)
        removed = False
        try:
            current = self.embeddings.resolve_profile(profile.profile_id)
        except EmbeddingUnavailable:
            removed = True
        if removed:
            raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE") from None
        self._disclosure(
            current,
            disclosure.disclosed_profile_fingerprint,
            disclosure.destination_descriptor_version,
            disclosure.acknowledge_query_processing,
        )
        await self.repository.assert_scope(snapshot)

        async def dispatch_admission():
            # The real embedding client calls this AFTER acquiring its worker
            # slot and again before provisioning/send. assert_scope owns and
            # releases the existing barrier; no lock covers provider I/O.
            await self.repository.assert_scope(snapshot)
            if operation_admission is not None:
                await operation_admission()

        try:
            query_vector = await self.embeddings.embed_query(
                profile,
                query,
                disclosure=disclosure,
                dispatch_admission=dispatch_admission,
            )
            query_vector = EvidenceEmbeddingClient._validate_vectors(
                [query_vector], 1, profile.dimension
            )[0]
        except EmbeddingOutcomeUnknown:
            return [], indexed, "EMBEDDING_OUTCOME_UNKNOWN"
        except (EmbeddingUnavailable, EmbeddingResponseInvalid):
            return [], indexed, "EMBEDDING_UNAVAILABLE"
        # Bounded existing numpy, no global ANN ranking or post-filter bridge.
        candidates: list[tuple[str, float]] = []
        for offset in range(0, len(vectors), READ_BATCH_SIZE):
            batch = vectors[offset : offset + READ_BATCH_SIZE]
            matrix = np.asarray([row["vector"] for row in batch], dtype=float)
            # Stored unit norms allow small serialization roundoff; compute
            # actual cosine, rather than treating an approximate norm as exact.
            scores = (matrix @ np.asarray(query_vector)) / np.linalg.norm(
                matrix, axis=1
            )
            candidates.extend(
                (row["evidence_id"], float(score))
                for row, score in zip(batch, scores)
                if score >= profile.cosine_min_score
            )
        return (
            sorted(candidates, key=lambda item: (-item[1], item[0]))[:CHANNEL_LIMIT],
            indexed,
            None,
        )

    async def _reread(
        self, snapshot, ranked, records, original_metadata, method, lexical, semantic
    ):
        await self.repository.assert_scope(snapshot)
        # Never reuse the pre-dispatch read cache, including for zero-hit/fallback.
        reads = _CanonicalReads(self.evidence.store)
        metadata = await self._metadata(snapshot, reads)
        for version_id, (_, extraction) in metadata.items():
            original_extraction = original_metadata[version_id][1]
            # Archive origin is immutable extraction provenance, not a mutable
            # revalidation verdict. A separately validated revalidation report
            # may change, but cannot replace or remove this origin marker.
            if ("verification_origin" in extraction) != (
                "verification_origin" in original_extraction
            ) or extraction.get("verification_origin") != original_extraction.get(
                "verification_origin"
            ):
                raise InvalidInputError("INDEX_INTEGRITY")
        await reads.prefetch("evidence", [identity for identity, _ in ranked])
        hits = []
        version_ids = [e.version_id for e in snapshot.entries]
        for identity, score in ranked:
            original = records.get(identity)
            if original is None:
                raise InvalidInputError("INDEX_INTEGRITY")
            version, extraction = metadata[original["source_version_id"]]
            record = await reads.get("evidence", identity)
            self._checked_record(record, identity, snapshot, version, extraction)
            if record != original or any(
                version.get(field)
                != original_metadata[original["source_version_id"]][0].get(field)
                for field in ("origin", "provenance", "source_title")
            ):
                raise InvalidInputError("INDEX_INTEGRITY")
            reference = await self.evidence.validate_citation(
                {"evidence_id": identity},
                version_ids,
                evidence_ids=[identity],
                _reads=reads,
            )
            if reference["reference_validity"] not in {"verified", "unverified"}:
                raise InvalidInputError("INDEX_INTEGRITY")
            hits.append(
                {
                    **record,
                    "score": score,
                    "retrieval_method": method,
                    "channels": [
                        name
                        for name, ids in (("lexical", lexical), ("semantic", semantic))
                        if identity in ids
                    ],
                    "reference_validity": reference["reference_validity"],
                    "reference_reason": reference.get("reason"),
                    "provenance": reference.get("provenance"),
                    "independent_support": reference.get("independent_support"),
                }
            )
        await self.repository.assert_scope(snapshot)
        return hits

    async def retrieve(
        self,
        query: str,
        notebook_id: str,
        version_ids: list[str],
        *,
        mode: str = "lexical",
        profile_id: str | None = None,
        acknowledge_query_processing: bool = False,
        disclosed_profile_fingerprint: str | None = None,
        destination_descriptor_version: str | None = None,
        limit: int = 12,
        operation_admission: DispatchAdmission | None = None,
    ) -> RetrievalResult:
        _limit(limit)
        if (
            mode not in {"lexical", "hybrid"}
            or (
                mode == "hybrid"
                and (not isinstance(profile_id, str) or not profile_id.strip())
            )
            or (
                mode == "lexical"
                and (
                    profile_id is not None
                    or disclosed_profile_fingerprint is not None
                    or destination_descriptor_version is not None
                    or acknowledge_query_processing is not False
                )
            )
        ):
            raise InvalidInputError("RETRIEVAL_MODE_INVALID")
        if not isinstance(query, str) or not query.strip():
            raise InvalidInputError("RETRIEVAL_QUERY_INVALID")
        if len(query) > QUERY_CHAR_CAP:
            raise InvalidInputError("QUERY_TOO_LONG")
        invalid_query = False
        try:
            query.encode("utf-8")
        except UnicodeError:
            invalid_query = True
        if invalid_query:
            raise InvalidInputError("RETRIEVAL_QUERY_INVALID") from None
        if not version_ids:
            raise InvalidInputError("NO_SOURCES_SELECTED")
        snapshot: ScopeSnapshot = await self.repository.capture_scope(
            notebook_id, version_ids
        )
        if operation_admission is not None:
            await operation_admission()
        lexical, records, metadata = await self._lexical(query, snapshot)
        semantic: list[tuple[str, float]] = []
        indexed = 0
        fallback = None
        if mode == "hybrid":
            assert profile_id is not None  # validated before any request I/O
            profile: EmbeddingProfile | None = None
            try:
                profile = self.embeddings.resolve_profile(profile_id)
            except EmbeddingUnavailable:
                fallback = "PROFILE_UNAVAILABLE"
            if profile is not None:
                disclosure = self._disclosure(
                    profile,
                    disclosed_profile_fingerprint,
                    destination_descriptor_version,
                    acknowledge_query_processing,
                )
                if not self.enabled():
                    fallback = "FEATURE_DISABLED"
                elif (
                    len((profile.query_prefix + query).encode("utf-8"))
                    > profile.max_input_bytes
                ):
                    fallback = "QUERY_TOO_LONG"
                else:
                    semantic, indexed, fallback = await self._semantic(
                        query,
                        snapshot,
                        profile,
                        disclosure,
                        records,
                        operation_admission,
                    )
        method: Literal["lexical", "hybrid", "lexical_fallback"] = (
            "lexical_fallback"
            if fallback
            else "hybrid"
            if mode == "hybrid"
            else "lexical"
        )
        lexical_ids = {identity for identity, _ in lexical}
        semantic_ids = {identity for identity, _ in semantic}
        ranked = (
            rrf(
                [identity for identity, _ in lexical],
                [identity for identity, _ in semantic],
                limit,
            )
            if method == "hybrid"
            else lexical[:limit]
        )
        hits = await self._reread(
            snapshot, ranked, records, metadata, method, lexical_ids, semantic_ids
        )
        if operation_admission is not None:
            await operation_admission()
        return RetrievalResult(
            hits=hits,
            requested_method="hybrid" if mode == "hybrid" else "lexical",
            retrieval_method=method,
            fallback_reason=fallback,
            profile_id=profile_id,
            indexed_version_count=indexed,
            selected_version_count=len(snapshot.entries),
            warnings=("EMBEDDING_OUTCOME_UNKNOWN",)
            if fallback == "EMBEDDING_OUTCOME_UNKNOWN"
            else (),
        )
