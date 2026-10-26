"""Public personal note and durable-operation contracts."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from open_notebook.database.note_contract import Revision


class NoteCreateRequest(BaseModel):
    title: str | None = None
    content: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    scope_snapshot: dict[str, Any] = Field(default_factory=dict)


class NoteUpdateRequest(NoteCreateRequest):
    expected_revision: Revision | None = None


class PersonalNoteResponse(NoteCreateRequest):
    id: str
    note_id: str
    notebook_id: str
    revision: Revision
    created_at: str
    updated_at: str


class NoteWriteCapabilities(BaseModel):
    contract_version: Literal["v1"] = "v1"
    conditional_writes: Literal[True] = True
    expected_revision_required: bool


class NoteConflictDetail(BaseModel):
    code: Literal["NOTE_REVISION_CONFLICT"] = "NOTE_REVISION_CONFLICT"
    current_revision: Revision


class NoteConflictResponse(BaseModel):
    detail: NoteConflictDetail


class NoteRequiredDetail(BaseModel):
    code: Literal["NOTE_REVISION_REQUIRED"] = "NOTE_REVISION_REQUIRED"


class NoteRequiredResponse(BaseModel):
    detail: NoteRequiredDetail


# Responses deliberately retain extension fields. These models are not persistence
# models and must be serialized with exclude_unset: absence is not a null/default.
class OperationResponse(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)


class TurnSubmissionResponse(OperationResponse):
    """Durable receipt, never a completed answer or permission to resubmit."""

    job_id: str
    turn_id: str
    state: str = Field(
        description="Raw durable state; unknown values grant no actions."
    )
    dispatch_receipt: Any = Field(
        default=None,
        description="Opaque retained dispatch ACK evidence. Newly generated receipts "
        "contain dispatch_ack:unknown, original parent job_id/turn_id and "
        "retry_safe:false. Absence, malformed or future values are inconclusive; "
        "no stored value authorizes retry or replay.",
    )


class PersonalTurnDispatchReceipt(BaseModel):
    """Known generated shape only; never validate retained historical receipts."""

    model_config = ConfigDict(extra="forbid", strict=True)

    dispatch_ack: Literal["unknown"]
    job_id: str
    turn_id: str
    retry_safe: Literal[False]


class PersonalTurnDispatchUnknownResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    detail: Literal["WORKER_UNAVAILABLE"]
    dispatch_receipt: PersonalTurnDispatchReceipt


class PersonalTurnInvalidInputResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    detail: str


class DurableJobResponse(OperationResponse):
    """Current job metadata; operation-specific result payloads remain opaque."""

    job_id: str
    notebook_id: str
    operation: str
    state: str = Field(
        description="Known: queued, running, waiting_remote, succeeded, failed, "
        "needs_reauth, submission_unknown, cancelled_local. Preserve unknown values."
    )
    submission_state: str | None = Field(
        default=None,
        description="Known: not_submitted, confirmed, unknown. Unknown is not safe to retry.",
    )
    provider: str | None = None
    turn_id: str | None = None
    chat_session_id: str | None = None
    source_id: str | None = None
    source_version_id: str | None = None
    extraction_id: str | None = None
    fresh_extraction_id: str | None = None
    worker_job_id: str | None = None
    remote_task_id: str | None = None
    idempotency_key: str | None = None
    request_hash: str | None = None
    request_snapshot: dict[str, Any] | None = None
    attempts: int | None = None
    poll_attempts: int | None = None
    created_at: str | None = None
    updated_at: str | None = None
    completed_at: str | None = None
    next_poll_at: str | None = None
    next_dispatch_at: str | None = None
    dispatch_after: str | None = None
    lease_until: str | None = None
    result: Any = Field(
        default=None, description="Operation-specific JSON; not yet fully typed."
    )
    error: Any = Field(
        default=None, description="Stored operation error, not an HTTP error envelope."
    )
    cancel_requested: bool | None = None
    remote_may_continue: bool | None = None
    replay_allowed: bool | None = None


class HistoricalJobResponse(OperationResponse):
    """Archive-compatible record, not an executable current-job contract.

    Portable restore historically accepted opaque job fields. Only identities and
    the restore marker are typed here; tightening the rest would require a separately
    reviewed archive compatibility change. Raw result/provenance/state stay intact.
    """

    job_id: str
    state: str
    restored_history: Literal[True]
    replay_allowed: Literal[False]


PersonalJobResponse = HistoricalJobResponse | DurableJobResponse


class WorkspaceNotebookResponse(OperationResponse):
    id: str
    name: str


class WorkspaceSourceResponse(OperationResponse):
    source_id: str
    title: str | None
    versions: list[dict[str, Any]] = Field(
        description="Existing version records, not a public persistence-model contract. "
        "Legacy/provenance extensions are retained; field-level typing is deferred."
    )


class WorkspaceNoteResponse(OperationResponse):
    """Native note merged over optional personal snapshot metadata.

    Native-only/shared notes need not carry citations or scope. Snapshot extensions
    remain opaque, including retained archive citations; no defaults are invented.
    """

    id: str
    revision: Revision
    title: str | None = None
    content: str | None = None


class SelectionResponse(OperationResponse):
    """Current save receipt; optional supplied values are not validated by service."""

    notebook_id: str
    engine: str
    source_version_ids: list[str]
    updated_at: str


class WorkspaceResponse(OperationResponse):
    """Typed envelope, not a complete SDK for opaque retained records."""

    notebook: WorkspaceNotebookResponse
    sources: list[WorkspaceSourceResponse]
    notes: list[WorkspaceNoteResponse]
    turns: list[dict[str, Any]]
    jobs: list[dict[str, Any]]
    link: dict[str, Any] | None
    selection: dict[str, Any] | None = Field(
        description="Null before any selection; retained selections may have legacy fields."
    )
    legacy_history: list[dict[str, Any]]
