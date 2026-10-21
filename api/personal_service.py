"""Workbench coordination over upstream sources, notes and surreal-commands."""

import hashlib
import json
from datetime import datetime, timezone

from api.personal_store import get_store
from open_notebook.exceptions import InvalidInputError, NotFoundError


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


async def submit_job(command, args):
    from surreal_commands.core.service import CommandRequest, command_service

    import commands  # noqa: F401

    return str(
        await command_service.submit_command(
            CommandRequest(app="open_notebook", command=command, args=args)
        )
    )


class PersonalService:
    def __init__(self, store=None, submit=None):
        self.store = store or get_store()
        self.submit = submit or submit_job

    async def save_selection(self, notebook_id, value):
        if value.get("engine") not in ("independent", "notebooklm"):
            raise InvalidInputError("INVALID_ENGINE")
        versions = list(dict.fromkeys(value.get("source_version_ids", [])))
        if len(versions) > 20:
            raise InvalidInputError("SOURCE_LIMIT: select at most 20 sources")
        for identity in versions:
            version = await self.store.get("version", identity)
            if not version or version.get("notebook_id") != notebook_id:
                raise InvalidInputError(
                    "OUT_OF_SCOPE: version does not belong to this notebook"
                )
        selection = {
            key: value[key]
            for key in (
                "engine",
                "remote_source_ids",
                "selection_origin",
                "reading",
                "chat_session_id",
            )
            if key in value
        }
        selection.update(
            notebook_id=notebook_id, source_version_ids=versions, updated_at=now()
        )
        async with self.store.project_lock(notebook_id):
            await self.store.put("selection", notebook_id, selection)
        return selection

    async def submit_turn(self, chat_session_id, request):
        notebook_id = request.get("notebook_id")
        if not notebook_id or not request.get("idempotency_key"):
            raise InvalidInputError("notebook_id and idempotency_key are required")
        if request.get("engine") not in ("notebooklm", "independent"):
            raise InvalidInputError("INVALID_ENGINE")
        if not str(request.get("message", "")).strip():
            raise InvalidInputError("EMPTY_MESSAGE")
        identity = "job_" + digest(
            {"session": chat_session_id, "key": request["idempotency_key"]}
        )
        request_hash = digest(request)
        async with self.store.project_lock(notebook_id):
            old = await self.store.get("job", identity)
            if old:
                if old["request_hash"] != request_hash:
                    raise InvalidInputError("IDEMPOTENCY_CONFLICT")
                return old
            job = {
                "job_id": identity,
                "turn_id": "turn_" + digest(identity),
                "notebook_id": notebook_id,
                "operation": "chat",
                "chat_session_id": chat_session_id,
                "idempotency_key": request["idempotency_key"],
                "request_hash": request_hash,
                "request_snapshot": request,
                "state": "queued",
                "submission_state": "not_submitted",
                "attempts": 0,
                "created_at": now(),
            }
            await self.store.put("job", identity, job, create_only=True)
        try:
            worker_id = await self.submit("personal_turn", {"job_id": identity})
        except Exception as exc:
            # Worker queue submission is local and querying this durable job remains safe.
            job.update(
                state="failed",
                error={
                    "code": "WORKER_UNAVAILABLE",
                    "message": "Could not enqueue answer; worker/database availability must be checked",
                },
            )
            await self.store.put("job", identity, job)
            raise InvalidInputError("WORKER_UNAVAILABLE") from exc
        async with self.store.project_lock(notebook_id):
            latest = await self.store.get("job", identity)
            if latest is None:
                raise NotFoundError("Job not found")
            job = latest
            job["worker_job_id"] = worker_id
            await self.store.put("job", identity, job)
        return job

    async def run_turn(self, job_id):
        job = await self.store.get("job", job_id)
        if not job:
            raise NotFoundError("Job not found")
        async with self.store.project_lock(job["notebook_id"]):
            job = await self.store.get("job", job_id)
            if job is None:
                raise NotFoundError("Job not found")
            if job.get("restored_history") or job.get("replay_allowed") is False:
                return job
            if job["state"] in (
                "succeeded",
                "failed",
                "submission_unknown",
                "cancelled_local",
            ):
                return job
            if job["state"] == "running":
                job.update(
                    state="submission_unknown",
                    submission_state="unknown",
                    error={
                        "code": "SUBMISSION_UNKNOWN",
                        "message": "Previous answer attempt may have reached the provider; not repeated",
                    },
                )
                await self.store.put("job", job_id, job)
                return job
            job.update(
                state="running",
                submission_state="unknown",
                attempts=job.get("attempts", 0) + 1,
                started_at=now(),
            )
            await self.store.put("job", job_id, job)
        google_turn = None
        request = {**job["request_snapshot"], "_turn_id": job["turn_id"]}
        if request["engine"] == "notebooklm":
            google_turn = {
                "turn_id": job["turn_id"],
                "notebook_id": job["notebook_id"],
                "chat_session_id": job["chat_session_id"],
                "engine": "notebooklm",
                "message": request["message"],
                "scope_snapshot": {
                    key: request.get(key)
                    for key in (
                        "source_version_ids",
                        "remote_source_ids",
                        "remote_notebook_id",
                        "selection_origin",
                    )
                },
                "answer": None,
                "citations": [],
                "evidence_ids": [],
                "status": "running",
                "created_at": now(),
            }
            await self.store.put(
                "turn", google_turn["turn_id"], google_turn, create_only=True
            )
        try:
            if request["engine"] == "independent":
                from open_notebook.graphs.grounded_chat import GroundedChatService

                result = await GroundedChatService(store=self.store).turn(
                    job["notebook_id"], job["chat_session_id"], request
                )
            else:
                from api.notebooklm_service import NotebookLMService

                result = await NotebookLMService(store=self.store).ask(
                    request, chat_session_id=job["chat_session_id"]
                )
                assert google_turn is not None
                google_turn.update(result, status="succeeded", completed_at=now())
                result = google_turn
            if result.get("status") != "succeeded":
                raise InvalidInputError(
                    "SUBMISSION_UNKNOWN: previous turn has no confirmed final answer"
                )
            job.update(
                state="succeeded",
                submission_state="confirmed",
                result=result,
                completed_at=now(),
            )
        except Exception as exc:
            code = getattr(exc, "code", type(exc).__name__)
            unknown = getattr(exc, "submission_state", None) == "unknown" or code in (
                "SUBMISSION_UNKNOWN",
                "NETWORK_ERROR",
                "NetworkError",
                "TimeoutError",
            )
            job.update(
                state="submission_unknown" if unknown else "failed",
                submission_state="unknown" if unknown else "not_submitted",
                error={"code": code, "message": str(exc)[:500]},
                completed_at=now(),
            )
        if google_turn is not None:
            if job["state"] != "succeeded":
                google_turn.update(
                    status="failed", error=job.get("error"), completed_at=now()
                )
            async with self.store.project_lock(job["notebook_id"]):
                await self.store.put("turn", google_turn["turn_id"], google_turn)
        async with self.store.project_lock(job["notebook_id"]):
            current = await self.store.get("job", job_id)
            if current and current.get("state") == "cancelled_local":
                return current
            merged = {**(current or {}), **job}
            if current and current.get("worker_job_id"):
                merged["worker_job_id"] = current["worker_job_id"]
            await self.store.put("job", job_id, merged)
            job = merged
        return job

    async def workspace(self, notebook_id):
        from open_notebook.domain.notebook import Notebook

        notebook = await Notebook.get(notebook_id)
        sources = await notebook.get_sources()
        versions = await self.store.list("version", notebook_id=notebook_id)
        notes = await notebook.get_notes(include_content=True)
        snapshots = {
            n["note_id"]: n
            for n in await self.store.list("note_snapshot", notebook_id=notebook_id)
        }
        return {
            "notebook": {"id": notebook.id, "name": notebook.name},
            "sources": [
                {
                    "source_id": s.id,
                    "title": s.title,
                    "versions": [v for v in versions if v["source_id"] == s.id],
                }
                for s in sources
            ],
            "notes": [
                {**snapshots.get(n.id, {}), **n.model_dump(mode="json")} for n in notes
            ],
            "turns": await self.store.list("turn", notebook_id=notebook_id),
            "jobs": await self.store.list("job", notebook_id=notebook_id),
            "link": await self.store.get("link", notebook_id),
            "selection": await self.store.get("selection", notebook_id),
            "legacy_history": await self.store.list(
                "legacy_chat", notebook_id=notebook_id
            ),
        }

    async def save_note(self, notebook_id, value, note_id=None):
        from open_notebook.database.repository import (
            repo_create,
            repo_relate,
            repo_update,
        )

        title = str(value.get("title") or "Study note")[:500]
        content = str(value.get("content") or "")
        if not content.strip():
            raise InvalidInputError("EMPTY_NOTE")
        from api.evidence_service import EvidenceService

        evidence = EvidenceService(store=self.store)
        scope = value.get("scope_snapshot", {})
        versions = scope.get("source_version_ids", [])
        for identity in versions:
            version = await self.store.get("version", identity)
            if not version or version.get("notebook_id") != notebook_id:
                raise InvalidInputError("OUT_OF_SCOPE: note refers to another notebook")
        citations = []
        for citation in value.get("citations", []):
            if citation.get("kind") == "remote_unmapped" and not citation.get(
                "evidence_id"
            ):
                citations.append(
                    {
                        key: citation.get(key)
                        for key in (
                            "citation_id",
                            "kind",
                            "source_title",
                            "quote",
                            "remote_reference",
                        )
                    }
                )
                citations[-1].update(
                    evidence_id=None,
                    source_version_id=None,
                    locator=None,
                    reference_validity="unverified",
                )
            else:
                citations.append(await evidence.validate_citation(citation, versions))
        async with self.store.project_lock(notebook_id):
            if note_id:
                previous = await self.store.get("note_snapshot", note_id)
                if not previous or previous["notebook_id"] != notebook_id:
                    raise NotFoundError("V1 note not found")
                await repo_update("note", note_id, {"title": title, "content": content})
            else:
                result = await repo_create(
                    "note", {"title": title, "content": content, "embedding": []}
                )
                result = result[0] if isinstance(result, list) else result
                note_id = result["id"]
                await repo_relate(note_id, "artifact", notebook_id)
            snapshot = {
                "note_id": note_id,
                "id": note_id,
                "notebook_id": notebook_id,
                "title": title,
                "content": content,
                "citations": citations,
                "scope_snapshot": value.get("scope_snapshot", {}),
                "created_at": now(),
                "updated_at": now(),
            }
            await self.store.put("note_snapshot", note_id, snapshot)
        return snapshot
