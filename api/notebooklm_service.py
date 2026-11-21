"""Durable NotebookLM orchestration on the existing store/command worker.

Remote writes are never automatically replayed once a durable intent might have
reached Google. Polling is one bounded read per command; no worker sleeps.
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, uuid5

from api.personal_store import get_store
from open_notebook.exceptions import NotFoundError
from open_notebook.integrations.notebooklm.contracts import (
    AudioRequest,
    BridgeError,
    CreateNotebookRequest,
)
from open_notebook.integrations.notebooklm.sdk_adapter import (
    SDKNotebookLMBridge,
    classify_error,
    now,
)

TERMINAL = {
    "succeeded",
    "failed",
    "needs_reauth",
    "submission_unknown",
    "cancelled_local",
}


def later(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


async def enqueue_command(job_id, poll=False):
    # The public sync wrapper runs its own event loop. Use the package's async
    # service so async-first DB access is preserved; it is already this project's
    # installed worker facility, not an additional queue.
    from surreal_commands.core.service import CommandRequest, command_service

    import commands.notebooklm_commands  # noqa: F401

    return str(
        await command_service.submit_command(
            CommandRequest(
                app="open_notebook",
                command="notebooklm_poll" if poll else "notebooklm_execute",
                args={"job_id": job_id},
            )
        )
    )


class NotebookLMService:
    def __init__(
        self,
        store=None,
        bridge=None,
        evidence=None,
        enqueue=enqueue_command,
        data_root=None,
    ):
        self.store = store or get_store()
        self._bridge = bridge
        self.evidence = evidence
        self.enqueue = enqueue
        self.data_root = data_root

    @property
    def bridge(self):
        # Personal job reads/cancellation also serve local-only operations. Do
        # not construct the optional SDK until a legacy operation needs it.
        if self._bridge is None:
            self._bridge = SDKNotebookLMBridge()
        return self._bridge

    @bridge.setter
    def bridge(self, value):
        self._bridge = value

    async def job(self, job_id):
        job = await self.store.get("job", job_id)
        if not job or job.get("provider") != "notebooklm":
            raise NotFoundError("NotebookLM job not found")
        return job

    async def _save(self, job, **changes):
        # A late remote response must preserve a user's local cancellation.
        async with self.store.project_lock(job["notebook_id"]):
            latest = await self.job(job["job_id"])
            latest.update(changes, updated_at=now())
            if latest.get("cancel_requested"):
                latest["state"] = "cancelled_local"
                latest["remote_may_continue"] = (
                    latest["submission_state"] != "not_submitted"
                )
            await self.store.put("job", job["job_id"], latest)
        job.clear()
        job.update(latest)
        return job

    async def create_job(self, notebook_id, operation, request, idempotency_key):
        if not isinstance(idempotency_key, str) or not 1 <= len(idempotency_key) <= 200:
            raise BridgeError(
                "INVALID_REQUEST",
                "Supply an idempotency key of at most 200 characters.",
            )
        if operation not in {
            "audio",
            "create_notebook",
            "sync",
            "import",
            "download",
            "ask",
        }:
            raise BridgeError("INVALID_REQUEST", "Unsupported NotebookLM operation.")
        if operation in {"audio", "import", "ask"} and not request.get(
            "remote_source_ids"
        ):
            raise BridgeError(
                "EMPTY_SCOPE", "Explicitly select one or more remote sources."
            )
        if operation == "sync" and not request.get("source_version_ids"):
            raise BridgeError(
                "EMPTY_SCOPE", "Explicitly select one or more original versions."
            )
        identity = f"job_{uuid5(NAMESPACE_URL, notebook_id + ':' + idempotency_key)}"
        request_hash = digest(
            {
                "operation": operation,
                "request": request.get("original_request", request)
                if operation == "ask"
                else request,
            }
        )
        async with self.store.project_lock(notebook_id):
            previous = await self.store.get("job", identity)
            if previous:
                if previous["request_hash"] != request_hash:
                    raise BridgeError(
                        "IDEMPOTENCY_CONFLICT",
                        "This idempotency key already identifies a different request.",
                    )
                return previous
            job = {
                "job_id": identity,
                "provider": "notebooklm",
                "notebook_id": notebook_id,
                "operation": operation,
                "idempotency_key": idempotency_key,
                "request_hash": request_hash,
                "request_snapshot": request,
                "worker_job_id": None,
                "remote_task_id": None,
                "submission_state": "not_submitted",
                "state": "queued",
                "attempts": 0,
                "poll_attempts": 0,
                "error": None,
                "result": None,
                "created_at": now(),
                "updated_at": now(),
                "next_poll_at": None,
                "lease_until": None,
                "dispatch_after": now(),
            }
            await self.store.put("job", identity, job, create_only=True)
        if operation != "ask":
            await self._dispatch(job)
        return await self.job(identity)

    async def _dispatch(self, job):
        if self.enqueue is None:
            return
        # Dispatch lease makes API retries and multiple startup tickers harmless.
        async with self.store.project_lock(job["notebook_id"]):
            job = await self.job(job["job_id"])
            if job.get("replay_allowed") is False or job["state"] not in {
                "queued",
                "waiting_remote",
            }:
                return
            due = (
                job.get("next_poll_at")
                if job["state"] == "waiting_remote"
                else job.get("dispatch_after")
            )
            if due and due > now():
                return
            job["dispatch_after"] = later(60)
            if job["state"] == "waiting_remote":
                job["next_poll_at"] = later(60)
            await self.store.put("job", job["job_id"], job)
        try:
            worker_id = await self.enqueue(
                job["job_id"], poll=job["state"] == "waiting_remote"
            )
            await self._save(job, worker_job_id=str(worker_id), error=None)
        except Exception:
            # The queue submission itself may have succeeded; the durable claim
            # makes a later re-enqueue safe, without replaying a remote mutation.
            await self._save(
                job,
                error={
                    "code": "WORKER_UNAVAILABLE",
                    "message": "Background worker enqueue is unavailable; this saved job can resume.",
                },
            )

    async def dispatch_due_jobs(self):
        for job in await self.store.list("job", provider="notebooklm"):
            if job["state"] == "running" and (job.get("lease_until") or "") < now():
                if job["submission_state"] == "unknown":
                    await self._save(
                        job,
                        state="submission_unknown",
                        error={
                            "code": "SUBMISSION_UNKNOWN",
                            "message": "The worker stopped after submission intent. Check Google before submitting a new task.",
                        },
                    )
                elif job["submission_state"] == "confirmed" and job.get(
                    "remote_task_id"
                ):
                    await self._save(job, state="waiting_remote", next_poll_at=now())
                else:
                    await self._save(job, state="queued", dispatch_after=now())
            await self._dispatch(job)

    async def _claim(self, job_id, poll=False):
        job = await self.job(job_id)
        async with self.store.project_lock(job["notebook_id"]):
            job = await self.job(job_id)
            if job.get("replay_allowed") is False or job["state"] in TERMINAL:
                return job, False
            if job["state"] == "running":
                if (job.get("lease_until") or "") > now():
                    return job, False
                if job["submission_state"] == "unknown":
                    job.update(
                        state="submission_unknown",
                        error={
                            "code": "SUBMISSION_UNKNOWN",
                            "message": "Submission may have reached Google; automatic replay is blocked.",
                        },
                    )
                    await self.store.put("job", job_id, job)
                    return job, False
                if job["submission_state"] == "confirmed":
                    job["state"] = "waiting_remote"
            if poll and job["state"] != "waiting_remote":
                return job, False
            if not poll and job["state"] == "waiting_remote":
                return job, False
            job.update(state="running", lease_until=later(300), updated_at=now())
            field = "poll_attempts" if poll else "attempts"
            job[field] += 1
            await self.store.put("job", job_id, job)
            return job, True

    async def remote_read(self, operation):
        async with self.store.project_lock("notebooklm:account-call"):
            connection = await self.store.get("connection", "notebooklm")
            if connection and connection.get("disabled"):
                raise BridgeError("NEEDS_REAUTH", "NotebookLM is disconnected.")
            async with asyncio.timeout(60):
                return await operation()

    async def refresh_source_links(self, remote_notebook_id):
        rows = await self.all_sources(remote_notebook_id)
        current = {row.id: row for row in rows}
        links = await self.store.list(
            "source_link", remote_notebook_id=remote_notebook_id
        )
        for link in links:
            remote = current.get(link["remote_source_id"])
            if remote is None:
                link.update(mapping_status="missing", remote_status="missing")
            else:
                previous_revision = (link.get("remote_metadata") or {}).get(
                    "revision_id"
                )
                if (
                    previous_revision
                    and remote.revision_id
                    and previous_revision != remote.revision_id
                ):
                    link["mapping_status"] = "stale"
                link.update(
                    remote_status=remote.status, remote_metadata=remote.model_dump()
                )
            link["last_checked_at"] = now()
            async with self.store.project_lock(link["notebook_id"]):
                await self.store.put("source_link", link["source_link_id"], link)
        return rows

    async def confirm_source_mapping(
        self,
        notebook_id,
        remote_notebook_id,
        remote_source_id,
        source_version_id,
        user_confirmed,
    ):
        import unicodedata

        from open_notebook.integrations.notebooklm.contracts import FetchTextRequest

        if user_confirmed is not True:
            raise BridgeError(
                "INVALID_REQUEST",
                "Explicitly confirm the selected original and remote source.",
            )
        await self._ensure_connection()
        version = await self._evidence().version(source_version_id)
        if (
            version["notebook_id"] != notebook_id
            or version["original_status"] != "available"
        ):
            raise BridgeError(
                "INVALID_REQUEST",
                "Select an available original in this local notebook.",
            )
        extraction = version.get("extraction")
        if not extraction or extraction["status"] != "ready":
            raise BridgeError(
                "SOURCE_NOT_READY",
                "The original must be completely extracted before exact-text association.",
            )
        remote_rows = {r.id: r for r in await self.all_sources(remote_notebook_id)}
        row = remote_rows.get(remote_source_id)
        if not row or row.status != "ready":
            raise BridgeError(
                "SOURCE_NOT_READY", "The selected remote source is not ready."
            )
        text = await self.remote_read(
            lambda: self.bridge.fetch_source_text(
                FetchTextRequest(
                    remote_notebook_id=remote_notebook_id,
                    remote_source_id=remote_source_id,
                )
            )
        )

        def normalized(value):
            return unicodedata.normalize("NFC", " ".join(value.split()))

        local = "\n".join(block["text"] for block in extraction["blocks"])
        if not normalized(local) or normalized(local) != normalized(text.content):
            raise BridgeError(
                "SOURCE_TEXT_MISMATCH",
                "The extracted texts differ. Matching titles or user confirmation alone do not establish a trusted original mapping.",
            )
        link = self._source_link(
            notebook_id,
            remote_notebook_id,
            remote_source_id,
            source_version_id=source_version_id,
            mapping_method="user_confirmed_exact_text",
            mapping_status="verified",
            remote_status="ready",
            remote_metadata=row.model_dump(),
            matched_text_sha256=hashlib.sha256(normalized(local).encode()).hexdigest(),
        )
        async with self.store.project_lock(notebook_id):
            await self.store.put("source_link", link["source_link_id"], link)
        return link

    async def _ensure_connection(self):
        connection = await self.store.get("connection", "notebooklm")
        if connection and connection.get("disabled"):
            raise BridgeError("NEEDS_REAUTH", "NotebookLM is disconnected.")
        status = await self.remote_read(self.bridge.verify_connection)
        if status.state != "connected":
            raise BridgeError(
                "NEEDS_REAUTH"
                if status.state in {"disconnected", "needs_reauth"}
                else "REMOTE_UNAVAILABLE",
                "NotebookLM connection is not verified. Reconnect in this application runtime.",
            )
        return status

    async def all_sources(self, remote_notebook_id):
        items, cursor = [], None
        seen: set[str] = set()
        while True:
            page = await self.remote_read(
                lambda: self.bridge.list_sources(remote_notebook_id, cursor)
            )
            items.extend(page.items)
            if page.next_cursor is None:
                if not page.listing_complete:
                    raise BridgeError(
                        "INCOMPLETE_LISTING", "The remote source listing is incomplete."
                    )
                break
            if page.next_cursor in seen or len(seen) >= 1000:
                raise BridgeError(
                    "REMOTE_SCHEMA_CHANGED", "Remote pagination did not progress."
                )
            seen.add(page.next_cursor)
            cursor = page.next_cursor
        if len({item.id for item in items}) != len(items):
            raise BridgeError(
                "REMOTE_SCHEMA_CHANGED",
                "Remote source listing contains duplicate identities.",
            )
        await self.record_capability("list_sources")
        return items

    async def _validate_remote_scope(self, request):
        chosen = request.get("remote_source_ids") or []
        if not chosen:
            raise BridgeError(
                "EMPTY_SCOPE",
                "Explicitly select sources; empty never means all sources.",
            )
        rows = {
            r.id: r
            for r in await self.refresh_source_links(request["remote_notebook_id"])
        }
        for source_id in chosen:
            if source_id not in rows:
                raise BridgeError(
                    "UNMAPPED_SOURCE",
                    "A selected source is missing from the target notebook.",
                )
            if rows[source_id].status != "ready":
                raise BridgeError(
                    "SOURCE_NOT_READY",
                    "A selected source is still processing or unavailable.",
                )

        local_selection = (
            request.get("selection_origin") == "local"
            or request.get("scope_snapshot", {}).get("selection_origin") == "local"
        )
        if local_selection:
            links = await self.store.list(
                "source_link",
                notebook_id=request["notebook_id"],
                remote_notebook_id=request["remote_notebook_id"],
            )
            for version_id in request["source_version_ids"]:
                matches = [
                    r
                    for r in links
                    if r.get("source_version_id") == version_id
                    and r.get("remote_source_id") in chosen
                    and r.get("mapping_status") == "verified"
                    and r.get("remote_status") == "ready"
                ]
                if len(matches) != 1:
                    raise BridgeError(
                        "UNMAPPED_SOURCE",
                        "A selected original mapping changed before submission; verify it again.",
                    )

    async def _write(self, job, operation, source_version_id=None):
        await self._save(job, submission_state="unknown")
        if job.get("cancel_requested"):
            raise BridgeError(
                "CANCELLED_LOCAL", "Local waiting was cancelled before submission."
            )
        async with self.store.project_lock("notebooklm:account-call"):
            current = await self.job(job["job_id"])
            if current.get("cancel_requested"):
                raise BridgeError(
                    "CANCELLED_LOCAL", "Local waiting was cancelled before submission."
                )
            # Recheck the shared disconnect gate after acquiring the account slot.
            connection = await self.store.get("connection", "notebooklm")
            if connection and connection.get("disabled"):
                raise BridgeError("NEEDS_REAUTH", "NotebookLM is disconnected.")
            if job["operation"] == "ask":
                # Queued/recovered jobs may outlive the capability that admitted
                # them. Recheck while holding the account slot, immediately
                # before transport, rather than trusting the saved job.
                await self._require_strict_ask_capability()
            async with asyncio.timeout(120):
                result = await operation()
            remote_id = getattr(result, "remote_id", None) or getattr(
                result, "conversation_id", None
            )
            if not remote_id:
                raise BridgeError(
                    "REMOTE_SCHEMA_CHANGED",
                    "Submission returned no identity.",
                    submission_state="unknown",
                )
            if source_version_id:
                link = self._source_link(
                    job["notebook_id"],
                    job["request_snapshot"]["remote_notebook_id"],
                    remote_id,
                    source_version_id=source_version_id,
                    mapping_method="uploaded_original",
                    mapping_status="verified",
                    remote_status=result.status,
                )
                saved_result = {**(job.get("result") or {}), source_version_id: link}
            elif job["operation"] == "ask":
                saved_result = {
                    "answer": result.answer,
                    "conversation_id": result.conversation_id,
                    "references": [ref.model_dump() for ref in result.references],
                }
            else:
                saved_result = {
                    "remote_artifact_id"
                    if job["operation"] == "audio"
                    else "remote_notebook_id": remote_id
                }
            await self._save(
                job,
                remote_task_id=remote_id,
                submission_state="confirmed",
                result=saved_result,
            )
            if source_version_id:
                async with self.store.project_lock(job["notebook_id"]):
                    await self.store.put("source_link", link["source_link_id"], link)
            operation_name = {
                "audio": "generate_audio",
                "sync": "upload_source",
                "ask": "ask",
                "create_notebook": "create_notebook",
            }[job["operation"]]
            await self.record_capability(operation_name)
            return result

    async def run_job(self, job_id):
        job, claimed = await self._claim(job_id)
        if not claimed:
            return job
        request = job["request_snapshot"]
        try:
            await self._ensure_connection()
            if job["operation"] == "audio":
                await self.require_capability("generate_audio")
                await self._validate_remote_scope(
                    {**request, "notebook_id": job["notebook_id"]}
                )
                result = await self._write(
                    job, lambda: self.bridge.generate_audio(AudioRequest(**request))
                )
                await self._save(
                    job,
                    remote_task_id=result.remote_id,
                    submission_state="confirmed",
                    state="waiting_remote",
                    next_poll_at=later(10),
                    result={"remote_artifact_id": result.remote_id},
                )
            elif job["operation"] == "create_notebook":
                result = await self._write(
                    job,
                    lambda: self.bridge.create_notebook(
                        CreateNotebookRequest(**request)
                    ),
                )
                await self._save(
                    job,
                    remote_task_id=result.remote_id,
                    submission_state="confirmed",
                    state="succeeded",
                    result={"remote_notebook_id": result.remote_id},
                )
            else:
                await self._run_other(job)
        except Exception as exc:
            await self._fail(job, exc)
        return await self.job(job_id)

    async def _fail(self, job, exc):
        error = classify_error(exc, mutation=job["submission_state"] == "unknown")
        if job["submission_state"] == "confirmed" and job.get("remote_task_id"):
            error.submission_state = "confirmed"
        state = (
            "submission_unknown"
            if error.submission_state == "unknown"
            else ("needs_reauth" if error.code == "NEEDS_REAUTH" else "failed")
        )
        await self._save(
            job,
            state=state,
            submission_state=error.submission_state,
            remote_task_id=error.remote_id or job.get("remote_task_id"),
            error={"code": error.code, "message": str(error)},
        )

    async def poll_job(self, job_id):
        job, claimed = await self._claim(job_id, poll=True)
        if not claimed:
            return job
        try:
            await self._ensure_connection()
            if job["operation"] == "audio":
                async with self.store.project_lock("notebooklm:account-call"):
                    async with asyncio.timeout(60):
                        artifact = await self.bridge.get_artifact(
                            job["request_snapshot"]["remote_notebook_id"],
                            job["remote_task_id"],
                        )
                if artifact.status == "ready":
                    await self._save(
                        job,
                        state="succeeded",
                        next_poll_at=None,
                        result={
                            **(job.get("result") or {}),
                            "artifact": artifact.model_dump(),
                            "downloaded": False,
                        },
                    )
                    try:
                        await self._download(job)
                    except Exception as exc:
                        error = classify_error(exc)
                        await self._save(
                            job,
                            result={
                                **job["result"],
                                "downloaded": False,
                                "download_error": {
                                    "code": error.code,
                                    "message": str(error),
                                },
                            },
                        )
                elif artifact.status == "failed":
                    await self._save(
                        job,
                        state="failed",
                        error={
                            "code": "REMOTE_GENERATION_FAILED",
                            "message": "Google reported this original audio task failed.",
                        },
                    )
                else:
                    await self._save(
                        job,
                        state="waiting_remote",
                        next_poll_at=later(min(120, 10 * job["poll_attempts"])),
                    )
            elif job["operation"] == "create_notebook":
                await self._save(
                    job,
                    state="succeeded",
                    result={"remote_notebook_id": job["remote_task_id"]},
                )
            else:
                await self._poll_other(job)
        except Exception as exc:
            error = classify_error(exc)
            if error.code == "NEEDS_REAUTH":
                await self._save(
                    job,
                    state="needs_reauth",
                    error={"code": error.code, "message": str(error)},
                )
            else:
                # Poll failure cannot change confirmed submission to unknown.
                await self._save(
                    job,
                    state="waiting_remote",
                    next_poll_at=later(60),
                    error={"code": error.code, "message": str(error)},
                )
        return await self.job(job_id)

    async def cancel_job(self, job_id):
        job = await self.job(job_id)
        if job["state"] == "succeeded":
            return job
        return await self._save(
            job,
            cancel_requested=True,
            state="cancelled_local",
            next_poll_at=None,
            remote_may_continue=job["submission_state"] != "not_submitted",
        )

    async def record_capability(self, name):
        async with self.store.project_lock("notebooklm:connection"):
            await self.store.put(
                "connection",
                "capability_" + name,
                {
                    "connection_type": "capability",
                    "name": name,
                    "last_verified_at": now(),
                },
            )

    async def capabilities(self):
        matrix = await self.bridge.capabilities()
        observations = {
            r["name"]: r
            for r in await self.store.list("connection", connection_type="capability")
        }
        for capability in matrix.operations:
            if capability.name in observations and capability.support not in {
                "unsupported",
                "temporarily_unavailable",
            }:
                capability.support = "available"
                capability.last_verified_at = observations[capability.name][
                    "last_verified_at"
                ]
        return matrix

    async def require_capability(self, name):
        capabilities = await self.bridge.capabilities()
        capability = next((c for c in capabilities.operations if c.name == name), None)
        if capability is None or capability.support in {
            "unsupported",
            "temporarily_unavailable",
        }:
            raise BridgeError(
                "CAPABILITY_UNAVAILABLE",
                f"NotebookLM {name} is unavailable for this connection.",
            )

    async def _download(self, job):
        import os
        from pathlib import Path

        from api.personal_store import data_root
        from open_notebook.integrations.notebooklm.contracts import DownloadRequest

        root = Path(self.data_root or data_root()).resolve()
        request = job["request_snapshot"]
        remote_id = request.get("remote_artifact_id") or job["remote_task_id"]
        artifact_id = "artifact_" + str(uuid5(NAMESPACE_URL, job["job_id"]))
        existing = await self.store.get("artifact", artifact_id)
        if existing:
            await self._save(
                job,
                state="succeeded",
                result={"artifact": existing, "downloaded": True},
            )
            return
        output = root / "artifacts" / artifact_id / "audio"
        asset = await self.bridge.download_artifact(
            DownloadRequest(
                remote_notebook_id=request["remote_notebook_id"],
                remote_artifact_id=remote_id,
                output_path=str(output),
                max_bytes=int(os.getenv("STUDY_WORKBENCH_MAX_AUDIO_MB", "200"))
                * 1024
                * 1024,
            )
        )
        path = Path(asset.path).resolve()
        if not path.is_relative_to(root / "artifacts") or not path.is_file():
            raise BridgeError(
                "UNSAFE_DOWNLOAD", "The adapter returned an unsafe asset path."
            )
        # Verify actual disk bytes before recording an available local asset.
        actual_size = path.stat().st_size
        actual_sha = await asyncio.to_thread(
            lambda: hashlib.sha256(path.read_bytes()).hexdigest()
        )
        if actual_size != asset.byte_size or actual_sha != asset.sha256:
            raise BridgeError(
                "ARTIFACT_INTEGRITY", "Downloaded audio failed integrity verification."
            )
        artifact = {
            "artifact_id": artifact_id,
            "notebook_id": job["notebook_id"],
            "origin": "notebooklm",
            "remote_artifact_id": remote_id,
            "remote_notebook_id": request["remote_notebook_id"],
            "kind": "audio",
            "file_path": str(path.relative_to(root)),
            "sha256": asset.sha256,
            "byte_size": asset.byte_size,
            "mime_type": asset.mime_type,
            "downloaded_at": now(),
            "scope_snapshot": request.get("scope_snapshot")
            or {
                "remote_notebook_id": request["remote_notebook_id"],
                "remote_source_ids": request.get("remote_source_ids", []),
                "coverage": "selected_generation_sources"
                if job["operation"] == "audio"
                else "remote_artifact_scope_unverified",
            },
        }
        async with self.store.project_lock(job["notebook_id"]):
            await self.store.put("artifact", artifact_id, artifact)
        await self._save(
            job, state="succeeded", result={"artifact": artifact, "downloaded": True}
        )

    def _evidence(self):
        if self.evidence is None:
            from api.evidence_service import EvidenceService

            self.evidence = EvidenceService(store=self.store, data_root=self.data_root)
        return self.evidence

    async def ensure_native_source(self, notebook_id, source_id, title):
        from open_notebook.database.repository import (
            ensure_record_id,
            repo_query,
            repo_relate,
        )
        from open_notebook.domain.notebook import Source

        async with self.store.project_lock(notebook_id):
            try:
                await Source.get(source_id)
            except NotFoundError:
                timestamp = datetime.now(timezone.utc)
                await repo_query(
                    "CREATE $source CONTENT $data;",
                    {
                        "source": ensure_record_id(source_id),
                        "data": {
                            "title": title,
                            "topics": [],
                            "created": timestamp,
                            "updated": timestamp,
                        },
                    },
                )
            relations = await repo_query(
                "SELECT id FROM reference WHERE in=$source AND out=$notebook;",
                {
                    "source": ensure_record_id(source_id),
                    "notebook": ensure_record_id(notebook_id),
                },
            )
            if not relations:
                await repo_relate(source_id, "reference", notebook_id)
        return source_id

    async def _run_other(self, job):
        operation = job["operation"]
        if operation == "sync":
            await self._sync(job)
        elif operation == "import":
            await self._import(job)
        elif operation == "ask":
            await self._ask_job(job)
        elif operation == "download":
            await self._download(job)
        else:
            raise BridgeError("INVALID_REQUEST", "Unsupported operation.")

    async def _sync(self, job):
        from open_notebook.integrations.notebooklm.contracts import UploadSourceRequest

        req = job["request_snapshot"]
        completed = dict(job.get("result") or {})
        # Validate every version before any upload so partial requests cannot
        # hide a cross-project or missing original after the first mutation.
        versions = []
        for version_id in req["source_version_ids"]:
            version = await self._evidence().version(version_id)
            if (
                version["notebook_id"] != job["notebook_id"]
                or version["original_status"] != "available"
            ):
                raise BridgeError(
                    "INVALID_REQUEST",
                    "Select available originals from this local notebook.",
                )
            path = await self._evidence().resolve_file(version_id)
            versions.append((version, path))
        for version, path in versions:
            version_id = version["source_version_id"]
            if version_id in completed:
                continue
            links = await self.store.list(
                "source_link",
                notebook_id=job["notebook_id"],
                source_version_id=version_id,
                remote_notebook_id=req["remote_notebook_id"],
            )
            verified = [
                r
                for r in links
                if r["mapping_status"] == "verified"
                and r.get("remote_status") != "missing"
            ]
            if verified:
                completed[version_id] = verified[0]
                continue
            result = await self._write(
                job,
                lambda: self.bridge.upload_source(
                    UploadSourceRequest(
                        remote_notebook_id=req["remote_notebook_id"],
                        source_version_id=version_id,
                        file_path=str(path),
                        mime_type=version["mime_type"],
                        title=version["source_title"],
                    )
                ),
                source_version_id=version_id,
            )
            link = self._source_link(
                job["notebook_id"],
                req["remote_notebook_id"],
                result.remote_id,
                source_version_id=version_id,
                mapping_method="uploaded_original",
                mapping_status="verified",
                remote_status=result.status,
            )
            # Save returned identity before any additional network or file work.
            completed[version_id] = link
            await self._save(
                job,
                remote_task_id=result.remote_id,
                submission_state="confirmed",
                result=completed,
            )
            async with self.store.project_lock(job["notebook_id"]):
                await self.store.put("source_link", link["source_link_id"], link)
        waiting = any(link["remote_status"] != "ready" for link in completed.values())
        await self._save(
            job,
            state="waiting_remote" if waiting else "succeeded",
            next_poll_at=later(10) if waiting else None,
            result=completed,
        )

    def _source_link(self, notebook_id, remote_notebook_id, remote_source_id, **fields):
        identity = "sl_" + str(
            uuid5(
                NAMESPACE_URL,
                json.dumps([notebook_id, remote_notebook_id, remote_source_id]),
            )
        )
        return {
            "source_link_id": identity,
            "notebook_id": notebook_id,
            "remote_notebook_id": remote_notebook_id,
            "remote_source_id": remote_source_id,
            "source_version_id": None,
            "mapping_method": "none",
            "mapping_status": "unmapped",
            "remote_status": "unknown",
            "remote_metadata": {},
            "last_checked_at": now(),
            **fields,
        }

    async def _poll_other(self, job):
        if job["operation"] == "sync":
            # A crash after a confirmed individual upload may leave other
            # explicitly requested versions unsubmitted. Completed IDs are never
            # uploaded again; the original request can safely continue its tail.
            completed = dict(job.get("result") or {})
            for link in completed.values():
                async with self.store.project_lock(job["notebook_id"]):
                    await self.store.put("source_link", link["source_link_id"], link)
            if len(completed) < len(set(job["request_snapshot"]["source_version_ids"])):
                await self._sync(job)
                return
            rows = {
                r.id: r
                for r in await self.all_sources(
                    job["request_snapshot"]["remote_notebook_id"]
                )
            }
            for version_id, link in completed.items():
                remote = rows.get(link["remote_source_id"])
                if remote is None:
                    link.update(remote_status="missing", mapping_status="missing")
                elif remote.status == "ready":
                    link["remote_status"] = "ready"
                link["last_checked_at"] = now()
                async with self.store.project_lock(job["notebook_id"]):
                    await self.store.put("source_link", link["source_link_id"], link)
            if any(r["remote_status"] == "missing" for r in completed.values()):
                await self._save(
                    job,
                    state="failed",
                    result=completed,
                    error={
                        "code": "REMOTE_SOURCE_MISSING",
                        "message": "A confirmed source is no longer present; the original is retained locally.",
                    },
                )
            else:
                waiting = any(r["remote_status"] != "ready" for r in completed.values())
                await self._save(
                    job,
                    state="waiting_remote" if waiting else "succeeded",
                    next_poll_at=later(10) if waiting else None,
                    result=completed,
                )
        elif (
            job["operation"] == "ask"
            and job.get("result", {}).get("answer") is not None
        ):
            from open_notebook.integrations.notebooklm.contracts import BridgeAnswer

            saved = job["result"]
            answer = BridgeAnswer(
                answer=saved["answer"],
                conversation_id=saved["conversation_id"],
                references=saved.get("references", []),
            )
            await self._finish_answer(job, answer)
        else:
            raise BridgeError(
                "INVALID_REQUEST",
                "This operation does not have a remote polling phase.",
            )

    async def _import(self, job):
        from open_notebook.integrations.notebooklm.contracts import FetchTextRequest

        req = job["request_snapshot"]
        remote = {r.id: r for r in await self.all_sources(req["remote_notebook_id"])}
        report_id = "report_" + job["job_id"]
        report = await self.store.get("import_report", report_id) or {
            "import_report_id": report_id,
            "notebook_id": job["notebook_id"],
            "requested": req["remote_source_ids"],
            "imported": [],
            "skipped": [],
            "failed": [],
            "missing_originals": [],
            "unsupported": [],
            "pagination_complete": True,
        }
        for source_id in req["remote_source_ids"]:
            if source_id in report["imported"] or source_id in report["skipped"]:
                continue
            row = remote.get(source_id)
            if row is None:
                report["failed"].append(
                    {"remote_source_id": source_id, "code": "REMOTE_SOURCE_MISSING"}
                )
                continue
            if source_id not in report["missing_originals"]:
                report["missing_originals"].append(source_id)
            link = self._source_link(
                job["notebook_id"],
                req["remote_notebook_id"],
                source_id,
                remote_metadata=row.model_dump(),
                remote_status=row.status,
            )
            existing = await self.store.get("source_link", link["source_link_id"])
            if existing and existing.get("mapping_status") == "verified":
                link = {
                    **existing,
                    "remote_metadata": row.model_dump(),
                    "last_checked_at": now(),
                }
            try:
                if req.get("include_text", True):
                    text_request = FetchTextRequest(
                        remote_notebook_id=req["remote_notebook_id"],
                        remote_source_id=source_id,
                    )
                    text = await self.remote_read(
                        lambda: self.bridge.fetch_source_text(text_request)
                    )
                    if not text.content.strip():
                        raise BridgeError(
                            "EMPTY_REMOTE_TEXT",
                            "This remote source has no readable text.",
                        )
                    # Stable native source identity plus a version lookup makes
                    # read-only import recovery avoid duplicating local records.
                    local_source = (
                        "source:"
                        + uuid5(NAMESPACE_URL, job["job_id"] + ":" + source_id).hex
                    )
                    await self.ensure_native_source(
                        job["notebook_id"], local_source, text.title
                    )
                    snapshots = await self.store.list(
                        "version",
                        notebook_id=job["notebook_id"],
                        source_id=local_source,
                    )
                    version = (
                        snapshots[0]
                        if snapshots
                        else await self._evidence().ingest(
                            job["notebook_id"],
                            local_source,
                            text.title,
                            text.content.encode(),
                            mime_type="text/plain",
                            filename="snapshot.txt",
                            origin="remote_text_snapshot",
                            original_status="missing",
                        )
                    )
                    await self._evidence().extract(version["source_version_id"])
                    if link.get("mapping_status") != "verified":
                        link.update(
                            source_version_id=version["source_version_id"],
                            mapping_method="remote_text_snapshot",
                            mapping_status="verified",
                        )
                async with self.store.project_lock(job["notebook_id"]):
                    await self.store.put("source_link", link["source_link_id"], link)
                report["imported"].append(source_id)
            except Exception as exc:
                error = classify_error(exc)
                report["failed"].append(
                    {"remote_source_id": source_id, "code": error.code}
                )
                # Even failed text fetches retain metadata and missing-original truth.
                async with self.store.project_lock(job["notebook_id"]):
                    await self.store.put("source_link", link["source_link_id"], link)
            async with self.store.project_lock(job["notebook_id"]):
                await self.store.put("import_report", report_id, report)
        async with self.store.project_lock(job["notebook_id"]):
            await self.store.put("import_report", report_id, report)
        await self._save(job, state="succeeded", result={"import_report": report})

    async def resolve_scope(self, request):
        req = dict(request)
        if (
            not isinstance(req.get("remote_notebook_id"), str)
            or not req["remote_notebook_id"]
        ):
            raise BridgeError(
                "INVALID_REQUEST", "Choose a remote notebook before asking."
            )
        version_ids = list(dict.fromkeys(req.get("source_version_ids") or []))
        links = await self.store.list(
            "source_link",
            notebook_id=req["notebook_id"],
            remote_notebook_id=req["remote_notebook_id"],
        )
        if req.get("selection_origin") == "local":
            if not version_ids:
                raise BridgeError("EMPTY_SCOPE", "Select one or more local versions.")
            selected_links = []
            for version_id in version_ids:
                version = await self._evidence().version(version_id)
                if version["notebook_id"] != req["notebook_id"]:
                    raise BridgeError(
                        "INVALID_REQUEST",
                        "A selected version belongs to another notebook.",
                    )
                matches = [
                    r
                    for r in links
                    if r.get("source_version_id") == version_id
                    and r["mapping_status"] == "verified"
                    and r.get("remote_status") == "ready"
                ]
                if len(matches) != 1:
                    raise BridgeError(
                        "UNMAPPED_SOURCE",
                        "A selected local version has no unique verified ready remote mapping.",
                    )
                selected_links.append(matches[0])
            req["remote_source_ids"] = [r["remote_source_id"] for r in selected_links]
        elif req.get("selection_origin") == "remote":
            if not req.get("remote_source_ids"):
                raise BridgeError("EMPTY_SCOPE", "Select explicit remote source IDs.")
            selected_links = [
                r
                for r in links
                if r["remote_source_id"] in req["remote_source_ids"]
                and r["mapping_status"] == "verified"
            ]
            version_ids = [
                r["source_version_id"]
                for r in selected_links
                if r.get("source_version_id")
            ]
        else:
            raise BridgeError(
                "INVALID_REQUEST", "selection_origin must be local or remote."
            )
        req["remote_source_ids"] = list(dict.fromkeys(req["remote_source_ids"]))
        req["source_version_ids"] = version_ids
        scope = {
            "engine": "notebooklm",
            "selection_origin": req["selection_origin"],
            "source_version_ids": version_ids,
            "remote_notebook_id": req["remote_notebook_id"],
            "remote_source_ids": req["remote_source_ids"],
            "mappings": [
                {
                    key: r.get(key)
                    for key in (
                        "source_link_id",
                        "remote_source_id",
                        "source_version_id",
                        "mapping_method",
                        "last_checked_at",
                    )
                }
                for r in selected_links
            ],
        }
        scope["scope_hash"] = digest(
            {
                "versions": sorted(version_ids),
                "remote": sorted(req["remote_source_ids"]),
                "notebook": req["remote_notebook_id"],
            }
        )
        req["scope_snapshot"] = scope
        return req

    async def ask(self, request, chat_session_id=None):
        original = {k: v for k, v in request.items() if not k.startswith("_")}
        original["chat_session_id"] = chat_session_id
        key = request.get("idempotency_key")
        if not isinstance(key, str) or not key or not request.get("notebook_id"):
            raise BridgeError(
                "INVALID_REQUEST", "A notebook and idempotency key are required."
            )
        identity = f"job_{uuid5(NAMESPACE_URL, request['notebook_id'] + ':' + key)}"
        job = await self.store.get("job", identity)
        expected_hash = digest({"operation": "ask", "request": original})
        if job and job["request_hash"] != expected_hash:
            raise BridgeError(
                "IDEMPOTENCY_CONFLICT", "This key already identifies another request."
            )
        if job is None:
            req = await self.resolve_scope(request)
            req["chat_session_id"] = chat_session_id
            req["original_request"] = original
            await self._require_strict_ask_capability()
            job = await self.create_job(req["notebook_id"], "ask", req, key)
        if job["state"] not in TERMINAL:
            job = await self.run_job(job["job_id"])
        if job["state"] != "succeeded":
            error = job.get("error") or {
                "code": "JOB_PENDING",
                "message": "The original question is still processing. Query its saved job.",
            }
            raise BridgeError(
                error["code"],
                error["message"],
                submission_state=job["submission_state"],
            )
        return {**job["result"], "job_id": job["job_id"]}

    async def _require_strict_ask_capability(self):
        capabilities = await self.bridge.capabilities()
        capability = next((c for c in capabilities.operations if c.name == "ask"), None)
        if not capability or capability.support != "available":
            raise BridgeError(
                "SCOPE_ISOLATION_UNAVAILABLE",
                "Strict source isolation has not been verified for this connection.",
            )

    async def _ask_job(self, job):
        from open_notebook.integrations.notebooklm.contracts import BridgeAskRequest

        req = job["request_snapshot"]
        await self._validate_remote_scope(req)
        scope = req["scope_snapshot"]
        conversation_key = "conversation_" + digest(
            [req["remote_notebook_id"], req.get("chat_session_id")]
        )
        async with self.store.project_lock(
            "notebooklm:conversation:" + req["remote_notebook_id"]
        ):
            previous = await self.store.get("connection", conversation_key)
            conversation_id = (
                previous["conversation_id"]
                if previous and previous["scope_hash"] == scope["scope_hash"]
                else None
            )
            answer = await self._write(
                job,
                lambda: self.bridge.ask(
                    BridgeAskRequest(
                        remote_notebook_id=req["remote_notebook_id"],
                        message=req["message"],
                        remote_source_ids=req["remote_source_ids"],
                        conversation_id=conversation_id,
                        scope_hash=scope["scope_hash"],
                    )
                ),
            )
            # Save raw-normalized response immediately; never store SDK raw RPC logs.
            await self._save(
                job,
                submission_state="confirmed",
                remote_task_id=answer.conversation_id,
                result={
                    "answer": answer.answer,
                    "conversation_id": answer.conversation_id,
                    "references": [r.model_dump() for r in answer.references],
                },
            )
            await self.store.put(
                "connection",
                conversation_key,
                {
                    "scope_hash": scope["scope_hash"],
                    "conversation_id": answer.conversation_id,
                },
            )
        await self._finish_answer(job, answer)

    async def _finish_answer(self, job, answer):
        from open_notebook.integrations.notebooklm.contracts import (
            ADAPTER_VERSION,
            SDK_VERSION,
        )

        req = job["request_snapshot"]
        scope = req["scope_snapshot"]
        citations = [
            await self.map_reference(req, ref, index + 1)
            for index, ref in enumerate(answer.references)
        ]
        await self._save(
            job,
            state="succeeded",
            result={
                "answer": answer.answer,
                "conversation_id": answer.conversation_id,
                "citations": citations,
                "evidence_ids": [
                    c["evidence_id"]
                    for c in citations
                    if c["reference_validity"] == "verified"
                ],
                "scope_snapshot": scope,
                "usage": answer.usage,
                "connector_version": f"notebooklm-py/{SDK_VERSION};adapter/{ADAPTER_VERSION}",
            },
        )

    async def map_reference(self, request, reference, number):
        citation = {
            "citation_id": f"c{number}",
            "kind": "remote_unmapped",
            "evidence_id": None,
            "source_version_id": None,
            "source_title": None,
            "locator": None,
            "quote": reference.quote or "",
            "reference_validity": "unverified",
            "remote_reference": reference.model_dump(),
        }
        if reference.remote_source_id not in request["remote_source_ids"]:
            return {
                **citation,
                "reference_validity": "out_of_scope",
                "reason": "Remote citation is outside this turn selection.",
            }
        matches = [
            r
            for r in request["scope_snapshot"]["mappings"]
            if r["remote_source_id"] == reference.remote_source_id
            and r.get("source_version_id") in request["source_version_ids"]
        ]
        if len(matches) != 1 or not reference.quote:
            return citation
        version_id = matches[0]["source_version_id"]
        link_id = matches[0].get("source_link_id")
        current = await self.store.get("source_link", link_id) if link_id else None
        if (
            not current
            or current.get("mapping_status") != "verified"
            or current.get("source_version_id") != version_id
        ):
            return {
                **citation,
                "reason": "The remote-to-original mapping is no longer verified.",
            }
        evidence = await self._evidence().list_evidence(version_id)
        candidates = [r for r in evidence if reference.quote in r["quote"]]
        if len(candidates) != 1 or candidates[0]["quote"].count(reference.quote) != 1:
            return {**citation, "reason": "No unique exact local evidence match."}
        validated = await self._evidence().validate_citation(
            {
                **citation,
                "evidence_id": candidates[0]["evidence_id"],
                "source_version_id": version_id,
            },
            request["source_version_ids"],
        )
        return {**validated, "remote_reference": reference.model_dump()}


_service = None


def get_notebooklm_service():
    global _service
    if _service is None:
        _service = NotebookLMService()
    return _service


async def dispatch_due_jobs():
    await get_notebooklm_service().dispatch_due_jobs()
