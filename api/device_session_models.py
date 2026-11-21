"""Pure internal records; no HTTP integration or persistent password verifier."""

from dataclasses import dataclass, field
from datetime import datetime

from open_notebook.exceptions import OpenNotebookError


class AuthError(OpenNotebookError):
    """Only fixed public messages; never include caller input/storage details."""

    def __init__(self, code: str, retry_after: int | None = None):
        self.code = code
        self.status_code = {
            "AUTH_INVALID_REQUEST": 400,
            "AUTH_INVALID_CREDENTIALS": 401,
            "AUTH_REQUIRED": 401,
            "ACCESS_EXPIRED": 401,
            "REFRESH_REJECTED": 401,
            "AUTH_RATE_LIMITED": 429,
            "AUTH_UNAVAILABLE": 503,
        }[code]
        self.retry_after = retry_after
        super().__init__(
            {
                "AUTH_INVALID_REQUEST": "Invalid authentication request.",
                "AUTH_INVALID_CREDENTIALS": "Invalid credentials.",
                "AUTH_REQUIRED": "Authentication required.",
                "ACCESS_EXPIRED": "Access expired.",
                "REFRESH_REJECTED": "Refresh rejected.",
                "AUTH_RATE_LIMITED": "Authentication rate limited.",
                "AUTH_UNAVAILABLE": "Authentication unavailable.",
            }[code]
        )


@dataclass(frozen=True)
class AuthScope:
    now: datetime
    boot_epoch: str
    credential_epoch: int


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    device_name: str
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    boot_epoch: str = field(repr=False)
    credential_epoch: int = field(repr=False)
    generation: int
    refresh_digest: str = field(repr=False)

    def in_scope(self, scope: AuthScope) -> bool:
        return (
            self.boot_epoch == scope.boot_epoch
            and self.credential_epoch == scope.credential_epoch
        )

    def live(self, scope: AuthScope) -> bool:
        return (
            self.in_scope(scope)
            and self.revoked_at is None
            and scope.now < self.expires_at
        )


@dataclass(frozen=True)
class AccessRecord:
    digest: str = field(repr=False)
    session_id: str
    issued_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class TokenEnvelope:
    session_id: str
    access_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    access_expires_at: datetime
    refresh_expires_at: datetime


@dataclass(frozen=True)
class SessionMetadata:
    session_id: str
    device_name: str
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    is_current: bool
