"""Portable V1 contracts. Offsets always refer to Unicode codepoints."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_version_id: str
    source_id: str
    notebook_id: str
    source_title: str
    origin: Literal["upload", "pasted_text", "remote_text_snapshot"] = "upload"
    original_status: Literal["available", "missing", "not_applicable"] = "available"
    sha256: str
    mime_type: str
    byte_size: int
    file_path: str
    created_at: str
    current_extraction_id: str | None = None
    status: str = "queued"


class EvidenceLocator(BaseModel):
    page_index: int | None = None
    page_label: str | None = None
    block_id: str
    start_offset: int = Field(ge=0)
    end_offset: int = Field(ge=0)
    bbox: list[float] | None = None


class Extraction(BaseModel):
    extraction_id: str
    source_version_id: str
    notebook_id: str
    parser_name: str
    parser_version: str
    schema_version: int = 1
    status: str
    page_count: int | None = None
    warnings: list[str] = Field(default_factory=list)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    created_at: str
    completed_at: str | None = None
    error: str | None = None


class EvidenceRecord(BaseModel):
    model_config = ConfigDict(frozen=True)
    evidence_id: str
    source_version_id: str
    extraction_id: str
    notebook_id: str
    source_title: str
    locator: EvidenceLocator
    quote: str
    quote_hash: str
    evidence_kind: Literal["pdf_text", "text", "remote_text_snapshot"]


class EvidenceCitation(BaseModel):
    citation_id: str
    kind: Literal["local_evidence", "remote_text_snapshot", "remote_unmapped"] = (
        "local_evidence"
    )
    evidence_id: str | None = None
    source_version_id: str | None = None
    source_title: str | None = None
    locator: EvidenceLocator | None = None
    quote: str = ""
    reference_validity: Literal["verified", "invalid", "out_of_scope", "unverified"]
    remote_reference: dict[str, Any] | None = None
    reason: str | None = None
