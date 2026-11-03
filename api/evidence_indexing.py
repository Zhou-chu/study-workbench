"""Explicit indexing on existing durable jobs/worker; never automatically replay.

Only acknowledged admission and dispatch ownership permit queue submission. A
metadata-only preview pins consent; immutable group receipts retain every child.
Canonical text stays in memory, never in job payloads, errors or queue arguments.
"""

import hashlib
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from surrealdb import RecordID

from api.personal_service import digest, now, submit_job
from api.personal_store import get_store, record_key
from open_notebook.ai.evidence_embeddings import (
    BATCH_SIZE,
    EmbeddingDisclosureStale,
    EvidenceEmbeddingClient,
    hybrid_enabled,
    load_profiles,
)
from open_notebook.database.evidence_embedding_repository import (
    _ATTEMPT_GUARD,
    _SCOPE_GUARD,
    EvidenceEmbeddingRepository,
    _hash,
    _transaction,
)
from open_notebook.database.project_locks import project_lock, try_project_lock
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    IndexPreview,
    IndexReceipt,
    ScopeSnapshot,
)
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

INDEX_OPERATIONS = frozenset(
    {"index_evidence", "index_evidence_group", "index_evidence_preview"}
)
TERMINAL = frozenset({"succeeded", "failed", "submission_unknown", "cancelled_local"})


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source_version_ids: list[str] = Field(min_length=1, max_length=20)
    profile_id: str = Field(min_length=1, max_length=512)


class IndexRequest(PreviewRequest):
    preview_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    acknowledge_external_processing: bool = False
    idempotency_key: str = Field(min_length=1, max_length=200)
    retry_of_job_id: str | None = Field(default=None, min_length=1, max_length=512)
    acknowledge_duplicate_embedding_cost: bool = False


def _target(identity):
    return RecordID.parse(record_key("job", identity))


def _profile(value):
    return EmbeddingProfile.model_validate(value)


def _error(code):
    return {
        "code": code,
        "message": "Indexing was not confirmed; inspect this attempt before an explicit retry.",
    }


def _safe_code(exc):
    code = str(exc).split(":", 1)[0]
    return (
        code
        if code
        in {
            "SCOPE_CHANGED",
            "SCOPE_TOO_LARGE",
            "INDEX_INTEGRITY",
            "INDEX_READ_UNAVAILABLE",
            "INDEX_COMMIT_UNKNOWN",
            "INDEX_COMMIT_REJECTED",
            "ATTEMPT_CANCELLED",
            "ATTEMPT_NOT_REGISTERED",
            "EMBEDDING_DISCLOSURE_STALE",
            "PROFILE_UNAVAILABLE",
            "FEATURE_DISABLED",
            "EMBEDDING_INPUT_INVALID",
            "EMBEDDING_INPUT_TOO_LARGE",
            "EMBEDDING_INVALID_RESPONSE",
            "EMBEDDING_OUTCOME_UNKNOWN",
            "PREVIEW_CHANGED",
            "EMBEDDING_UNAVAILABLE",
        }
        else "INDEXING_UNCONFIRMED"
    )


def _queue_observed(job):
    receipt = job.get("dispatch_receipt")
    acknowledged = (
        isinstance(receipt, dict)
        and receipt.get("dispatch_ack") == "confirmed"
        and receipt.get("job_id") == job["job_id"]
        and receipt.get("group_id") == job["group_id"]
    )
    worker_id = job.get("worker_job_id")
    return (
        acknowledged
        or (isinstance(worker_id, str) and bool(worker_id))
        or (type(job.get("attempts")) is int and job["attempts"] > 0)
        or job.get("dispatch_started") is True
    )


def _projection(job_id, job=None):
    return {
        "job_id": job_id,
        "source_version_id": job.get("source_version_id") if job else None,
        "state": (
            "submission_unknown"
            if job.get("state") == "queued" and not _queue_observed(job)
            else job["state"]
        )
        if job
        else "submission_unknown",
        "stage": job.get("stage", "preflight") if job else "preflight",
        "completed_evidence": job.get("completed_evidence", 0) if job else 0,
        "total_evidence": job.get("total_evidence", 0) if job else 0,
        "error": (
            job.get("error")
            or (
                _error("QUEUE_ACK_UNKNOWN")
                if job["state"] == "queued" and not _queue_observed(job)
                else None
            )
        )
        if job
        else _error("INDEX_JOB_MISSING"),
        "retry_safe": False,
        "remote_cancel_confirmed": False,
    }


def _group_state(jobs):
    states = {j["state"] for j in jobs}
    if states == {"succeeded"}:
        return "succeeded"
    if (
        "submission_unknown" in states
        or not states
        or not states <= TERMINAL | {"queued", "running"}
    ):
        return "submission_unknown"
    if "running" in states:
        return "running"
    if "queued" in states:
        return "queued"
    if "failed" in states:
        return "failed"
    return "cancelled_local"


