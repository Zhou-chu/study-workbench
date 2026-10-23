"""Authenticated V1 original versions, evidence, selection, notes and turns."""

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from api.evidence_maintenance import EvidenceMaintenanceService
from api.evidence_reads import EvidenceReadContext
from api.evidence_service import EvidenceService
from api.personal_contracts import (
    NoteConflictResponse,
    NoteCreateRequest,
    NoteRequiredResponse,
    NoteUpdateRequest,
    NoteWriteCapabilities,
    PersonalNoteResponse,
    SelectionResponse,
    TurnSubmissionResponse,
    WorkspaceResponse,
)
from api.personal_service import PersonalService, digest, now, submit_job
from api.personal_store import get_store
from api.personal_transport_contracts import TURN_EVENTS_RESPONSES, transport_responses
from open_notebook.database.repository import repo_delete, repo_relate
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import InvalidInputError, NotFoundError

router = APIRouter(prefix="/personal", tags=["personal-evidence"])


class TurnRequest(BaseModel):
    notebook_id: str
    engine: Literal["notebooklm", "independent"]
    message: str = Field(min_length=1, max_length=50000)
    selection_origin: Literal["local", "remote"] = "local"
    source_version_ids: list[str] = Field(default_factory=list, max_length=20)
    remote_notebook_id: str | None = None
    remote_source_ids: list[str] = Field(default_factory=list, max_length=20)
    idempotency_key: str = Field(min_length=1, max_length=200)
    model_id: str | None = None
    task: Literal["question", "outline"] = "question"


@router.get(
    "/notebooks/{notebook_id}/workspace",
    response_model=WorkspaceResponse,
    response_model_exclude_unset=True,
)
async def workspace(notebook_id: str):
    # Preserve the pre-response-model FastAPI wire encoding (notably UTC +00:00).
    return jsonable_encoder(await PersonalService().workspace(notebook_id))


@router.patch(
    "/notebooks/{notebook_id}/selection",
    response_model=SelectionResponse,
    response_model_exclude_unset=True,
)
async def selection(notebook_id: str, value: dict[str, Any]):
    await Notebook.get(notebook_id)
    return await PersonalService().save_selection(notebook_id, value)


@router.post("/notebooks/{notebook_id}/sources/upload")
async def upload(
    notebook_id: str,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    idempotency_key: str = Form(...),
    source_id: str | None = Form(None),
):
    await Notebook.get(notebook_id)
    if not idempotency_key or len(idempotency_key) > 200:
        raise InvalidInputError("INVALID_IDEMPOTENCY_KEY")
    service = EvidenceService()
    import os

    size_limit = int(
        float(os.getenv("STUDY_WORKBENCH_MAX_FILE_MB", "50")) * 1024 * 1024
    )
    data = await file.read(size_limit + 1)
    if len(data) > size_limit:
        raise InvalidInputError("FILE_TOO_LARGE")
    job_id = "job_" + digest({"notebook_id": notebook_id, "upload": idempotency_key})
    request_hash = digest(
        {
            "bytes": __import__("hashlib").sha256(data).hexdigest(),
            "title": title or file.filename,
            "source_id": source_id,
            "filename": file.filename,
            "mime_type": (file.content_type or "").split(";", 1)[0].strip().lower(),
        }
    )
    store = get_store()
    # Upload lock serializes same key without nesting the project commit barrier.
    async with store.project_lock("upload:" + job_id):
        old = await store.get("job", job_id)
        if old:
            if old["request_hash"] != request_hash:
                raise InvalidInputError("IDEMPOTENCY_CONFLICT")
            return {
                "source_id": old["source_id"],
                "source_version_id": old["source_version_id"],
                "job_id": job_id,
            }
        created = False
        if source_id:
            sources = await (await Notebook.get(notebook_id)).get_sources()
            if source_id not in [s.id for s in sources]:
                raise InvalidInputError("SOURCE_OUT_OF_SCOPE")
            source = await Source.get(source_id)
        else:
            source = Source(title=title or file.filename or "Source")
            await source.save()
            if source.id is None:
                raise RuntimeError("Source save returned no identity")
            await repo_relate(source.id, "reference", notebook_id)
            created = True
        try:
            version = await service.ingest(
                notebook_id,
                source.id,
                title or file.filename or "Source",
                data,
                mime_type=file.content_type,
                filename=file.filename,
            )
        except InvalidInputError:
            # Only definite pre-write validation rejection permits cleanup.
            # Metadata-write errors are outcome-unknown and retain this source.
            if created and source.id is not None:
                await repo_delete(source.id)
            raise
        job = {
            "job_id": job_id,
            "notebook_id": notebook_id,
            "source_id": source.id,
            "source_version_id": version["source_version_id"],
            "operation": "extract_evidence",
            "idempotency_key": idempotency_key,
            "request_hash": request_hash,
            "state": "queued",
            "submission_state": "not_submitted",
            "created_at": now(),
            "attempts": 0,
        }
        await store.put("job", job_id, job, create_only=True)
        try:
            worker_id = await submit_job(
                "extract_evidence",
                {"source_version_id": version["source_version_id"], "job_id": job_id},
            )
            async with store.project_lock(notebook_id):
                current = await store.get("job", job_id)
                if current is None:
                    raise NotFoundError("Extraction job not found")
                current["worker_job_id"] = worker_id
                await store.put("job", job_id, current)
        except Exception:
            job.update(
                state="failed",
                error={
                    "code": "WORKER_UNAVAILABLE",
                    "message": "Original saved; extraction could not be queued",
                },
            )
            await store.put("job", job_id, job)
        return {
            "source_id": source.id,
            "source_version_id": version["source_version_id"],
            "job_id": job_id,
        }


