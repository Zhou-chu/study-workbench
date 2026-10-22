"""Explicit local snapshot request, response and failure contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from open_notebook.database.note_contract import Revision
from open_notebook.domain.evidence import DerivedProvenance
from open_notebook.exceptions import DatabaseOperationError, OpenNotebookError


class SnapshotRequestBase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: str = Field(min_length=1, max_length=200)


class NoteSnapshotRequest(SnapshotRequestBase):
    origin_kind: Literal["note"]
    note_id: str = Field(min_length=1, max_length=200)
    expected_revision: Revision


class TurnSnapshotRequest(SnapshotRequestBase):
    origin_kind: Literal["turn"]
    turn_id: str = Field(min_length=1, max_length=200)


SourceSnapshotRequest = Annotated[
    NoteSnapshotRequest | TurnSnapshotRequest, Field(discriminator="origin_kind")
]


class SourceSnapshotResponse(BaseModel):
    source_id: str
    source_version_id: str
    job_id: str
    status: Literal["ready"] = "ready"
    existing: bool
    embedding_status: Literal["not_requested"] = "not_requested"
    provenance: DerivedProvenance


class SnapshotProblem(OpenNotebookError):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


class SnapshotCommitUnknown(SnapshotProblem):
    def __init__(self, message="Snapshot commit acknowledgement was lost"):
        super().__init__("SNAPSHOT_COMMIT_UNKNOWN", 503)


class SnapshotCommitRejected(DatabaseOperationError):
    """Definitive transaction rejection; deterministic bytes are retained safely."""


class SnapshotProblemDetail(BaseModel):
    code: Literal[
        "SNAPSHOT_IDEMPOTENCY_CONFLICT",
        "RESULT_NOT_READY",
        "EMPTY_SNAPSHOT",
        "SNAPSHOT_TOO_LARGE",
        "SNAPSHOT_COMMIT_UNKNOWN",
        "SNAPSHOT_UNAVAILABLE",
        "INVALID_IDEMPOTENCY_KEY",
        "SOURCE_LIMIT",
        "SOURCE_OUT_OF_SCOPE",
    ]


class SnapshotProblemResponse(BaseModel):
    detail: SnapshotProblemDetail
