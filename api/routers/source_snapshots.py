"""Authenticated, same-notebook local material snapshots."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.personal_contracts import NoteConflictResponse
from api.source_snapshot_contracts import (
    SnapshotProblem,
    SnapshotProblemResponse,
    SourceSnapshotRequest,
    SourceSnapshotResponse,
)
from api.source_snapshot_service import SourceSnapshotService
from open_notebook.domain.notebook import Notebook

router = APIRouter(prefix="/personal", tags=["personal-evidence"])


@router.post(
    "/notebooks/{notebook_id}/source-snapshots",
    response_model=SourceSnapshotResponse,
    responses={
        400: {"model": SnapshotProblemResponse},
        409: {"model": NoteConflictResponse | SnapshotProblemResponse},
        410: {"model": SnapshotProblemResponse},
        413: {"model": SnapshotProblemResponse},
        503: {"model": SnapshotProblemResponse},
    },
)
async def create_source_snapshot(notebook_id: str, request: SourceSnapshotRequest):
    await Notebook.get(notebook_id)
    try:
        return await SourceSnapshotService().create(notebook_id, request)
    except SnapshotProblem as exc:
        return JSONResponse(
            status_code=exc.status, content={"detail": {"code": exc.code}}
        )