@router.get("/sources/{source_id}/versions")
async def versions(source_id: str):
    return await EvidenceService().versions(source_id)


@router.get("/source-versions/{source_version_id}")
async def version(
    source_version_id: str,
    evidence_id: str | None = None,
    extraction_id: str | None = None,
):
    service = EvidenceService()
    reads = EvidenceReadContext(service.store)
    value = await service.version(source_version_id, _reads=reads)
    extraction = value.pop("extraction", None)
    if evidence_id:
        record = await service.evidence(evidence_id, _reads=reads)
        if record["source_version_id"] != source_version_id:
            raise InvalidInputError("EVIDENCE_VERSION_MISMATCH")
        if extraction_id and extraction_id != record["extraction_id"]:
            raise InvalidInputError("EVIDENCE_EXTRACTION_MISMATCH")
        extraction_id = record["extraction_id"]
    if extraction_id:
        extraction = await reads.get("extraction", extraction_id)
        if not extraction or extraction["source_version_id"] != source_version_id:
            raise InvalidInputError("EXTRACTION_VERSION_MISMATCH")
    records = await service.list_evidence(
        source_version_id, extraction_id=extraction_id, _reads=reads
    )
    for record in records:
        validation = await service.validate_citation(
            {"evidence_id": record["evidence_id"]}, [source_version_id], _reads=reads
        )
        record["reference_validity"] = validation["reference_validity"]
        record["reference_reason"] = validation.get("reason")
    return {"version": value, "extraction": extraction, "evidence": records}


class ReparseRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=200)


class RevalidationRequest(ReparseRequest):
    extraction_id: str = Field(min_length=1, max_length=200)


@router.post("/source-versions/{source_version_id}/reparse")
async def reparse(source_version_id: str, request: ReparseRequest):
    return await EvidenceMaintenanceService(
        evidence=EvidenceService(), submit=submit_job
    ).submit(source_version_id, "reparse", request.idempotency_key)


@router.post("/source-versions/{source_version_id}/revalidate")
async def revalidate(source_version_id: str, request: RevalidationRequest):
    return await EvidenceMaintenanceService(
        evidence=EvidenceService(), submit=submit_job
    ).submit(
        source_version_id, "revalidate", request.idempotency_key, request.extraction_id
    )


