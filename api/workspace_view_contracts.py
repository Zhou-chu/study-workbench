"""Allowlisted read-only SPA views; never persistence or write DTOs.

Optional defaults are excluded on the wire. A projection_status marker blocks
recovery and writes. Its absence only means shape-known, never replay authority.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PublicView(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    projection_status: Literal["unknown", "invalid"] | None = None


class NonActionableValue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    projection_status: Literal["unknown", "invalid"]


class KnownDispatchReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    dispatch_ack: Literal["unknown"]
    job_id: str = Field(min_length=1)
    turn_id: str = Field(min_length=1)
    retry_safe: Literal[False]

    @field_validator("retry_safe", mode="before")
    @classmethod
    def exact_false(cls, value: object) -> object:
        if value is not False:
            raise ValueError("retry_safe must be the exact boolean false")
        return value


class ValidDispatchReceiptView(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    validity: Literal["valid"]
    receipt: KnownDispatchReceipt


class NonActionableDispatchReceiptView(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    validity: Literal["unknown", "invalid"]


DispatchReceiptView = ValidDispatchReceiptView | NonActionableDispatchReceiptView


class MappingView(PublicView):
    source_link_id: str | None | NonActionableValue = None
    remote_source_id: str | None | NonActionableValue = None
    source_version_id: str | None | NonActionableValue = None
    mapping_method: str | None | NonActionableValue = None
    last_checked_at: str | None | NonActionableValue = None


class ScopeView(PublicView):
    engine: str | None | NonActionableValue = None
    selection_origin: str | None | NonActionableValue = None
    source_version_ids: list[str] | None | NonActionableValue = None
    remote_source_ids: list[str] | None | NonActionableValue = None
    remote_notebook_id: str | None | NonActionableValue = None
    scope_hash: str | None | NonActionableValue = None
    mappings: list[MappingView | NonActionableValue] | None | NonActionableValue = None

    mapping_version: int | None | NonActionableValue = None


class LocatorView(PublicView):
    page_index: int | None | NonActionableValue = None
    page_label: str | None | NonActionableValue = None
    block_id: str | None | NonActionableValue = None
    start_offset: int | None | NonActionableValue = None
    end_offset: int | None | NonActionableValue = None
    bbox: list[float] | None | NonActionableValue = None


class RemoteReferenceView(PublicView):
    remote_source_id: str | None | NonActionableValue = None
    quote: str | None | NonActionableValue = None
    citation_number: int | None | NonActionableValue = None
    url: str | None | NonActionableValue = None


class EvidenceCitationView(PublicView):
    citation_id: str | None | NonActionableValue = None
    kind: str | None | NonActionableValue = None
    quote: str | None | NonActionableValue = None
    reference_validity: str | None | NonActionableValue = None
    source_version_id: str | None | NonActionableValue = None
    evidence_id: str | None | NonActionableValue = None
    source_title: str | None | NonActionableValue = None
    independent_support: bool | None | NonActionableValue = None
    remote_reference: RemoteReferenceView | None | NonActionableValue = None
    locator: LocatorView | None | NonActionableValue = None
    provenance: ProvenanceView | None | NonActionableValue = None
    reason: str | None | NonActionableValue = None


class ProvenanceView(PublicView):
    kind: str | None | NonActionableValue = None
    origin_kind: str | None | NonActionableValue = None
    origin_id: str | None | NonActionableValue = None
    note_revision: int | None | NonActionableValue = None
    origin_title: str | None | NonActionableValue = None
    authorship: str | None | NonActionableValue = None
    captured_at: str | None | NonActionableValue = None
    content_sha256: str | None | NonActionableValue = None
    scope_snapshot: ScopeView | None | NonActionableValue = None
    citations: (
        list[EvidenceCitationView | NonActionableValue] | None | NonActionableValue
    ) = None
    source_url: str | None | NonActionableValue = None
    historical_url_omitted: bool | None | NonActionableValue = None
    retrieved_at: str | None | NonActionableValue = None
    provider: str | None | NonActionableValue = None
    search_result_title: str | None | NonActionableValue = None
    search_result_snippet: str | None | NonActionableValue = None


class ReadingView(PublicView):
    source_version_id: str | None | NonActionableValue = None
    page_index: int | None | NonActionableValue = None
    evidence_id: str | None | NonActionableValue = None


class SelectionView(PublicView):
    notebook_id: str | None | NonActionableValue = None
    engine: str | None | NonActionableValue = None
    selection_origin: str | None | NonActionableValue = None
    source_version_ids: list[str] | None | NonActionableValue = None
    remote_source_ids: list[str] | None | NonActionableValue = None
    remote_notebook_id: str | None | NonActionableValue = None
    reading: ReadingView | None | NonActionableValue = None
    updated_at: str | None | NonActionableValue = None


class SourceVersionView(PublicView):
    source_version_id: str | None | NonActionableValue = None
    source_id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    title: str | None | NonActionableValue = None
    source_title: str | None | NonActionableValue = None
    origin: str | None | NonActionableValue = None
    original_status: str | None | NonActionableValue = None
    mime_type: str | None | NonActionableValue = None
    sha256: str | None | NonActionableValue = None
    byte_size: int | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None
    current_extraction_id: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    extraction_status: str | None | NonActionableValue = None
    provenance: ProvenanceView | None | NonActionableValue = None


class SourceView(PublicView):
    source_id: str | None | NonActionableValue = None
    title: str | None | NonActionableValue = None
    versions: (
        list[SourceVersionView | NonActionableValue] | None | NonActionableValue
    ) = None


class NoteView(PublicView):
    note_type: str | None | NonActionableValue = None
    id: str | None | NonActionableValue = None
    note_id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    revision: int | None | NonActionableValue = None
    title: str | None | NonActionableValue = None
    content: str | None | NonActionableValue = None
    created: str | None | NonActionableValue = None
    updated: str | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None
    updated_at: str | None | NonActionableValue = None
    citations: (
        list[EvidenceCitationView | NonActionableValue] | None | NonActionableValue
    ) = None
    scope_snapshot: ScopeView | None | NonActionableValue = None
    provenance: ProvenanceView | None | NonActionableValue = None


class RetrievalRequestView(PublicView):
    retrieval_mode: str | None | NonActionableValue = None
    embedding_profile_id: str | None | NonActionableValue = None
    acknowledge_query_processing: bool | None | NonActionableValue = None
    disclosed_profile_fingerprint: str | None | NonActionableValue = None
    destination_descriptor_version: str | None | NonActionableValue = None


class RequestSnapshotView(PublicView):
    notebook_id: str | None | NonActionableValue = None
    engine: str | None | NonActionableValue = None
    message: str | None | NonActionableValue = None
    selection_origin: str | None | NonActionableValue = None
    source_version_ids: list[str] | None | NonActionableValue = None
    remote_notebook_id: str | None | NonActionableValue = None
    remote_source_ids: list[str] | None | NonActionableValue = None
    idempotency_key: str | None | NonActionableValue = None
    model_id: str | None | NonActionableValue = None
    task: str | None | NonActionableValue = None
    retrieval_mode: str | None | NonActionableValue = None
    embedding_profile_id: str | None | NonActionableValue = None
    acknowledge_query_processing: bool | None | NonActionableValue = None
    disclosed_profile_fingerprint: str | None | NonActionableValue = None
    destination_descriptor_version: str | None | NonActionableValue = None


class RetrievalView(PublicView):
    requested_method: str | None | NonActionableValue = None
    retrieval_method: str | None | NonActionableValue = None
    fallback_reason: str | None | NonActionableValue = None
    profile_id: str | None | NonActionableValue = None
    indexed_version_count: int | None | NonActionableValue = None
    selected_version_count: int | None | NonActionableValue = None
    warnings: list[str] | None | NonActionableValue = None


class CoverageView(PublicView):
    selected_source_count: int | None | NonActionableValue = None
    retrieved_source_count: int | None | NonActionableValue = None
    evidence_count: int | None | NonActionableValue = None


class BudgetView(PublicView):
    context_tokens: int | None | NonActionableValue = None
    output_tokens: int | None | NonActionableValue = None
    estimated_input_tokens: int | None | NonActionableValue = None
    estimator: str | None | NonActionableValue = None
    retrieved_evidence_count: int | None | NonActionableValue = None
    included_evidence_count: int | None | NonActionableValue = None


class TurnView(PublicView):
    turn_id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    chat_session_id: str | None | NonActionableValue = None
    engine: str | None | NonActionableValue = None
    message: str | None | NonActionableValue = None
    idempotency_key: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    state: str | None | NonActionableValue = None
    generation_status: str | None | NonActionableValue = None
    answer: str | None | NonActionableValue = None
    scope_snapshot: ScopeView | None | NonActionableValue = None
    citations: (
        list[EvidenceCitationView | NonActionableValue] | None | NonActionableValue
    ) = None
    retrieval_request: RetrievalRequestView | None | NonActionableValue = None
    retrieval: RetrievalView | None | NonActionableValue = None
    coverage: CoverageView | None | NonActionableValue = None
    warnings: list[str] | None | NonActionableValue = None
    evidence_ids: list[str] | None | NonActionableValue = None
    job_id: str | None | NonActionableValue = None
    conversation_id: str | None | NonActionableValue = None
    connector_version: str | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None
    completed_at: str | None | NonActionableValue = None
    error: NonActionableValue | None | NonActionableValue = None

    scope_hash: str | None | NonActionableValue = None
    grounding_status: str | None | NonActionableValue = None
    model_id: str | None | NonActionableValue = None
    pipeline_version: str | None | NonActionableValue = None
    budget: BudgetView | None | NonActionableValue = None


class ArtifactView(PublicView):
    artifact_id: str | None | NonActionableValue = None
    id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    remote_artifact_id: str | None | NonActionableValue = None
    title: str | None | NonActionableValue = None
    kind: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    mime_type: str | None | NonActionableValue = None
    byte_size: int | None | NonActionableValue = None
    sha256: str | None | NonActionableValue = None
    remote_source_ids: list[str] | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None


class SourceResultView(PublicView):
    source_id: str | None | NonActionableValue = None
    source_version_id: str | None | NonActionableValue = None
    job_id: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    existing: bool | None | NonActionableValue = None
    embedding_status: str | None | NonActionableValue = None
    provenance: ProvenanceView | None | NonActionableValue = None


class MaintenanceResultView(PublicView):
    source_version_id: str | None | NonActionableValue = None
    extraction_id: str | None | NonActionableValue = None
    fresh_extraction_id: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    evidence_count: int | None | NonActionableValue = None
    checked_count: int | None | NonActionableValue = None
    verified_count: int | None | NonActionableValue = None
    unverified_count: int | None | NonActionableValue = None


class ArtifactResultView(PublicView):
    remote_artifact_id: str | None | NonActionableValue = None
    artifact: ArtifactView | None | NonActionableValue = None
    downloaded: bool | None | NonActionableValue = None
    download_error: NonActionableValue | None | NonActionableValue = None


class RemoteNotebookResultView(PublicView):
    remote_notebook_id: str | None | NonActionableValue = None


class JobView(PublicView):
    operation: str | None | NonActionableValue = None
    job_id: str | None | NonActionableValue = None
    turn_id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    chat_session_id: str | None | NonActionableValue = None
    idempotency_key: str | None | NonActionableValue = None
    state: str | None | NonActionableValue = None
    status: str | None | NonActionableValue = None
    submission_state: str | None | NonActionableValue = None
    restored_history: bool | None | NonActionableValue = None
    replay_allowed: bool | None | NonActionableValue = None
    dispatch_receipt: DispatchReceiptView | None | NonActionableValue = None
    request_snapshot: RequestSnapshotView | None | NonActionableValue = None
    result: (
        TurnView
        | SourceResultView
        | MaintenanceResultView
        | ArtifactResultView
        | RemoteNotebookResultView
        | None
        | NonActionableValue
    ) = None
    source_id: str | None | NonActionableValue = None
    source_version_id: str | None | NonActionableValue = None
    extraction_id: str | None | NonActionableValue = None
    provider: str | None | NonActionableValue = None
    remote_task_id: str | None | NonActionableValue = None
    attempts: int | None | NonActionableValue = None
    poll_attempts: int | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None
    updated_at: str | None | NonActionableValue = None
    started_at: str | None | NonActionableValue = None
    completed_at: str | None | NonActionableValue = None
    next_poll_at: str | None | NonActionableValue = None
    next_dispatch_at: str | None | NonActionableValue = None
    cancel_requested: bool | None | NonActionableValue = None
    remote_may_continue: bool | None | NonActionableValue = None
    error: NonActionableValue | None | NonActionableValue = None


class NotebookView(PublicView):
    id: str | None | NonActionableValue = None
    name: str | None | NonActionableValue = None


class LinkView(PublicView):
    remote_notebook_id: str | None | NonActionableValue = None
    connection_id: str | None | NonActionableValue = None


class LegacyMessageView(PublicView):
    id: str | None | NonActionableValue = None
    type: str | None | NonActionableValue = None
    timestamp: str | None | NonActionableValue = None
    role: str | None | NonActionableValue = None
    content: str | None | NonActionableValue = None


class LegacyHistoryView(PublicView):
    chat_session_id: str | None | NonActionableValue = None
    notebook_id: str | None | NonActionableValue = None
    history_origin: str | None | NonActionableValue = None
    messages: (
        list[LegacyMessageView | NonActionableValue] | None | NonActionableValue
    ) = None
    restored_history: bool | None | NonActionableValue = None
    replay_allowed: bool | None | NonActionableValue = None
    created_at: str | None | NonActionableValue = None


class WorkspaceViewV1(PublicView):
    schema_version: Literal["workspace-view-v1"] = "workspace-view-v1"
    notebook: NotebookView
    sources: list[SourceView | NonActionableValue]
    notes: list[NoteView | NonActionableValue]
    turns: list[TurnView | NonActionableValue]
    jobs: list[JobView | NonActionableValue]
    selection: SelectionView | None | NonActionableValue
    link: LinkView | None | NonActionableValue
    legacy_history: list[LegacyHistoryView | NonActionableValue]


class PortableLimitsPublic(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    max_archive_bytes: int
    max_expanded_bytes: int
    max_entity_bytes: int
    max_manifest_bytes: int
    max_request_bytes: int
    multipart_overhead_bytes: int
    max_entries: int
    max_compression_ratio: int


class ClientLimitsV1(BaseModel):
    source_upload_max_bytes: int
    portable: PortableLimitsPublic


class ClientCapabilitiesV1(BaseModel):
    contract_version: Literal["client-capabilities-v1"] = "client-capabilities-v1"
    supported_contracts: list[Literal["workspace-view-v1"]]
    limits: ClientLimitsV1


# Resolve reviewed recursive lineage without widening it to arbitrary JSON.
MappingView.model_rebuild()
ScopeView.model_rebuild()
LocatorView.model_rebuild()
RemoteReferenceView.model_rebuild()
EvidenceCitationView.model_rebuild()
ProvenanceView.model_rebuild()
ReadingView.model_rebuild()
SelectionView.model_rebuild()
SourceVersionView.model_rebuild()
SourceView.model_rebuild()
NoteView.model_rebuild()
RetrievalRequestView.model_rebuild()
RequestSnapshotView.model_rebuild()
RetrievalView.model_rebuild()
CoverageView.model_rebuild()
TurnView.model_rebuild()
ArtifactView.model_rebuild()
SourceResultView.model_rebuild()
MaintenanceResultView.model_rebuild()
ArtifactResultView.model_rebuild()
RemoteNotebookResultView.model_rebuild()
JobView.model_rebuild()
NotebookView.model_rebuild()
LinkView.model_rebuild()
LegacyMessageView.model_rebuild()
LegacyHistoryView.model_rebuild()
