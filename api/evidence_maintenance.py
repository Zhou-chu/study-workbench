"""Explicit, durable local reparse and archive-reference revalidation jobs."""

import os
from datetime import datetime, timedelta, timezone

from api.evidence_service import EvidenceService
from api.personal_service import digest, now, submit_job
from open_notebook.exceptions import InvalidInputError, NotFoundError


def _can_process(version, operation):
    if (
        operation == "reparse"
        and version.get("origin") == "web_snapshot"
        and version.get("mime_type") == "text/markdown"
        and version.get("file_path")
    ):
        # Retained provider Markdown can be repaired locally; it is not original HTML.
        return True
    return (
        version.get("original_status") == "available"
        and version.get("origin") != "remote_text_snapshot"
    )


def _next_dispatch():
    # Parsing has a hard process timeout. Give it an additional minute for DB
    # commits and queue overhead before enqueueing recovery of this same job.
    seconds = max(
        60, float(os.getenv("STUDY_WORKBENCH_EXTRACT_TIMEOUT_SECONDS", "30")) + 60
    )
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


class EvidenceMaintenanceService:
    def __init__(self, evidence=None, submit=None):
        self.evidence = evidence or EvidenceService()
        self.store = self.evidence.store
        self.enqueue = submit or submit_job

    async def submit(self, version_id, operation, idempotency_key, extraction_id=None):
        if operation not in ("reparse", "revalidate"):
            raise InvalidInputError("INVALID_MAINTENANCE_OPERATION")
        version = await self.evidence._version(version_id)
        identity = "job_" + digest(
            {"version": version_id, "maintenance": idempotency_key}
        )
        request_hash = digest({"operation": operation, "extraction_id": extraction_id})
        async with self.store.project_lock("maintenance-submit:" + identity):
            old = await self.store.get("job", identity)
            if old:
                if old["request_hash"] != request_hash:
                    raise InvalidInputError("IDEMPOTENCY_CONFLICT")
                return old
            if not _can_process(version, operation):
                raise InvalidInputError(
                    "ORIGINAL_UNAVAILABLE: retained original required"
                )
            if operation == "revalidate":
                extraction = (
                    await self.store.get("extraction", extraction_id)
                    if extraction_id
                    else None
                )
                if not extraction or extraction["source_version_id"] != version_id:
                    raise InvalidInputError("EXTRACTION_VERSION_MISMATCH")
            job = {
                "job_id": identity,
                "notebook_id": version["notebook_id"],
                "source_version_id": version_id,
                "operation": operation,
                "extraction_id": extraction_id,
                "fresh_extraction_id": "ex_" + digest(identity)[:32],
                "idempotency_key": idempotency_key,
                "request_hash": request_hash,
                "state": "queued",
                "submission_state": "not_submitted",
                "created_at": now(),
                "attempts": 0,
                "next_dispatch_at": _next_dispatch(),
                "remote_may_continue": False,
            }
            async with self.store.project_lock(version["notebook_id"]):
                await self.store.put("job", identity, job, create_only=True)
            try:
                worker_id = await self.enqueue(
                    "maintain_evidence", {"job_id": identity}
                )
                async with self.store.project_lock(version["notebook_id"]):
                    current = await self.store.get("job", identity)
                    current["worker_job_id"] = worker_id
                    await self.store.put("job", identity, current)
            except Exception:
                async with self.store.project_lock(version["notebook_id"]):
                    current = await self.store.get("job", identity)
                    # The worker may have completed despite an enqueue-response error.
                    if current["state"] == "queued":
                        current.update(
                            state="failed",
                            completed_at=now(),
                            error={
                                "code": "WORKER_UNAVAILABLE",
                                "message": "Local maintenance could not be queued; retry explicitly",
                            },
                        )
                        await self.store.put("job", identity, current)
            return await self.store.get("job", identity)

    async def dispatch(self, job_id):
        """Status polling recovers abandoned local jobs, never a new operation."""
        async with self.store.project_lock("maintenance-dispatch:" + job_id):
            job = await self.store.get("job", job_id)
            if not job:
                raise NotFoundError("Maintenance job not found")
            if (
                job.get("restored_history")
                or job.get("replay_allowed") is False
                or job.get("operation") not in ("reparse", "revalidate")
                or job["state"] not in ("queued", "running")
            ):
                return job
            if job.get("next_dispatch_at", "") > now():
                return job
            async with self.store.project_lock(job["notebook_id"]):
                current = await self.store.get("job", job_id)
                if current["state"] not in ("queued", "running"):
                    return current
                current["next_dispatch_at"] = _next_dispatch()
                await self.store.put("job", job_id, current)
            try:
                worker_id = await self.enqueue("maintain_evidence", {"job_id": job_id})
                update = {"worker_job_id": worker_id, "recovery_error": None}
            except Exception:
                update = {
                    "recovery_error": "Worker unavailable; the existing task will be checked again without creating a new operation"
                }
            async with self.store.project_lock(job["notebook_id"]):
                current = await self.store.get("job", job_id)
                current.update(update)
                await self.store.put("job", job_id, current)
                return current

    async def run(self, job_id):
        # Only this operation is serialized for its CPU work, not project reads/writes.
        async with self.store.project_lock("maintenance-run:" + job_id):
            job = await self.store.get("job", job_id)
            if not job:
                raise NotFoundError("Maintenance job not found")
            if job.get("operation") not in ("reparse", "revalidate"):
                raise InvalidInputError("INVALID_MAINTENANCE_OPERATION")
            if job.get("restored_history") or job.get("replay_allowed") is False:
                async with self.store.project_lock(job["notebook_id"]):
                    job.update(
                        state="cancelled_local",
                        cancel_requested=True,
                        remote_may_continue=False,
                    )
                    await self.store.put("job", job_id, job)
                return job
            if job["state"] in ("succeeded", "failed", "cancelled_local"):
                return job
            version = await self.evidence._version(job["source_version_id"])
            if version["notebook_id"] != job["notebook_id"]:
                raise InvalidInputError("SOURCE_OUT_OF_SCOPE")
            async with self.store.project_lock(job["notebook_id"]):
                job = await self.store.get("job", job_id)
                if job.get("cancel_requested") or job["state"] == "cancelled_local":
                    return job
                job.update(
                    state="running",
                    started_at=now(),
                    next_dispatch_at=_next_dispatch(),
                    attempts=job.get("attempts", 0) + 1,
                )
                await self.store.put("job", job_id, job)
            try:
                if not _can_process(version, job["operation"]):
                    raise InvalidInputError("ORIGINAL_UNAVAILABLE")
                if job["operation"] == "revalidate":
                    result = await self.evidence.revalidate(
                        job["source_version_id"],
                        job["extraction_id"],
                        job["fresh_extraction_id"],
                    )
                else:
                    extraction = await self.evidence.extract(
                        job["source_version_id"],
                        extraction_id=job["fresh_extraction_id"],
                    )
                    if extraction["status"] == "failed":
                        raise InvalidInputError(
                            "EXTRACTION_FAILED: retry with a new operation"
                        )
                    result = {
                        "source_version_id": job["source_version_id"],
                        "extraction_id": extraction["extraction_id"],
                        "status": extraction["status"],
                        "evidence_count": len(extraction["evidence_ids"]),
                    }
                update = {"state": "succeeded", "result": result, "completed_at": now()}
            except Exception as exc:
                update = {
                    "state": "failed",
                    "error": {"code": type(exc).__name__, "message": str(exc)[:500]},
                    "completed_at": now(),
                }
            async with self.store.project_lock(job["notebook_id"]):
                current = await self.store.get("job", job_id)
                current.update(update)
                await self.store.put("job", job_id, current)
                return current
