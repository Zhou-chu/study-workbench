"""Immutable hybrid-retrieval identities; constructing them performs no I/O.

Deployment revisions are operator assertions, not proof against silent upstream
alias/weight changes. Rotate the profile deliberately when that identity changes.
"""

import hashlib
import json
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    field_validator,
    model_validator,
)

Nonempty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


def sanitized_endpoint(value: str) -> str:
    """Canonical transport URL with an unambiguous, explicitly ASCII authority.

    IDNA2003 and HTTPX's IDNA2008 do not identify the same hosts. Require an
    operator-supplied ASCII A-label rather than silently remapping consent.
    """
    if any(ord(char) <= 32 or ord(char) == 127 for char in value):
        raise ValueError("Embedding endpoints must not contain whitespace or controls")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("An explicit HTTP(S) embedding endpoint is required")
    if not parsed.hostname.isascii() or "%" in parsed.hostname or "\\" in parsed.netloc:
        raise ValueError("An unambiguous ASCII embedding authority is required")
    hostname = parsed.hostname.lower()
    host = f"[{hostname}]" if ":" in hostname else hostname
    port = parsed.port
    if port is not None and (parsed.scheme, port) not in {("http", 80), ("https", 443)}:
        host += f":{port}"
    public_url = urlunsplit((parsed.scheme.lower(), host, parsed.path, "", ""))
    try:
        return str(httpx.URL(public_url)).rstrip("/")
    except httpx.InvalidURL:
        raise ValueError("An unambiguous embedding endpoint is required") from None


class FrozenContract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class EmbeddingProfile(FrozenContract):
    profile_id: Nonempty
    model_id: Nonempty
    provider: Nonempty
    model_name: Nonempty
    revision: Nonempty
    endpoint: Nonempty
    credential_binding_id: Nonempty
    dimension: int = Field(strict=True, ge=1, le=4096)
    document_prefix: str
    query_prefix: str
    preprocessing_revision: Literal["evidence-identity-v1"]
    max_input_bytes: int = Field(strict=True, gt=0)
    cosine_min_score: float = Field(strict=True, ge=-1, le=1)
    destination_descriptor_version: Nonempty
    # An operator descriptor, never inferred from a provider name or loopback URL.
    destination_kind: Literal["on_device", "remote", "unknown"] = "unknown"

    @field_validator("endpoint")
    @classmethod
    def sanitize_destination(cls, value: str) -> str:
        return sanitized_endpoint(value)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def endpoint_fingerprint(self) -> str:
        return hashlib.sha256(self.endpoint.encode("utf-8")).hexdigest()

    @computed_field  # type: ignore[prop-decorator]
    @property
    def fingerprint(self) -> str:
        # Explicit fields only: no keys, mutable defaults or computed recursion.
        identity = {name: getattr(self, name) for name in type(self).model_fields}
        serialized = json.dumps(
            identity, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    @property
    def configuration_fingerprint(self) -> str:
        return self.fingerprint


class QueryEmbeddingDisclosure(FrozenContract):
    disclosed_profile_fingerprint: Nonempty
    destination_descriptor_version: Nonempty
    acknowledge_query_processing: bool = Field(strict=True)


class ScopeEntry(FrozenContract):
    version_id: Nonempty
    extraction_id: Nonempty
    manifest_hash: Digest
    scope_epoch: int = Field(strict=True, ge=0)


class ScopeSnapshot(FrozenContract):
    notebook_id: Nonempty
    entries: tuple[ScopeEntry, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def sort_unique_versions(self) -> "ScopeSnapshot":
        if len({entry.version_id for entry in self.entries}) != len(self.entries):
            raise ValueError("Scope versions must be unique")
        object.__setattr__(
            self,
            "entries",
            tuple(sorted(self.entries, key=lambda entry: entry.version_id)),
        )
        return self


class RetrievalMetadata(FrozenContract):
    requested_method: Literal["lexical", "hybrid"]
    retrieval_method: Literal["lexical", "hybrid", "lexical_fallback"]
    fallback_reason: str | None = None
    profile_id: str | None = None
    indexed_version_count: int = Field(default=0, ge=0)
    selected_version_count: int = Field(ge=0)
    warnings: tuple[str, ...] = ()


class RetrievalResult(RetrievalMetadata):
    hits: list[dict[str, Any]]


class EvidenceSearchResponse(FrozenContract):
    """Wire envelope; absent metadata preserves the legacy hits-only response."""

    hits: list[dict[str, Any]]
    retrieval: RetrievalMetadata | None = None


class IndexPreview(FrozenContract):
    snapshot: ScopeSnapshot
    profile: EmbeddingProfile
    preview_hash: Digest
    evidence_count: int = Field(ge=0, le=5000)
    input_bytes: int = Field(ge=0)
    warnings: tuple[str, ...] = ()


class IndexJobStatus(FrozenContract):
    job_id: Nonempty
    source_version_id: Nonempty | None
    state: str
    stage: str
    completed_evidence: int = Field(ge=0)
    total_evidence: int = Field(ge=0)
    error: dict[str, str] | None = None
    retry_safe: Literal[False] = False
    remote_cancel_confirmed: Literal[False] = False


class IndexReceipt(FrozenContract):
    group_id: Nonempty
    notebook_id: Nonempty
    profile_id: Nonempty
    jobs: tuple[IndexJobStatus, ...]
    profile_fingerprint: Digest
    preview_hash: Digest
    job_ids: tuple[Nonempty, ...]
    state: Literal[
        "queued",
        "running",
        "succeeded",
        "failed",
        "submission_unknown",
        "cancelled_local",
    ]
    retry_safe: Literal[False] = False
    remote_cancel_confirmed: Literal[False] = False
