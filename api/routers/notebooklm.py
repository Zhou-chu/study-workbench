"""Private NotebookLM endpoints. Authentication is the application's middleware."""

import asyncio
import hashlib
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from api.notebooklm_service import get_notebooklm_service
from api.personal_store import data_root
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import InvalidInputError, NotFoundError
from open_notebook.integrations.notebooklm.sdk_adapter import now

router = APIRouter(prefix="/personal", tags=["personal-notebooklm"])


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IdempotentRequest(RequestModel):
    idempotency_key: str = Field(min_length=1, max_length=200)


class CreateRequest(IdempotentRequest):
    notebook_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=500)


class LinkRequest(RequestModel):
    remote_notebook_id: str = Field(min_length=1, max_length=200)


class ImportRequest(IdempotentRequest):
    remote_notebook_id: str = Field(min_length=1, max_length=200)
    remote_source_ids: list[str] = Field(min_length=1, max_length=20)
    include_text: bool = True


class SyncRequest(IdempotentRequest):
    remote_notebook_id: str = Field(min_length=1, max_length=200)
    source_version_ids: list[str] = Field(min_length=1, max_length=20)


class AudioRequest(ImportRequest):
    source_version_ids: list[str] = Field(default_factory=list, max_length=20)
    language: str = Field(default="zh", min_length=2, max_length=20)


class DownloadRequest(IdempotentRequest):
    notebook_id: str = Field(min_length=1, max_length=200)
    remote_notebook_id: str = Field(min_length=1, max_length=200)


@router.get("/connections/notebooklm")
async def connection_status(service=Depends(get_notebooklm_service)):
    stored = await service.store.get("connection", "notebooklm")
    if stored and stored.get("disabled"):
        return {
            "state": "disconnected",
            "reason": None,
            "last_verified_at": None,
            "account_label": None,
            "quota": None,
        }
    async with service.store.project_lock("notebooklm:account-call"):
        status = await service.bridge.verify_connection()
    if status.state == "connected":
        # Resume only the read phase of already-confirmed tasks after reauth.
        for job in await service.store.list(
            "job", provider="notebooklm", state="needs_reauth"
        ):
            if job["submission_state"] == "confirmed" and job.get("remote_task_id"):
                await service._save(job, state="waiting_remote", next_poll_at=now())
    return status


@router.post("/connections/notebooklm/connect")
@router.post("/connections/notebooklm/reconnect")
async def connect(service=Depends(get_notebooklm_service)):
    async with service.store.project_lock("notebooklm:connection"):
        saved = await service.store.get("connection", "notebooklm") or {}
        flow = saved.get("flow")
        if flow and flow["expires_at"] > now() and not saved.get("disabled"):
            return flow
        flow = await service.bridge.start_login()
        await service.store.put(
            "connection", "notebooklm", {"disabled": False, "flow": flow}
        )
        return flow


@router.get("/connections/notebooklm/connect/{flow_id}")
async def login_flow(flow_id: str, service=Depends(get_notebooklm_service)):
    saved = await service.store.get("connection", "notebooklm") or {}
    flow = saved.get("flow")
    if not flow or flow["flow_id"] != flow_id:
        raise NotFoundError("Login flow not found")
    if flow["expires_at"] < now():
        return {
            **flow,
            "state": "unavailable",
            "reason": "Login flow expired. Start reconnect to try again.",
        }
    return flow


@router.delete("/connections/notebooklm")
async def disconnect(service=Depends(get_notebooklm_service)):
    async with service.store.project_lock("notebooklm:connection"):
        # Persist gate before draining all cross-process remote calls. SDK
        # context closure finishes before its owned storage state is removed.
        await service.store.put("connection", "notebooklm", {"disabled": True})
    async with service.store.project_lock("notebooklm:account-call"):
        status = await service.bridge.disconnect()
    async with service.store.project_lock("notebooklm:connection"):
        for capability in await service.store.list(
            "connection", connection_type="capability"
        ):
            await service.store.delete("connection", "capability_" + capability["name"])
    return status


@router.get("/notebooklm/capabilities")
async def capabilities(service=Depends(get_notebooklm_service)):
    return await service.capabilities()


@router.get("/notebooklm/notebooks")
async def notebooks(cursor: str | None = None, service=Depends(get_notebooklm_service)):
    await service._ensure_connection()
    return await service.remote_read(lambda: service.bridge.list_notebooks(cursor))


@router.get("/notebooklm/notebooks/{remote_notebook_id}/sources")
async def sources(
    remote_notebook_id: str,
    cursor: str | None = None,
    service=Depends(get_notebooklm_service),
):
    await service._ensure_connection()
    return await service.remote_read(
        lambda: service.bridge.list_sources(remote_notebook_id, cursor)
    )


@router.post("/notebooklm/notebooks")
async def create_notebook(
    request: CreateRequest, service=Depends(get_notebooklm_service)
):
    await Notebook.get(request.notebook_id)
    return await service.create_job(
        request.notebook_id,
        "create_notebook",
        {"title": request.title},
        request.idempotency_key,
    )


@router.post("/notebooks/{notebook_id}/notebooklm-link")
async def link_notebook(
    notebook_id: str, request: LinkRequest, service=Depends(get_notebooklm_service)
):
    await Notebook.get(notebook_id)
    await service._ensure_connection()
    await service.all_sources(request.remote_notebook_id)
    link_id = "link_" + str(uuid5(NAMESPACE_URL, notebook_id))
    record = {
        "link_id": link_id,
        "notebook_id": notebook_id,
        "connection_id": "notebooklm",
        "remote_notebook_id": request.remote_notebook_id,
        "last_checked_at": now(),
    }
    async with service.store.project_lock(notebook_id):
        await service.store.put("link", link_id, record)
    return record


