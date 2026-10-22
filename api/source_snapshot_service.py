"""Create local immutable material from saved canonical text; never calls a model."""

import asyncio
import hashlib
import json

from api.evidence_service import (
    EvidenceService,
    build_evidence_records,
    parse_text_bytes,
    publish_snapshot_bytes,
)
from api.personal_service import digest, now
from api.source_snapshot_contracts import (
    NoteSnapshotRequest,
    SnapshotProblem,
    SourceSnapshotResponse,
)
from open_notebook.domain.evidence import DerivedProvenance, Extraction, SourceVersion
from open_notebook.exceptions import (
    InvalidInputError,
    NoteRevisionConflict,
    NotFoundError,
)

MAX_SNAPSHOT_BYTES = 1024 * 1024
MAX_SNAPSHOT_RECORDS = 1000


class SourceSnapshotService:
    def __init__(self, evidence=None, repository=None):
        self.evidence = evidence or EvidenceService()
        self.store = self.evidence.store
        if repository is None:
            from open_notebook.database.source_snapshot_repository import (
                SourceSnapshotRepository,
            )

            repository = SourceSnapshotRepository()
        self.repository = repository

    async def _replay(self, notebook_id, receipt):
        await self.repository.check_available(notebook_id, receipt["result"])
        try:
            await self.evidence.resolve_file(receipt["result"]["source_version_id"])
        except (NotFoundError, InvalidInputError) as exc:
            raise SnapshotProblem("SNAPSHOT_UNAVAILABLE", 410) from exc
        return {**receipt["result"], "existing": True}

    async def _provenance(
        self,
        notebook_id,
        origin_kind,
        origin_id,
        title,
        content,
        revision,
        authorship,
        metadata,
    ):
        # Read only direct references; never traverse their source notes/results.
        scope = metadata.get("scope_snapshot") or {}
        versions = list(dict.fromkeys(scope.get("source_version_ids") or []))
        if len(versions) > 20:
            raise SnapshotProblem("SOURCE_LIMIT", 400)
        for identity in versions:
            version = await self.store.get("version", identity)
            if not version or version.get("notebook_id") != notebook_id:
                raise SnapshotProblem("SOURCE_OUT_OF_SCOPE", 400)
        frozen_scope = {
            key: scope[key]
            for key in (
                "engine",
                "selection_origin",
                "remote_notebook_id",
                "remote_source_ids",
                "scope_hash",
                "mapping_version",
            )
            if key in scope
        }
        frozen_scope["source_version_ids"] = versions
        citations = []
        original_citations = metadata.get("citations") or []
        if len(original_citations) > 200:
            raise SnapshotProblem("SNAPSHOT_TOO_LARGE", 413)
        for citation in original_citations:
            if citation.get("kind") == "remote_unmapped" and not citation.get(
                "evidence_id"
            ):
                citations.append(
                    {
                        "citation_id": str(citation.get("citation_id") or "c1"),
                        "kind": "remote_unmapped",
                        "source_title": citation.get("source_title"),
                        "quote": citation.get("quote") or "",
                        "reference_validity": "unverified",
                        "evidence_id": None,
                        "source_version_id": None,
                        "remote_reference": citation.get("remote_reference"),
                    }
                )
            else:
                validated = await self.evidence.validate_citation(citation, versions)
                # Preserve a direct citation only; no recursive provenance tree.
                validated.pop("provenance", None)
                if validated["reference_validity"] in ("invalid", "out_of_scope"):
                    validated.update(
                        evidence_id=None, source_version_id=None, locator=None
                    )
                citations.append(validated)
        return DerivedProvenance(
            origin_kind=origin_kind,
            origin_id=origin_id,
            note_revision=revision,
            origin_title=title,
            authorship=authorship,
            captured_at=now(),
            content_sha256=hashlib.sha256(content.encode()).hexdigest(),
            scope_snapshot=frozen_scope,
            citations=citations,
        ).model_dump()

    async def create(self, notebook_id, request):
        if not request.idempotency_key.strip():
            raise SnapshotProblem("INVALID_IDEMPOTENCY_KEY", 400)
        request_value = request.model_dump(exclude={"idempotency_key"})
        request_hash = digest(request_value)
        identity = digest(
            {"notebook_id": notebook_id, "source_snapshot": request.idempotency_key}
        )
        job_id = "job_" + identity
        async with self.store.project_lock("source-snapshot:" + identity):
            old = await self.store.get("job", job_id)
            if old:
                if (
                    old.get("request_hash") != request_hash
                    or old.get("operation") != "source_snapshot"
                    or old.get("notebook_id") != notebook_id
                ):
                    raise SnapshotProblem("SNAPSHOT_IDEMPOTENCY_CONFLICT", 409)
                return await self._replay(notebook_id, old)
            revision = None
            if isinstance(request, NoteSnapshotRequest):
                bundle = await self.repository.read_note(notebook_id, request.note_id)
                native, metadata = bundle.native, bundle.snapshot or {}
                if native["revision"] != request.expected_revision:
                    raise NoteRevisionConflict(native["revision"])
                origin_id, revision = request.note_id, native["revision"]
                title, content = native.get("title") or "", native.get("content") or ""
                authorship = native.get("note_type") or "unknown"
                original = native
            else:
                turn = await self.store.get("turn", request.turn_id)
                if not turn or turn.get("notebook_id") != notebook_id:
                    raise NotFoundError("Result not found")
                if turn.get("status") != "succeeded":
                    raise SnapshotProblem("RESULT_NOT_READY", 409)
                origin_id = request.turn_id
                title, content = turn.get("message") or "", turn.get("answer") or ""
                authorship, metadata, original = "ai", turn, turn
            if not isinstance(content, str) or not content.strip():
                raise SnapshotProblem("EMPTY_SNAPSHOT", 400)
            data = content.encode("utf-8")
            if len(data) > MAX_SNAPSHOT_BYTES:
                raise SnapshotProblem("SNAPSHOT_TOO_LARGE", 413)
            provenance = await self._provenance(
                notebook_id,
                request.origin_kind,
                origin_id,
                title,
                content,
                revision,
                authorship,
                metadata,
            )
            if (
                len(data)
                + len(title.encode("utf-8"))
                + len(json.dumps(provenance, ensure_ascii=False).encode("utf-8"))
                > MAX_SNAPSHOT_BYTES
            ):
                raise SnapshotProblem("SNAPSHOT_TOO_LARGE", 413)
            source_id, version_id, extraction_id = (
                "source:" + identity,
                "sv_" + identity,
                "ex_" + identity,
            )
            relative = f"originals/{version_id}/original.md"
            path = self.evidence.data_root / relative
            timestamp = provenance["captured_at"]
            version = SourceVersion(
                source_version_id=version_id,
                source_id=source_id,
                notebook_id=notebook_id,
                source_title=title,
                origin="derived_snapshot",
                provenance=provenance,
                sha256=hashlib.sha256(data).hexdigest(),
                mime_type="text/markdown",
                byte_size=len(data),
                file_path=relative,
                created_at=timestamp,
                current_extraction_id=extraction_id,
                status="ready",
            ).model_dump()
            parsed = parse_text_bytes(data, MAX_SNAPSHOT_BYTES)
            if parsed["status"] != "ready":
                raise SnapshotProblem("EMPTY_SNAPSHOT", 400)
            blocks = parsed["blocks"]
            try:
                evidence = build_evidence_records(
                    version, extraction_id, blocks, max_records=MAX_SNAPSHOT_RECORDS
                )
            except InvalidInputError as exc:
                if str(exc).startswith("EVIDENCE_LIMIT"):
                    raise SnapshotProblem("SNAPSHOT_TOO_LARGE", 413) from exc
                raise
            extraction = Extraction(
                extraction_id=extraction_id,
                source_version_id=version_id,
                notebook_id=notebook_id,
                parser_name="utf8",
                parser_version="1",
                status="ready",
                blocks=blocks,
                evidence_ids=[item["evidence_id"] for item in evidence],
                created_at=timestamp,
                completed_at=timestamp,
            ).model_dump()
            result = SourceSnapshotResponse(
                source_id=source_id,
                source_version_id=version_id,
                job_id=job_id,
                existing=False,
                provenance=provenance,
            ).model_dump()
            receipt = {
                "job_id": job_id,
                "notebook_id": notebook_id,
                "operation": "source_snapshot",
                "state": "succeeded",
                "submission_state": "confirmed",
                "created_at": timestamp,
                "completed_at": timestamp,
                "request_hash": request_hash,
                "idempotency_key": request.idempotency_key,
                "result": result,
                "request_snapshot": {
                    "origin_kind": request.origin_kind,
                    "origin_id": origin_id,
                    "note_revision": revision,
                },
                "replay_allowed": False,
                "remote_may_continue": False,
            }
            records = [
                ("version", version_id, version),
                ("extraction", extraction_id, extraction),
                *[("evidence", item["evidence_id"], item) for item in evidence],
                ("job", job_id, receipt),
            ]
            prepared = {
                "notebook_id": notebook_id,
                "origin_kind": request.origin_kind,
                "origin_id": origin_id,
                "origin_revision": revision,
                "original": original,
                "metadata": metadata,
                "source_id": source_id,
                "title": title,
                "content": content,
                "records": records,
                "receipt": receipt,
                "request_hash": request_hash,
                "job_id": job_id,
                "scope_version_ids": provenance["scope_snapshot"]["source_version_ids"],
            }
            async with self.store.project_lock(notebook_id):
                await asyncio.to_thread(
                    publish_snapshot_bytes,
                    path,
                    data,
                    durability_root=self.evidence.data_root,
                )
                # Deterministic bytes may belong to another concurrent winner.
                # Even a proven rollback of this transaction cannot authorize unlink.
                committed = await self.repository.commit(prepared)
            if committed["result"].get("existing"):
                return await self._replay(notebook_id, committed)
            return committed["result"]
