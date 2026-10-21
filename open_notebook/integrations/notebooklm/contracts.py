"""Application-owned NotebookLM types; no SDK types escape this boundary."""

from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from open_notebook.exceptions import ExternalServiceError

SDK_VERSION = "0.8.5"
ADAPTER_VERSION = "1"


class BridgeError(ExternalServiceError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        submission_state: str = "not_submitted",
        remote_id: str | None = None,
    ):
        self.code = code
        self.submission_state = submission_state
        self.remote_id = remote_id
        super().__init__(message)


class ConnectionStatus(BaseModel):
    state: Literal[
        "disconnected",
        "awaiting_user_login",
        "verifying",
        "connected",
        "needs_reauth",
        "unavailable",
    ] = "disconnected"
    account_label: str | None = None
    last_verified_at: str | None = None
    reason: str | None = None
    quota: int | None = None


class Capability(BaseModel):
    name: str
    support: Literal[
        "available", "unsupported", "temporarily_unavailable", "unverified"
    ] = "unverified"
    last_verified_at: str | None = None
    sdk_version: str = SDK_VERSION
    adapter_version: str = ADAPTER_VERSION
    reason: str | None = None


class CapabilityMatrix(BaseModel):
    sdk_version: str = SDK_VERSION
    adapter_version: str = ADAPTER_VERSION
    operations: list[Capability]


class RemoteNotebook(BaseModel):
    id: str
    title: str


class NotebookPage(BaseModel):
    items: list[RemoteNotebook]
    next_cursor: str | None = None
    listing_complete: bool = False
    completeness_note: str | None = None


class RemoteSource(BaseModel):
    id: str
    title: str
    status: str
    original_available: bool = False
    revision_id: str | None = None


class RemoteSourcePage(BaseModel):
    items: list[RemoteSource]
    next_cursor: str | None = None
    listing_complete: bool = True
    completeness_note: str | None = None


class CreateNotebookRequest(BaseModel):
    title: str


class UploadSourceRequest(BaseModel):
    remote_notebook_id: str
    source_version_id: str
    file_path: str
    mime_type: str
    title: str


class FetchTextRequest(BaseModel):
    remote_notebook_id: str
    remote_source_id: str


class RemoteTextResult(BaseModel):
    remote_source_id: str
    title: str
    content: str
    completeness: str = "remote_extracted_text"
    original_status: str = "missing"


class SubmissionResult(BaseModel):
    remote_id: str
    submission_state: Literal["confirmed"] = "confirmed"
    status: str = "processing"


class BridgeAskRequest(BaseModel):
    remote_notebook_id: str
    message: str
    remote_source_ids: list[str] = Field(min_length=1)
    conversation_id: str | None = None
    scope_hash: str


class RemoteReference(BaseModel):
    remote_source_id: str
    quote: str | None = None
    citation_number: int | None = None


class BridgeAnswer(BaseModel):
    answer: str
    conversation_id: str
    references: list[RemoteReference] = Field(default_factory=list)
    usage: dict[str, Any] | None = None


class AudioRequest(BaseModel):
    remote_notebook_id: str
    remote_source_ids: list[str] = Field(min_length=1)
    language: str = "zh"


class RemoteArtifact(BaseModel):
    id: str
    title: str = ""
    kind: str = "audio"
    status: str
    remote_source_ids: list[str] = Field(default_factory=list)


class DownloadRequest(BaseModel):
    remote_notebook_id: str
    remote_artifact_id: str
    output_path: str
    max_bytes: int = 200 * 1024 * 1024


class DownloadedAsset(BaseModel):
    path: str
    mime_type: str
    byte_size: int
    sha256: str


class NotebookLMBridge(Protocol):
    async def verify_connection(self) -> ConnectionStatus: ...
    async def capabilities(self) -> CapabilityMatrix: ...
    async def list_notebooks(self, cursor: str | None = None) -> NotebookPage: ...
    async def list_sources(
        self, remote_notebook_id: str, cursor: str | None = None
    ) -> RemoteSourcePage: ...
    async def create_notebook(
        self, request: CreateNotebookRequest
    ) -> SubmissionResult: ...
    async def upload_source(self, request: UploadSourceRequest) -> SubmissionResult: ...
    async def fetch_source_text(
        self, request: FetchTextRequest
    ) -> RemoteTextResult: ...
    async def ask(self, request: BridgeAskRequest) -> BridgeAnswer: ...
    async def list_artifacts(self, remote_notebook_id: str) -> list[RemoteArtifact]: ...
    async def generate_audio(self, request: AudioRequest) -> SubmissionResult: ...
    async def get_artifact(
        self, remote_notebook_id: str, remote_task_id: str
    ) -> RemoteArtifact: ...
    async def download_artifact(self, request: DownloadRequest) -> DownloadedAsset: ...