@router.post("/notebooks/{notebook_id}/imports/notebooklm")
async def import_notebook(
    notebook_id: str, request: ImportRequest, service=Depends(get_notebooklm_service)
):
    await Notebook.get(notebook_id)
    return await service.create_job(
        notebook_id,
        "import",
        request.model_dump(exclude={"idempotency_key"}),
        request.idempotency_key,
    )


@router.post("/notebooks/{notebook_id}/sync/notebooklm")
async def sync_sources(
    notebook_id: str, request: SyncRequest, service=Depends(get_notebooklm_service)
):
    await Notebook.get(notebook_id)
    return await service.create_job(
        notebook_id,
        "sync",
        request.model_dump(exclude={"idempotency_key"}),
        request.idempotency_key,
    )


@router.post("/notebooks/{notebook_id}/artifacts/audio")
async def generate_audio(
    notebook_id: str, request: AudioRequest, service=Depends(get_notebooklm_service)
):
    await Notebook.get(notebook_id)
    value = request.model_dump(exclude={"idempotency_key", "include_text"})
    if request.source_version_ids:
        mapped = await service.resolve_scope(
            {**value, "notebook_id": notebook_id, "selection_origin": "local"}
        )
        if set(mapped["remote_source_ids"]) != set(request.remote_source_ids):
            raise InvalidInputError(
                "Selected original versions do not match the requested remote audio scope"
            )
        value["scope_snapshot"] = mapped["scope_snapshot"]
    return await service.create_job(
        notebook_id, "audio", value, request.idempotency_key
    )


@router.get("/notebooklm/notebooks/{remote_notebook_id}/artifacts")
async def artifacts(remote_notebook_id: str, service=Depends(get_notebooklm_service)):
    await service._ensure_connection()
    return await service.remote_read(
        lambda: service.bridge.list_artifacts(remote_notebook_id)
    )


@router.post("/notebooklm/artifacts/{remote_artifact_id}/download")
async def download_artifact(
    remote_artifact_id: str,
    request: DownloadRequest,
    service=Depends(get_notebooklm_service),
):
    await Notebook.get(request.notebook_id)
    return await service.create_job(
        request.notebook_id,
        "download",
        {
            "remote_notebook_id": request.remote_notebook_id,
            "remote_artifact_id": remote_artifact_id,
        },
        request.idempotency_key,
    )


@router.get("/artifacts/{artifact_id}/download")
async def local_artifact(artifact_id: str, service=Depends(get_notebooklm_service)):
    artifact = await service.store.get("artifact", artifact_id)
    if not artifact:
        raise NotFoundError("Local artifact not found")
    root = Path(service.data_root or data_root()).resolve()
    relative = Path(artifact["file_path"])
    unresolved = root / relative
    path = unresolved.resolve()
    parts = relative.parts
    allowed = bool(parts) and (
        parts[0] == "artifacts"
        or (len(parts) >= 4 and parts[0] == "restored" and parts[2] == "artifacts")
    )
    symlink = any(
        item.is_symlink()
        for item in [unresolved, *unresolved.parents]
        if item != root and item.is_relative_to(root)
    )
    if (
        relative.is_absolute()
        or ".." in parts
        or not path.is_relative_to(root)
        or not allowed
        or symlink
    ):
        raise InvalidInputError("Invalid artifact path")
    if not path.is_file():
        raise NotFoundError("Artifact bytes are missing")
    actual = await asyncio.to_thread(
        lambda: hashlib.sha256(path.read_bytes()).hexdigest()
    )
    if path.stat().st_size != artifact["byte_size"] or actual != artifact["sha256"]:
        raise InvalidInputError("Artifact integrity check failed")
    return FileResponse(
        path,
        media_type=artifact["mime_type"],
        filename=path.name,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, service=Depends(get_notebooklm_service)):
    job = await service.store.get("job", job_id)
    if not job:
        raise NotFoundError("Job not found")
    if job.get("provider") == "notebooklm":
        await service._dispatch(job)
        job = await service.job(job_id)
    elif job.get("operation") in ("reparse", "revalidate"):
        from api.evidence_maintenance import EvidenceMaintenanceService

        job = await EvidenceMaintenanceService().dispatch(job_id)
    return job


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, service=Depends(get_notebooklm_service)):
    job = await service.store.get("job", job_id)
    if not job:
        raise NotFoundError("Job not found")
    if job.get("provider") == "notebooklm":
        return await service.cancel_job(job_id)
    async with service.store.project_lock(job["notebook_id"]):
        current = await service.store.get("job", job_id)
        if not current:
            raise NotFoundError("Job not found")
        if current["state"] == "running" and current.get("operation") != "chat":
            raise InvalidInputError(
                "CANCELLATION_UNSUPPORTED: this local operation cannot be stopped once running"
            )
        if current["state"] in ("queued", "running"):
            # Stop local waiting only: an in-flight model call may still finish.
            remote_may_continue = current["state"] == "running"
            current.update(
                state="cancelled_local",
                cancel_requested=True,
                remote_may_continue=remote_may_continue,
            )
            await service.store.put("job", job_id, current)
        return current


class SourceMappingRequest(LinkRequest):
    remote_source_id: str = Field(min_length=1, max_length=200)
    source_version_id: str = Field(min_length=1, max_length=200)
    user_confirmed: bool


@router.post("/notebooks/{notebook_id}/notebooklm-source-link")
async def confirm_source_link(
    notebook_id: str,
    request: SourceMappingRequest,
    service=Depends(get_notebooklm_service),
):
    await Notebook.get(notebook_id)
    return await service.confirm_source_mapping(
        notebook_id,
        request.remote_notebook_id,
        request.remote_source_id,
        request.source_version_id,
        request.user_confirmed,
    )
