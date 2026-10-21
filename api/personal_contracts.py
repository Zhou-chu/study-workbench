"""Typed personal note request/response contracts."""

from typing import Any, Literal

from pydantic import BaseModel, Field

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