@router.get(
    "/source-versions/{source_version_id}/download",
    response_class=FileResponse,
    responses=transport_responses(
        ["application/pdf", "text/plain", "text/markdown"],
        "Protected original bytes; inline stored title, no-store. MIME is allowlisted.",
    ),
)
async def download(source_version_id: str):
    service = EvidenceService()
    version = await service.version(source_version_id)
    if version["mime_type"] not in {"application/pdf", "text/plain", "text/markdown"}:
        raise InvalidInputError("UNSAFE_ORIGINAL_TYPE: unsupported original MIME")
    path = await service.resolve_file(source_version_id)
    return FileResponse(
        path,
        media_type=version["mime_type"],
        filename=version["source_title"],
        content_disposition_type="inline",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/evidence/{evidence_id}")
async def evidence(evidence_id: str):
    service = EvidenceService()
    record = await service.evidence(evidence_id)
    validation = await service.validate_citation(
        {"evidence_id": evidence_id}, [record["source_version_id"]]
    )
    return {
        **record,
        "reference_validity": validation["reference_validity"],
        "reference_reason": validation.get("reason"),
    }


@router.post("/search")
async def search(value: dict[str, Any]):
    return {
        "hits": await EvidenceService().retrieve(
            str(value.get("query", "")), value.get("source_version_ids", [])
        )
    }


@router.post(
    "/chats/{chat_session_id}/turns",
    response_model=TurnSubmissionResponse,
    response_model_exclude_unset=True,
)
async def turn(chat_session_id: str, request: TurnRequest):
    await Notebook.get(request.notebook_id)
    service = EvidenceService()
    for identity in request.source_version_ids:
        if (await service.version(identity))["notebook_id"] != request.notebook_id:
            raise InvalidInputError("SOURCE_OUT_OF_SCOPE")
    job = await PersonalService().submit_turn(chat_session_id, request.model_dump())
    return {
        "job_id": job["job_id"],
        "turn_id": job["turn_id"],
        "state": job["state"],
    }


@router.get("/chats/{chat_session_id}/turns")
async def turns(chat_session_id: str):
    return sorted(
        await get_store().list("turn", chat_session_id=chat_session_id),
        key=lambda v: v.get("created_at", ""),
    )


@router.get(
    "/turns/{turn_id}/events",
    response_class=StreamingResponse,
    responses=TURN_EVENTS_RESPONSES,
)
async def turn_events(turn_id: str):
    async def events():
        previous = None
        for _ in range(120):
            # Cancellation ends this wait even if a late canonical turn exists.
            jobs = await get_store().list("job", turn_id=turn_id)
            cancelled = next(
                (job for job in jobs if job["state"] == "cancelled_local"), None
            )
            if cancelled:
                yield (
                    "event: stage\ndata: "
                    + json.dumps(
                        {
                            "turn_id": turn_id,
                            "state": "cancelled_local",
                            "error": cancelled.get("error"),
                            **(
                                {
                                    "remote_may_continue": cancelled[
                                        "remote_may_continue"
                                    ]
                                }
                                if "remote_may_continue" in cancelled
                                else {}
                            ),
                        }
                    )
                    + "\n\n"
                )
                return
            turn = await get_store().get("turn", turn_id)
            if not turn:
                if jobs:
                    job = jobs[0]
                    yield (
                        "event: stage\ndata: "
                        + json.dumps(
                            {
                                "turn_id": turn_id,
                                "state": job["state"],
                                "error": job.get("error"),
                            }
                        )
                        + "\n\n"
                    )
                    if job["state"] in (
                        "failed",
                        "submission_unknown",
                        "cancelled_local",
                    ):
                        return
                    await asyncio.sleep(1)
                    continue
                yield (
                    "event: error\ndata: "
                    + json.dumps({"code": "TURN_NOT_FOUND"})
                    + "\n\n"
                )
                return
            state = turn.get("status")
            if state != previous:
                yield (
                    f"event: {'final' if state in ('succeeded', 'failed') else 'stage'}\ndata: "
                    + json.dumps(turn, ensure_ascii=False, default=str)
                    + "\n\n"
                )
                previous = state
            if state in ("succeeded", "failed"):
                return
            await asyncio.sleep(1)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"}
    )


@router.post("/notebooks/{notebook_id}/notes", response_model=PersonalNoteResponse)
async def create_note(notebook_id: str, value: NoteCreateRequest):
    await Notebook.get(notebook_id)
    return await PersonalService().save_note(notebook_id, value.model_dump())


@router.patch(
    "/notebooks/{notebook_id}/notes/{note_id}",
    response_model=PersonalNoteResponse,
    responses={
        409: {"model": NoteConflictResponse},
        428: {"model": NoteRequiredResponse},
    },
)
async def update_note(notebook_id: str, note_id: str, value: NoteUpdateRequest):
    await Notebook.get(notebook_id)
    return await PersonalService().save_note(notebook_id, value.model_dump(), note_id)


@router.get("/note-capabilities", response_model=NoteWriteCapabilities)
async def note_capabilities():
    from open_notebook.config import get_note_write_mode

    return NoteWriteCapabilities(
        expected_revision_required=get_note_write_mode() == "multiclient"
    )