class EvidenceIndexingService:
    def __init__(
        self,
        *,
        store=None,
        repository=None,
        embeddings=None,
        submit=None,
        profiles=load_profiles,
    ):
        self.store = store or get_store()
        self.repository = repository or EvidenceEmbeddingRepository()
        self.embeddings = embeddings or EvidenceEmbeddingClient()
        self.enqueue = submit or submit_job
        self.profiles = profiles

    async def _job(self, job_id):
        failed = False
        try:
            job = await self.store.get("job", job_id)
        except Exception:
            failed = True
            job = None
        if failed:
            raise DatabaseOperationError("INDEX_READ_UNAVAILABLE") from None
        if job is not None and job.get("job_id") != job_id:
            raise InvalidInputError("INDEX_INTEGRITY")
        return job

    async def _commit(self, pairs, operation, guard=None, dispatch_group=None):
        """Existing v1_job records; atomic whole-group CREATE or revision CAS.

        Reuse the actual raw SDK transaction ACK boundary. No unchecked
        PersonalStore.put, extra queue, fake-only production storage API or
        automatic transaction retry exists here.
        """
        writes = []
        for old, value in pairs:
            revision = old["revision"] + 1 if old else 1
            value.update(revision=revision, updated_at=now())
            writes.append(
                {
                    "identity": value["job_id"],
                    "target": _target(value["job_id"]),
                    "expected_revision": old["revision"] if old else None,
                    "value": value,
                }
            )
        params: dict[str, Any] = {"job_writes": writes}
        prefix = ""
        if guard:
            snapshot, profile, attempt_id, own_snapshot = guard
            # Caller holds the existing shared project barrier. Use the actual
            # repository's already-locked metadata/guard builder, not nested
            # capture_scope locking or an unguarded dispatch check-then-call.
            metadata = await self.repository._assert_locked(snapshot)
            params.update(
                self.repository._params(snapshot, profile, metadata, attempt_id)
            )
            prefix = _SCOPE_GUARD
            if attempt_id:
                params["scope_fingerprint"] = _hash(own_snapshot.model_dump())
                prefix += _ATTEMPT_GUARD
        if dispatch_group:
            params.update(
                dispatch_group_target=_target(dispatch_group["job_id"]),
                dispatch_notebook_id=dispatch_group["notebook_id"],
                dispatch_job_id=writes[-1]["identity"],
            )
            prefix += """
LET $dispatch_group = (SELECT payload FROM $dispatch_group_target)[0];
IF $dispatch_group = NONE OR $dispatch_group.payload.dispatch_stopped = true { THROW "ATTEMPT_CANCELLED"; };
IF $dispatch_group.payload.operation != 'index_evidence_group' OR $dispatch_group.payload.notebook_id != $dispatch_notebook_id OR $dispatch_job_id NOT IN $dispatch_group.payload.job_ids { THROW "INDEX_INTEGRITY"; };
"""
        await _transaction(
            prefix
            + """-- index-job-commit
FOR $write IN $job_writes {
    LET $target = $write.target;
    LET $old = (SELECT payload FROM $target)[0];
    IF $write.expected_revision = NONE AND $old != NONE { THROW "INDEX_INTEGRITY"; };
    IF $write.expected_revision != NONE AND ($old = NONE OR $old.payload.revision != $write.expected_revision) { THROW "INDEX_INTEGRITY"; };
    UPSERT $target CONTENT { app_id: $write.identity, payload: $write.value };
};
""",
            params,
            operation=operation,
        )

    async def _update(self, job_id, *, _guard=None, **changes):
        prior = await self._job(job_id)
        if not prior:
            raise NotFoundError("Index job not found")
        value = {**prior, **changes}
        await self._commit([(prior, value)], "index_progress", guard=_guard)
        return value

    def _current_profile(self, profile):
        current = self.embeddings.resolve_profile(profile.profile_id)
        if (
            current.fingerprint != profile.fingerprint
            or current.destination_descriptor_version
            != profile.destination_descriptor_version
        ):
            raise EmbeddingDisclosureStale("EMBEDDING_DISCLOSURE_STALE")
        return current

    async def _inputs(self, snapshot, profile):
        # capture_scope/assert_scope validate the ENTIRE scope before this first
        # content projection. Membership/count metadata is bounded before quotes.
        await self.repository.assert_scope(snapshot)
        entries = {e.version_id: e for e in snapshot.entries}
        extraction_ids = [e.extraction_id for e in snapshot.entries]
        targets = [RecordID.parse(record_key("extraction", x)) for x in extraction_ids]
        memberships = await self.repository.query(
            """-- index-input-membership
SELECT id, payload.extraction_id AS extraction_id, payload.source_version_id AS source_version_id,
 payload.notebook_id AS notebook_id, payload.evidence_ids AS evidence_ids FROM $targets;""",
            {"targets": targets, "extraction_ids": extraction_ids},
        )
        by_extraction = {m.get("extraction_id"): m for m in memberships}
        if len(memberships) != len(entries) or set(by_extraction) != set(
            extraction_ids
        ):
            raise InvalidInputError("SCOPE_CHANGED")
        all_ids = []
        by_version = {}
        for entry in snapshot.entries:
            m = by_extraction[entry.extraction_id]
            ids = m.get("evidence_ids")
            if (
                str(m.get("id"))
                != str(RecordID.parse(record_key("extraction", entry.extraction_id)))
                or m.get("source_version_id") != entry.version_id
                or m.get("notebook_id") != snapshot.notebook_id
                or not isinstance(ids, list)
                or any(not isinstance(i, str) or not i or len(i) > 512 for i in ids)
            ):
                raise InvalidInputError("SCOPE_CHANGED")
            by_version[entry.version_id] = ids
            all_ids.extend(ids)
        if len(set(all_ids)) != len(all_ids):
            raise InvalidInputError("INDEX_INTEGRITY")
        if len(all_ids) > 5000 or len(all_ids) * profile.dimension > 2_000_000:
            raise InvalidInputError("SCOPE_TOO_LARGE")
        rows = (
            await self.repository.query(
                """-- index-input-content
SELECT id, payload.evidence_id AS evidence_id, payload.source_version_id AS version_id,
 payload.extraction_id AS extraction_id, payload.notebook_id AS notebook_id,
 payload.quote AS quote, payload.quote_hash AS quote_hash FROM v1_evidence
 WHERE id IN $targets AND app_id IN $evidence_ids AND payload.notebook_id = $notebook_id
 AND [payload.source_version_id, payload.extraction_id] IN $pairs LIMIT $content_limit;""",
                {
                    "targets": [
                        RecordID.parse(record_key("evidence", eid)) for eid in all_ids
                    ],
                    "evidence_ids": all_ids,
                    "notebook_id": snapshot.notebook_id,
                    "version_ids": list(entries),
                    "pairs": [
                        [e.version_id, e.extraction_id] for e in snapshot.entries
                    ],
                    "content_limit": len(all_ids) + 1,
                },
            )
            if all_ids
            else []
        )
        by_id = {row.get("evidence_id"): row for row in rows}
        if len(rows) != len(all_ids) or set(by_id) != set(all_ids):
            raise InvalidInputError("INDEX_INTEGRITY")
        result = {}
        for entry in snapshot.entries:
            selected = []
            for eid in by_version[entry.version_id]:
                row = by_id[eid]
                quote = row.get("quote")
                if (
                    str(row.get("id"))
                    != str(RecordID.parse(record_key("evidence", eid)))
                    or row.get("version_id") != entry.version_id
                    or row.get("extraction_id") != entry.extraction_id
                    or row.get("notebook_id") != snapshot.notebook_id
                    or not isinstance(quote, str)
                    or not quote.strip()
                    or row.get("quote_hash")
                    != hashlib.sha256(quote.encode()).hexdigest()
                ):
                    raise InvalidInputError("INDEX_INTEGRITY")
                if (
                    len((profile.document_prefix + quote).encode())
                    > profile.max_input_bytes
                ):
                    raise InvalidInputError("EMBEDDING_INPUT_TOO_LARGE")
                selected.append(row)
            if (
                _hash([[r["evidence_id"], r["quote_hash"]] for r in selected])
                != entry.manifest_hash
            ):
                raise InvalidInputError("SCOPE_CHANGED")
            result[entry.version_id] = selected
        await self.repository.assert_scope(snapshot)
        return result

    async def _preview(self, notebook_id, version_ids, profile_id):
        snapshot = await self.repository.capture_scope(notebook_id, version_ids)
        profile = self.embeddings.resolve_profile(profile_id)
        rows = await self._inputs(snapshot, profile)
        count = sum(map(len, rows.values()))
        size = sum(
            len((profile.document_prefix + row["quote"]).encode())
            for batch in rows.values()
            for row in batch
        )
        identity = {
            "snapshot": snapshot.model_dump(),
            "profile_fingerprint": profile.fingerprint,
            "destination_descriptor_version": profile.destination_descriptor_version,
            "evidence_count": count,
            "input_bytes": size,
        }
        preview = IndexPreview(
            snapshot=snapshot,
            profile=profile,
            preview_hash=digest(identity),
            evidence_count=count,
            input_bytes=size,
            warnings=(
                "External processing may incur cost; cancellation cannot retract sent data.",
            )
            if profile.destination_kind != "on_device"
            else (),
        )
        return preview, rows

    async def preview(
        self, notebook_id: str, version_ids: list[str], profile_id: str
    ) -> IndexPreview:
        preview, _ = await self._preview(notebook_id, version_ids, profile_id)
        identity = "job_" + digest({"index_preview": preview.preview_hash})
        async with self.store.project_lock("index-preview:" + identity):
            if not await self._job(identity):
                value = {
                    "job_id": identity,
                    "notebook_id": notebook_id,
                    "operation": "index_evidence_preview",
                    "state": "succeeded",
                    "created_at": now(),
                    "replay_allowed": False,
                    "preview": preview.model_dump(exclude_computed_fields=True),
                }
                await self._commit([(None, value)], "index_preview")
        return preview

    async def _scope_jobs(self, notebook_id, version_ids):
        rows = await self.repository.query(
            """-- index-jobs-status
SELECT payload FROM v1_job WHERE payload.notebook_id = $notebook_id
 AND payload.operation = 'index_evidence' AND payload.source_version_id IN $version_ids;""",
            {"notebook_id": notebook_id, "version_ids": version_ids},
        )
        return [row["payload"] for row in rows]

    async def _retry(self, notebook_id, request, snapshot, profile):
        if not request.retry_of_job_id:
            if request.acknowledge_duplicate_embedding_cost:
                raise InvalidInputError("INDEX_RETRY_REFERENCE_REQUIRED")
            old = None
        else:
            old = await self._job(request.retry_of_job_id)
            if (
                not request.acknowledge_duplicate_embedding_cost
                or len(snapshot.entries) != 1
                or not old
                or old.get("operation") != "index_evidence"
                or old.get("restored_history")
                or old.get("notebook_id") != notebook_id
                or old.get("source_version_id") != snapshot.entries[0].version_id
                or old.get("profile_id") != request.profile_id
                or old.get("idempotency_key") == request.idempotency_key
                or old.get("state")
                not in {"failed", "submission_unknown", "cancelled_local"}
            ):
                raise InvalidInputError("INDEX_RETRY_INVALID")
        for job in await self._scope_jobs(
            notebook_id, [e.version_id for e in snapshot.entries]
        ):
            if (
                job.get("restored_history")
                or job.get("profile_fingerprint") != profile.fingerprint
            ):
                continue
            if job.get("job_id") == request.retry_of_job_id:
                continue
            if job.get("state") in {"queued", "running"}:
                raise InvalidInputError("INDEX_ATTEMPT_EXISTS")
            if not old and job.get("state") in {
                "failed",
                "submission_unknown",
                "cancelled_local",
            }:
                raise InvalidInputError("INDEX_RETRY_REQUIRED")
        return old

    async def submit(self, notebook_id: str, request: IndexRequest) -> IndexReceipt:
        request = IndexRequest.model_validate(request.model_dump())
        group_id = "job_" + digest(
            {"notebook_id": notebook_id, "index": request.idempotency_key}
        )
        request_hash = digest({"notebook_id": notebook_id, **request.model_dump()})
        async with project_lock("index-submit:" + group_id):
            old_group = await self._job(group_id)
            if old_group:
                if old_group.get("request_hash") != request_hash:
                    raise InvalidInputError("IDEMPOTENCY_CONFLICT")
                return IndexReceipt.model_validate(old_group["receipt"])
            if not hybrid_enabled():
                raise InvalidInputError("FEATURE_DISABLED")
            disclosed = await self._job(
                "job_" + digest({"index_preview": request.preview_hash})
            )
            if (
                not disclosed
                or disclosed.get("operation") != "index_evidence_preview"
                or disclosed.get("notebook_id") != notebook_id
            ):
                raise InvalidInputError("PREVIEW_CHANGED")
            prior_preview = disclosed["preview"]
            profile = _profile(prior_preview["profile"])
            if profile.profile_id != request.profile_id:
                raise InvalidInputError("PREVIEW_CHANGED")
            self._current_profile(profile)
            if (
                profile.destination_kind != "on_device"
                and not request.acknowledge_external_processing
            ):
                raise InvalidInputError("EMBEDDING_ACKNOWLEDGMENT_REQUIRED")
            preview, inputs = await self._preview(
                notebook_id, request.source_version_ids, request.profile_id
            )
            if preview.preview_hash != request.preview_hash:
                raise InvalidInputError("PREVIEW_CHANGED")
            job_ids = [
                "job_" + digest({"index_group": group_id, "version": e.version_id})
                for e in preview.snapshot.entries
            ]
            children = []
            for entry, jid in zip(preview.snapshot.entries, job_ids):
                rows = inputs[entry.version_id]
                children.append(
                    {
                        "job_id": jid,
                        "group_id": group_id,
                        "notebook_id": notebook_id,
                        "operation": "index_evidence",
                        "source_version_id": entry.version_id,
                        "extraction_id": entry.extraction_id,
                        "scope_snapshot": preview.snapshot.model_dump(),
                        "version_snapshot": ScopeSnapshot(
                            notebook_id=notebook_id, entries=(entry,)
                        ).model_dump(),
                        "profile": profile.model_dump(exclude_computed_fields=True),
                        "profile_id": profile.profile_id,
                        "profile_fingerprint": profile.fingerprint,
                        "disclosed_profile_fingerprint": profile.fingerprint,
                        "destination_descriptor_version": profile.destination_descriptor_version,
                        "preview_hash": request.preview_hash,
                        "request_hash": request_hash,
                        "request_snapshot": request.model_dump(),
                        "idempotency_key": request.idempotency_key,
                        "input_hash": _hash(
                            [[r["evidence_id"], r["quote_hash"]] for r in rows]
                        ),
                        "state": "queued",
                        "stage": "preflight",
                        "submission_state": "not_submitted",
                        "queue_dispatch_started": False,
                        "dispatch_started": False,
                        "attempts": 0,
                        "completed_evidence": 0,
                        "total_evidence": len(rows),
                        "created_at": now(),
                        "retry_safe": False,
                        "remote_cancel_confirmed": False,
                        "retry_of_job_id": request.retry_of_job_id,
                        "acknowledge_duplicate_embedding_cost": request.acknowledge_duplicate_embedding_cost,
                    }
                )
            # Initial receipt deliberately says unknown until ALL metadata ACKs
            # and queue observations have been retained. Duplicates never resume
            # incomplete admission or dispatch.
            projections = [
                {**_projection(j["job_id"], j), "state": "submission_unknown"}
                for j in children
            ]
            receipt = IndexReceipt(
                group_id=group_id,
                notebook_id=notebook_id,
                profile_id=profile.profile_id,
                profile_fingerprint=profile.fingerprint,
                preview_hash=request.preview_hash,
                job_ids=tuple(job_ids),
                jobs=tuple(projections),
                state="submission_unknown",
            )
            parent = {
                "job_id": group_id,
                "group_id": group_id,
                "notebook_id": notebook_id,
                "operation": "index_evidence_group",
                "state": "submission_unknown",
                "replay_allowed": False,
                "dispatch_stopped": False,
                "created_at": now(),
                "request_hash": request_hash,
                "job_ids": job_ids,
                "version_ids": [e.version_id for e in preview.snapshot.entries],
                "receipt": receipt.model_dump(),
            }
            await self.repository.assert_scope(preview.snapshot)
            async with self.store.project_lock(notebook_id):
                old_attempt = await self._retry(
                    notebook_id, request, preview.snapshot, profile
                )
                # Fence the referenced old attempt under the commit barrier,
                # before activating a new ID. Never replay an uncertain fence.
                if old_attempt:
                    await self._stop_group(
                        old_attempt["group_id"],
                        notebook_id,
                        "explicit_retry",
                        old_attempt["job_id"],
                    )
                    await self.repository.cancel_attempt(old_attempt["job_id"])
                await self._commit(
                    [(None, parent)] + [(None, child) for child in children],
                    "index_admit",
                    guard=(preview.snapshot, profile, None, None),
                )
            for jid in job_ids:
                await self._dispatch(jid)
            projections = [
                await self._child_projection(jid, vid)
                for jid, vid in zip(job_ids, parent["version_ids"])
            ]
            receipt = IndexReceipt.model_validate(
                {
                    **receipt.model_dump(),
                    "state": _group_state(projections),
                    "jobs": projections,
                }
            )
            async with self.store.project_lock(notebook_id):
                await self._update(
                    group_id, state=receipt.state, receipt=receipt.model_dump()
                )
            return receipt

    async def _child_projection(self, job_id, version_id=None, *, reconcile=False):
        job = await self._job(job_id)
        if job and reconcile:
            job = await self.reconcile(job_id)
        value = _projection(job_id, job)
        if value["source_version_id"] is None:
            value["source_version_id"] = version_id
        return value

    async def _dispatch(self, job_id):
        job = await self._job(job_id)
        if not job:
            raise NotFoundError("Index job not found")
        async with self.store.project_lock(job["notebook_id"]):
            job = await self._job(job_id)
            if job["state"] != "queued" or job.get("queue_dispatch_started"):
                return job
            group = await self._job(job["group_id"])
            if (
                not group
                or group.get("operation") != "index_evidence_group"
                or group.get("notebook_id") != job["notebook_id"]
                or job_id not in group["job_ids"]
            ):
                raise InvalidInputError("INDEX_INTEGRITY")
            if group.get("dispatch_stopped"):
                return job
            profile = self._validate_job(job)
            self._current_profile(profile)
            value = {
                **job,
                "queue_dispatch_started": True,
                "dispatch_receipt": {
                    "dispatch_ack": "unknown",
                    "job_id": job_id,
                    "group_id": job["group_id"],
                    "retry_safe": False,
                },
            }
            # Write the parent conflict point AND child claim atomically. A
            # stopped/cancelled/retried creator cannot claim another sibling,
            # including across a race with the durable parent stop transaction.
            await self._commit(
                [(group, {**group, "last_dispatch_job_id": job_id}), (job, value)],
                "index_progress",
                guard=(
                    ScopeSnapshot.model_validate(job["scope_snapshot"]),
                    profile,
                    None,
                    None,
                ),
                dispatch_group=group,
            )
            job = value
        worker_id = None
        try:
            worker_id = await self.enqueue("index_evidence", {"job_id": job_id})
        except Exception:
            pass
        async with self.store.project_lock(job["notebook_id"]):
            latest = await self._job(job_id)
            if not latest:
                raise NotFoundError("Index job not found")
            if worker_id is not None:
                return await self._update(
                    job_id,
                    worker_job_id=worker_id,
                    dispatch_receipt={
                        "dispatch_ack": "confirmed",
                        "job_id": job_id,
                        "group_id": latest["group_id"],
                        "retry_safe": False,
                    },
                )
            if latest["revision"] != job["revision"] or latest["state"] != "queued":
                return latest
            return await self._update(
                job_id,
                state="submission_unknown",
                submission_state="unknown",
                error=_error("QUEUE_ACK_UNKNOWN"),
            )

    def _validate_job(self, job):
        profile = None
        try:
            profile = self._validate_job_fields(job)
        except Exception:
            pass
        if profile is None:
            raise InvalidInputError("INDEX_INTEGRITY") from None
        return profile

    def _validate_job_fields(self, job):
        """Queued consent is captured intent, not current UI/default settings."""
        request = IndexRequest.model_validate(job["request_snapshot"])
        profile = _profile(job["profile"])
        snapshot = ScopeSnapshot.model_validate(job["scope_snapshot"])
        own = ScopeSnapshot.model_validate(job["version_snapshot"])
        group_id = "job_" + digest(
            {"notebook_id": job["notebook_id"], "index": request.idempotency_key}
        )
        expected_id = "job_" + digest(
            {"index_group": group_id, "version": job["source_version_id"]}
        )
        if (
            digest({"notebook_id": job["notebook_id"], **request.model_dump()})
            != job["request_hash"]
            or job["job_id"] != expected_id
            or job["group_id"] != group_id
            or job["notebook_id"] != snapshot.notebook_id
            or own.notebook_id != snapshot.notebook_id
            or len(own.entries) != 1
            or own.entries[0] not in snapshot.entries
            or own.entries[0].version_id != job["source_version_id"]
            or own.entries[0].extraction_id != job["extraction_id"]
            or set(request.source_version_ids)
            != {e.version_id for e in snapshot.entries}
            or profile.profile_id != request.profile_id
            or job["profile_id"] != profile.profile_id
            or job["profile_fingerprint"] != profile.fingerprint
            or job["disclosed_profile_fingerprint"] != profile.fingerprint
            or job["destination_descriptor_version"]
            != profile.destination_descriptor_version
            or job["preview_hash"] != request.preview_hash
            or (
                profile.destination_kind != "on_device"
                and not request.acknowledge_external_processing
            )
        ):
            raise InvalidInputError("INDEX_INTEGRITY")
        return profile

    async def run(self, job_id: str) -> dict:
        async with project_lock("index-run:" + job_id):
            job = await self._job(job_id)
            if not job:
                raise NotFoundError("Index job not found")
            if job.get("operation") != "index_evidence":
                raise InvalidInputError("INVALID_INDEX_OPERATION")
            if (
                job.get("restored_history")
                or job.get("replay_allowed") is False
                or job["state"] in TERMINAL
            ):
                return job
            async with self.store.project_lock(job["notebook_id"]):
                job = await self._job(job_id)
                if job["state"] in TERMINAL or job.get("cancel_requested"):
                    return job
                if (
                    job["state"] != "queued"
                    or not job.get("queue_dispatch_started")
                    or job.get("attempts", 0) != 0
                    or job.get("dispatch_started")
                ):
                    return await self._update(
                        job_id,
                        state="submission_unknown",
                        submission_state="unknown",
                        error=_error("INDEX_ATTEMPT_INTERRUPTED"),
                    )
                job = await self._update(
                    job_id,
                    state="running",
                    stage="preflight",
                    attempts=1,
                    started_at=now(),
                )
            try:
                if not hybrid_enabled():
                    raise InvalidInputError("FEATURE_DISABLED")
                profile = self._validate_job(job)
                self._current_profile(profile)
                snapshot = ScopeSnapshot.model_validate(job["scope_snapshot"])
                own_snapshot = ScopeSnapshot.model_validate(job["version_snapshot"])
                preview, inputs = await self._preview(
                    job["notebook_id"],
                    [e.version_id for e in snapshot.entries],
                    profile.profile_id,
                )
                if (
                    preview.snapshot != snapshot
                    or preview.preview_hash != job["preview_hash"]
                ):
                    raise InvalidInputError("SCOPE_CHANGED")
                rows = inputs[job["source_version_id"]]
                if (
                    _hash([[r["evidence_id"], r["quote_hash"]] for r in rows])
                    != job["input_hash"]
                ):
                    raise InvalidInputError("INDEX_INTEGRITY")
                await self.repository.register_attempt(job_id, own_snapshot, profile)

                async def dispatch_admission():
                    # A queued slot or resolver await is not document dispatch.
                    # Re-admit the accepted whole scope and this exact attempt at
                    # each real client boundary, without locking provider I/O.
                    async with self.store.project_lock(snapshot.notebook_id):
                        latest = await self._job(job_id)
                        if (
                            not latest
                            or latest.get("state") != "running"
                            or latest.get("cancel_requested")
                            or latest.get("restored_history")
                            or latest.get("replay_allowed") is False
                        ):
                            raise InvalidInputError("ATTEMPT_CANCELLED")
                        if (
                            self._validate_job(latest) != profile
                            or latest["scope_snapshot"] != snapshot.model_dump()
                            or latest["version_snapshot"] != own_snapshot.model_dump()
                            or latest.get("attempts") != 1
                        ):
                            raise InvalidInputError("INDEX_INTEGRITY")
                        self._current_profile(profile)
                        # Atomic durable scope/attempt fence plus job revision CAS.
                        # Retain dispatch_started/unknown; never make it replayable.
                        await self._update(
                            job_id, _guard=(snapshot, profile, job_id, own_snapshot)
                        )
                        self._current_profile(profile)

                for start in range(0, len(rows), BATCH_SIZE):
                    await self.repository.assert_scope(snapshot)
                    self._current_profile(profile)
                    async with self.store.project_lock(job["notebook_id"]):
                        latest = await self._job(job_id)
                        if latest["state"] != "running" or latest.get(
                            "cancel_requested"
                        ):
                            return latest
                        job = await self._update(
                            job_id,
                            _guard=(snapshot, profile, job_id, own_snapshot),
                            stage="embedding",
                            dispatch_started=True,
                            submission_state="unknown",
                            remote_may_continue=True,
                            batch_start=start,
                        )
                    batch = rows[start : start + BATCH_SIZE]
                    vectors = await self.embeddings.embed_documents(
                        profile,
                        [r["quote"] for r in batch],
                        dispatch_admission=dispatch_admission,
                    )
                    if len(vectors) != len(batch):
                        raise InvalidInputError("EMBEDDING_INVALID_RESPONSE")
                    # Cancellation during the provider call drops its vectors;
                    # attempt fences also protect writes/publication against races.
                    latest = await self._job(job_id)
                    if latest["state"] != "running" or latest.get("cancel_requested"):
                        return latest
                    entry = own_snapshot.entries[0]
                    await self.repository.write_batch(
                        job_id,
                        own_snapshot,
                        profile,
                        [
                            {
                                "notebook_id": job["notebook_id"],
                                "version_id": entry.version_id,
                                "extraction_id": entry.extraction_id,
                                "manifest_hash": entry.manifest_hash,
                                "scope_epoch": entry.scope_epoch,
                                "namespace": profile.fingerprint,
                                "dimension": profile.dimension,
                                "preprocessing_revision": profile.preprocessing_revision,
                                "attempt_id": job_id,
                                "evidence_id": r["evidence_id"],
                                "quote_hash": r["quote_hash"],
                                "vector": vector,
                            }
                            for r, vector in zip(batch, vectors)
                        ],
                    )
                    async with self.store.project_lock(job["notebook_id"]):
                        latest = await self._job(job_id)
                        if latest["state"] != "running" or latest.get(
                            "cancel_requested"
                        ):
                            return latest
                        job = await self._update(
                            job_id, completed_evidence=start + len(batch)
                        )
                await self.repository.assert_scope(snapshot)
                self._current_profile(profile)
                async with self.store.project_lock(job["notebook_id"]):
                    latest = await self._job(job_id)
                    if latest["state"] != "running" or latest.get("cancel_requested"):
                        return latest
                    job = await self._update(
                        job_id,
                        _guard=(snapshot, profile, job_id, own_snapshot),
                        stage="publishing",
                    )
                result = await self.repository.publish(
                    job_id, own_snapshot, profile, len(rows)
                )
                changes = {
                    "state": "succeeded",
                    "submission_state": "confirmed",
                    "result": result,
                    "completed_at": now(),
                    "remote_may_continue": False,
                }
            except Exception as exc:
                code = _safe_code(exc)
                unknown = code in {
                    "INDEX_COMMIT_UNKNOWN",
                    "EMBEDDING_OUTCOME_UNKNOWN",
                    "INDEXING_UNCONFIRMED",
                }
                changes = {
                    "state": "submission_unknown" if unknown else "failed",
                    "submission_state": "unknown"
                    if unknown or job.get("dispatch_started")
                    else "not_submitted",
                    "error": _error(code),
                    "completed_at": now(),
                }
            async with self.store.project_lock(job["notebook_id"]):
                latest = await self._job(job_id)
                if latest["state"] != "running" or latest.get("cancel_requested"):
                    return latest
                return await self._update(job_id, **changes)

    async def reconcile(self, job_id: str) -> dict:
        job = await self._job(job_id)
        if not job or job.get("operation") not in INDEX_OPERATIONS:
            raise NotFoundError("Index job not found")
        if job["operation"] == "index_evidence_group":
            jobs = [
                await self._child_projection(jid, vid, reconcile=True)
                for jid, vid in zip(job["job_ids"], job["version_ids"])
            ]
            return {
                **job,
                "state": _group_state(jobs),
                "jobs": jobs,
                "retry_safe": False,
                "remote_cancel_confirmed": False,
            }
        if job["operation"] == "index_evidence" and (
            job.get("restored_history") or job.get("replay_allowed") is False
        ):
            return job
        if (
            job["operation"] == "index_evidence"
            and job["state"] == "queued"
            and not _queue_observed(job)
        ):
            # An unacknowledged start marker is not queue evidence. Only when
            # the originating submitter no longer owns its exact shared key may
            # this become a durable unknown eligible for explicit fenced retry.
            async with try_project_lock("index-submit:" + job["group_id"]) as idle:
                if idle:
                    # Queue acceptance may precede the worker's first durable
                    # claim. Its live run key is positive ownership evidence
                    # even while the stored state is still queued/ACK-unknown.
                    async with try_project_lock("index-run:" + job_id) as worker_idle:
                        if not worker_idle:
                            return {
                                **job,
                                "state": "submission_unknown",
                                "error": _projection(job_id, job)["error"],
                            }
                        async with self.store.project_lock(job["notebook_id"]):
                            latest = await self._job(job_id)
                            if (
                                latest
                                and latest["state"] == "queued"
                                and not _queue_observed(latest)
                            ):
                                job = await self._update(
                                    job_id,
                                    state="submission_unknown",
                                    submission_state="unknown",
                                    error=_error("QUEUE_ACK_UNKNOWN"),
                                )
                            elif latest:
                                job = latest
        if job["operation"] == "index_evidence" and job["state"] == "running":
            # The real worker owns this exact shared-filesystem run key through
            # provider work. A successful nonblocking acquire proves no live
            # owner at this supported root; retain it through the state change.
            async with try_project_lock("index-run:" + job_id) as idle:
                if idle:
                    async with self.store.project_lock(job["notebook_id"]):
                        latest = await self._job(job_id)
                        if latest and latest["state"] == "running":
                            job = await self._update(
                                job_id,
                                state="submission_unknown",
                                submission_state="unknown",
                                error=_error("INDEX_ATTEMPT_INTERRUPTED"),
                            )
                        elif latest:
                            job = latest
        # Never queue, run or provision from a status read. A compatible old
        # manifest is not evidence that THIS uncertain attempt completed.
        if (
            job["operation"] == "index_evidence"
            and job["state"] == "submission_unknown"
            and not job.get("cancel_requested")
        ):
            snapshot = ScopeSnapshot.model_validate(job["version_snapshot"])
            profile = _profile(job["profile"])
            status = await self.repository.status(snapshot, profile)
            if status["state"] == "ready" and all(
                m["attempt_id"] == job_id for m in status["manifests"]
            ):
                async with self.store.project_lock(job["notebook_id"]):
                    latest = await self._job(job_id)
                    if (
                        latest
                        and latest["state"] == "submission_unknown"
                        and not latest.get("cancel_requested")
                    ):
                        job = await self._update(
                            job_id,
                            state="succeeded",
                            submission_state="confirmed",
                            completed_evidence=job["total_evidence"],
                            result={"state": "ready", "attempt_id": job_id},
                        )
        if (
            job["operation"] == "index_evidence"
            and job["state"] == "queued"
            and not _queue_observed(job)
        ):
            # A live enqueue may still be pending: expose uncertainty without
            # falsely interrupting its owner or rewriting the submission receipt.
            return {
                **job,
                "state": "submission_unknown",
                "error": _projection(job_id, job)["error"],
            }
        return job

    async def _stop_group(self, group_id, notebook_id, reason, child_id=None):
        """Caller owns the project barrier; ACK before destructive continuation."""
        group = await self._job(group_id)
        if (
            not group
            or group.get("operation") != "index_evidence_group"
            or group.get("notebook_id") != notebook_id
            or (child_id is not None and child_id not in group["job_ids"])
        ):
            raise InvalidInputError("INDEX_INTEGRITY")
        value = {**group, "dispatch_stopped": True, "dispatch_stop_reason": reason}
        await self._commit([(group, value)], "index_group_stop")
        return value

    async def cancel(self, job_id: str) -> dict:
        job = await self._job(job_id)
        if not job or job.get("operation") not in {
            "index_evidence",
            "index_evidence_group",
        }:
            raise NotFoundError("Index job not found")
        group_id = (
            job_id if job["operation"] == "index_evidence_group" else job["group_id"]
        )
        async with self.store.project_lock(job["notebook_id"]):
            await self._stop_group(
                group_id,
                job["notebook_id"],
                "cancel",
                None if job_id == group_id else job_id,
            )
        if job["operation"] == "index_evidence_group":
            for jid in job["job_ids"]:
                if await self._job(jid):
                    await self._cancel_child(jid)
            return await self.reconcile(job_id)
        return await self._cancel_child(job_id)

    async def _cancel_child(self, job_id):
        job = await self._job(job_id)
        async with self.store.project_lock(job["notebook_id"]):
            job = await self._job(job_id)
            if job["state"] == "cancelled_local":
                if not job.get("cancellation_fence_confirmed"):
                    raise DatabaseOperationError("INDEX_COMMIT_UNKNOWN")
                return job
            if job["state"] in {"succeeded", "failed"}:
                return job
            job = await self._update(
                job_id,
                cancel_requested=True,
                state="cancelled_local",
                remote_may_continue=bool(job.get("dispatch_started")),
                remote_cancel_confirmed=False,
                completed_at=now(),
            )
            # This method owns no project lock in the repository and never
            # increments scope_epoch or clears a compatible complete manifest.
            await self.repository.cancel_attempt(job_id)
            job = await self._update(job_id, cancellation_fence_confirmed=True)
        return job

    async def status(self, notebook_id: str, version_ids: list[str]) -> dict:
        snapshot = await self.repository.capture_scope(notebook_id, version_ids)
        # Metadata/config only. Do not construct a model or read canonical text.
        profiles = []
        configured = self.profiles()
        for profile_id in sorted(configured):
            profile = self.embeddings.resolve_profile(profile_id)
            profiles.append(
                {
                    "profile": profile.model_dump(),
                    "index": await self.repository.status(snapshot, profile),
                }
            )
        jobs = await self._scope_jobs(
            notebook_id, [e.version_id for e in snapshot.entries]
        )
        return {
            "notebook_id": notebook_id,
            "snapshot": snapshot.model_dump(),
            "enabled": hybrid_enabled(),
            "profiles": profiles,
            "jobs": [
                _projection(j["job_id"], await self.reconcile(j["job_id"]))
                for j in jobs
            ],
            "retry_safe": False,
            "remote_cancel_confirmed": False,
        }
