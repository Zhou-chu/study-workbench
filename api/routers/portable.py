"""Project portability endpoints inherit the API's mandatory password guard."""

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.portable_service import get_portable_service

router = APIRouter(prefix="/personal", tags=["personal-portability"])


class ExportRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=200)


@router.post("/notebooks/{notebook_id}/exports", status_code=202)
async def create_export(notebook_id: str, request: ExportRequest):
    return await get_portable_service().request_export(
        notebook_id, request.idempotency_key
    )


@router.post("/imports/portable", status_code=201)
async def import_portable(file: UploadFile = File(...)):
    try:
        await file.seek(0)
        return await get_portable_service().import_archive(file.file)
    finally:
        await file.close()


@router.get("/exports/{export_id}/download")
async def download_export(export_id: str):
    path = await get_portable_service().download(export_id)
    return FileResponse(
        path,
        media_type="application/zip",
        filename="study-workbench-project.zip",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
