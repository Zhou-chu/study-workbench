"""Project portability endpoints inherit the API's mandatory password guard."""

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.datastructures import UploadFile

from api.personal_transport_contracts import transport_responses
from api.portable_service import get_portable_service
from open_notebook.exceptions import InvalidInputError

router = APIRouter(prefix="/personal", tags=["personal-portability"])


class ExportRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=200)


@router.post("/notebooks/{notebook_id}/exports", status_code=202)
async def create_export(notebook_id: str, request: ExportRequest):
    return await get_portable_service().request_export(
        notebook_id, request.idempotency_key
    )


@router.get("/portable/limits")
async def portable_limits():
    return get_portable_service().limits.public()


@router.post(
    "/imports/portable",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                        "additionalProperties": False,
                    }
                }
            },
        }
    },
)
async def import_portable(request: Request):
    # Do not use File(...): FastAPI would parse with the generic 1000-file
    # allowance before this route can restrict in-memory multipart spools.
    media_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    )
    if media_type != "multipart/form-data":
        raise InvalidInputError("Portable import requires multipart/form-data")
    async with request.form(max_files=1, max_fields=0) as form:
        file = form.get("file")
        if len(form) != 1 or not isinstance(file, UploadFile):
            raise InvalidInputError("Upload exactly one ZIP file in the file field")
        await file.seek(0)
        return await get_portable_service().import_archive(file.file)


@router.get(
    "/exports/{export_id}/download",
    response_class=FileResponse,
    responses=transport_responses(
        ["application/zip"],
        "Protected ZIP bytes; attachment study-workbench-project.zip, private/no-store.",
    ),
)
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
