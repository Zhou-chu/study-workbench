"""Async persistence contract for a future, separately verified Surreal adapter.

All returns require acknowledged commit; errors/unknown commits MUST raise and
MUST NOT retry automatically. Bind all DB parameters. No plaintext credentials
cross this boundary. Single API process is mandatory, but the process lock is
NOT a replacement for the transactions specified below. No DB adapter here.
"""

from datetime import datetime
from typing import Protocol

from api.device_session_models import AccessRecord, AuthScope, SessionRecord


class DeviceSessionStore(Protocol):
    async def create_atomic(
        self,
        session: SessionRecord,
        access: AccessRecord,
        scope: AuthScope,
        live_limit: int,
    ) -> bool:
        """One transaction: count live scope sessions; if below cap insert both.

        False only for cap reached, with no writes. Enforce unique session ID,
        refresh digest and access digest; collisions raise (never overwrite).
        """
        ...

    async def get_session(self, session_id: str) -> SessionRecord | None: ...

    async def get_access(
        self, digest: str
    ) -> tuple[AccessRecord | None, SessionRecord | None]:
        """Authoritative consistent read of access and referenced session."""
        ...

    async def advance_last_used(
        self, session_id: str, scope: AuthScope
    ) -> SessionRecord | None:
        """Atomic live-scope conditional update and return acknowledged row.

        Predicate includes ID, epochs, non-revocation and expiry > scope.now.
        Return None for no live match. Advance to max(last_used_at, scope.now)
        only when >=60s since stored last_used_at; never change other fields.
        The service checks authoritative access/session on EVERY request;
        throttling concerns metadata writes only, not authorization caching.
        """
        ...

    async def rotate_atomic(
        self,
        expected: SessionRecord,
        replacement: SessionRecord,
        access: AccessRecord,
        scope: AuthScope,
    ) -> bool:
        """One transaction CAS + insert, or zero writes on False.

        Predicate MUST include ID, generation, refresh digest, boot/credential
        epochs, non-revocation and absolute expiry > scope.now. Exactly one
        match required. Preserve immutable ID/name/creation/deadline/epochs;
        increment generation once, replace refresh digest, update last-used,
        insert new access only on CAS success. Preserve old live access rows.
        Unique digest collision or unrecognized result shape raises. Never
        interpret ambiguous commit/partial results as acknowledged success.
        """
        ...

    async def revoke_one(self, session_id: str, now: datetime) -> None:
        """Atomic idempotent non-null revocation, never clear existing value."""
        ...

    async def revoke_all(self, now: datetime) -> None:
        """One atomic commit revoking ALL existing rows, including old epochs."""
        ...

    async def list_sessions(self, scope: AuthScope) -> list[SessionRecord]:
        """Current epochs, expiry > now, including retained revoked sessions."""
        ...

    async def prune_access(self, now: datetime) -> None:
        """Delete only access rows with expiry <= now; bounded by refresh caps.

        May remove expired-token recognition; never delete live overlap rows.
        Called before successful issuance attempts. Retention/cleanup of old
        session rows is an adapter maintenance policy, not authorization.
        """
        ...
