"""Explicit web discovery contracts, separate from knowledge-base search."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from open_notebook.exceptions import InvalidInputError


class WebIdempotencyConflict(InvalidInputError):
    """A durable import key was already bound to a different request."""

    def __init__(self):
        super().__init__("WEB_IDEMPOTENCY_CONFLICT")


class WebRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class WebSearchRequest(WebRequest):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=6, ge=1, le=10)

    @field_validator("query")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        if any(ord(char) < 32 for char in value):
            raise ValueError("WEB_INVALID_QUERY")
        return value


class WebTrialLimits(BaseModel):
    scope: Literal["server_ip"] = "server_ip"
    period: Literal["daily"] = "daily"
    numeric_caps_published: Literal[False] = False


class WebSearchStatus(BaseModel):
    state: Literal["ready", "configuration_required"]
    provider: Literal["firecrawl"] = "firecrawl"
    configured: bool
    access_mode: Literal["api_key", "keyless_trial"] | None = "api_key"
    trial_limits: WebTrialLimits | None = None
    automatic_paid_fallback: Literal[False] = False
    reason: str | None = None
    settings_url: str = "/settings#web-search"
    max_results: int = 10
    # Ready is local configuration, never a background probe of the account.
    externally_verified: Literal[False] = False


class WebResult(BaseModel):
    id: str
    url: str
    title: str
    snippet: str
    domain: str


class WebSearchResponse(BaseModel):
    provider: Literal["firecrawl"] = "firecrawl"
    searched_at: str
    results: list[WebResult]
    total_count: int


class WebImportRequest(WebRequest):
    url: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=500)
    snippet: str = Field(default="", max_length=2000)
    provider: Literal["firecrawl"] = "firecrawl"
    idempotency_key: str = Field(min_length=1, max_length=200)


class WebImportResponse(BaseModel):
    state: Literal["queued", "already_imported", "saved"]
    source_id: str
    source_version_id: str
    job_id: str | None = None
    url: str
    warning: str | None = None
