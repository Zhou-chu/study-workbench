"""Single-process strict one-use device sessions, deliberately not activated.

Hold the state lock only for auth/storage work. Authenticated resource work and
existing streams are outside it: revocation cannot undo prior authorization.
"""

import asyncio
import base64
import hashlib
import hmac
import math
import re
import secrets
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from uuid import UUID

from api.device_session_credentials import MAX_PASSWORD_BYTES, StrictPasswordProvider
from api.device_session_models import (
    AccessRecord,
    AuthError,
    AuthScope,
    SessionMetadata,
    SessionRecord,
    TokenEnvelope,
)
from api.device_session_store import DeviceSessionStore


class DeviceSessionService:
    def __init__(
        self,
        store: DeviceSessionStore,
        credentials: StrictPasswordProvider,
        *,
        clock: Callable[[], datetime] | None = None,
        random_bytes: Callable[[int], bytes] = secrets.token_bytes,
    ):
        self._store = store
        self._credentials = credentials
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._random = random_bytes
        self._boot_epoch = self._random(32).hex()
        self._credential_epoch = 0
        self._observed: str | None = None
        self._barrier_pending = False
        self._lock = asyncio.Lock()
        # Store only failed attempts; serialized checking avoids reservations.
        # Global windows bound address/session buckets to 30/120, respectively.
        self._login_failures: dict[str, list[datetime]] = {}
        self._refresh_attempts: dict[str, list[datetime]] = {}

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise AuthError("AUTH_UNAVAILABLE")
        return now.astimezone(timezone.utc)

    async def _observe(self) -> AuthScope:
        now = self._now()
        try:
            password = await self._credentials.read()
        except AuthError:
            self._credential_epoch += 1
            self._observed = None
            self._barrier_pending = True
            await self._store.revoke_all(now)
            self._barrier_pending = False
            raise
        if self._observed is None or not hmac.compare_digest(
            password.encode(), self._observed.encode()
        ):
            self._credential_epoch += 1
            # Record observed value before I/O so a failed barrier is retried,
            # not forgotten; old epochs remain invalid even on unknown commit.
            self._observed = password
            self._barrier_pending = True
        if self._barrier_pending:
            await self._store.revoke_all(now)
            self._barrier_pending = False
        # Read clock after potentially slow credential/storage operations.
        return AuthScope(self._now(), self._boot_epoch, self._credential_epoch)

    @asynccontextmanager
    async def _operation(self):
        async with self._lock:
            try:
                yield await self._observe()
            except AuthError:
                raise
            except Exception:
                # No raw DB exceptions/credentials in public errors; no retry.
                raise AuthError("AUTH_UNAVAILABLE") from None

    @staticmethod
    def _digest(token: str, prefix: str) -> str:
        if not isinstance(token, str) or not re.fullmatch(
            re.escape(prefix) + r"[A-Za-z0-9_-]{43}", token
        ):
            raise AuthError("AUTH_INVALID_REQUEST")
        # Reject noncanonical base64 aliases as malformed, not unknown tokens.
        raw = base64.urlsafe_b64decode(token[len(prefix) :] + "=")
        if base64.urlsafe_b64encode(raw).decode().rstrip("=") != token[len(prefix) :]:
            raise AuthError("AUTH_INVALID_REQUEST")
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    @staticmethod
    def _session_id(value: str) -> str:
        try:
            if not isinstance(value, str) or str(UUID(value)) != value:
                raise ValueError
            return value
        except (ValueError, AttributeError):
            raise AuthError("AUTH_INVALID_REQUEST") from None

    def _token(self, prefix: str) -> str:
        value = self._random(32)
        if len(value) != 32:
            raise AuthError("AUTH_UNAVAILABLE")
        return prefix + base64.urlsafe_b64encode(value).decode().rstrip("=")

    @staticmethod
    def _limit(
        buckets: dict[str, list[datetime]],
        key: str,
        now: datetime,
        local: int,
        global_limit: int,
    ) -> None:
        cutoff = now - timedelta(seconds=60)
        for existing in list(buckets):
            buckets[existing] = [t for t in buckets[existing] if t > cutoff]
            if not buckets[existing]:
                del buckets[existing]
        all_times = [t for times in buckets.values() for t in times]
        times = buckets.get(key, [])
        deadlines = []
        if len(times) >= local:
            deadlines.append(min(times) + timedelta(seconds=60))
        if len(all_times) >= global_limit:
            deadlines.append(min(all_times) + timedelta(seconds=60))
        if deadlines:
            raise AuthError(
                "AUTH_RATE_LIMITED",
                max(1, math.ceil((max(deadlines) - now).total_seconds())),
            )

    def _issue(
        self, session_id: str, scope: AuthScope, deadline: datetime
    ) -> tuple[TokenEnvelope, AccessRecord, str]:
        access = self._token("swa1_")
        refresh = self._token("swr1_")
        expiry = min(scope.now + timedelta(minutes=15), deadline)
        envelope = TokenEnvelope(session_id, access, refresh, expiry, deadline)
        row = AccessRecord(self._digest(access, "swa1_"), session_id, scope.now, expiry)
        return envelope, row, self._digest(refresh, "swr1_")

    async def create_session(
        self, password: str, device_name: str, *, client_address: str = "shared-peer"
    ) -> TokenEnvelope:
        # Caller must supply trusted socket peer only, NEVER arbitrary XFF.
        try:
            valid = (
                isinstance(password, str)
                and len(password.encode("utf-8")) <= MAX_PASSWORD_BYTES
            )
            valid = (
                valid
                and isinstance(device_name, str)
                and 1 <= len(device_name.strip()) <= 80
                and bool(device_name.encode("utf-8"))
            )
            valid = (
                valid
                and isinstance(client_address, str)
                and 1 <= len(client_address) <= 256
            )
        except UnicodeError:
            valid = False
        if not valid:
            raise AuthError("AUTH_INVALID_REQUEST")
        async with self._operation() as scope:
            self._limit(self._login_failures, client_address, scope.now, 5, 30)
            assert self._observed is not None  # _operation completed observation.
            if not hmac.compare_digest(
                password.encode("utf-8"), self._observed.encode("utf-8")
            ):
                self._login_failures.setdefault(client_address, []).append(scope.now)
                raise AuthError("AUTH_INVALID_CREDENTIALS")
            sid = str(UUID(bytes=self._random(16), version=4))
            envelope, access, digest = self._issue(
                sid, scope, scope.now + timedelta(days=30)
            )
            session = SessionRecord(
                sid,
                device_name.strip(),
                scope.now,
                scope.now,
                envelope.refresh_expires_at,
                None,
                scope.boot_epoch,
                scope.credential_epoch,
                0,
                digest,
            )
            await self._store.prune_access(scope.now)
            if not await self._store.create_atomic(session, access, scope, 32):
                raise AuthError("AUTH_RATE_LIMITED", 60)
            return envelope

    async def _authenticate(self, token: str, scope: AuthScope) -> SessionRecord:
        digest = self._digest(token, "swa1_")
        access, session = await self._store.get_access(digest)
        if access is None or session is None or not session.live(scope):
            raise AuthError("AUTH_REQUIRED")
        if access.session_id != session.session_id or not hmac.compare_digest(
            digest, access.digest
        ):
            raise AuthError("AUTH_REQUIRED")
        if scope.now >= access.expires_at:
            raise AuthError("ACCESS_EXPIRED")
        # No positive-auth cache: authoritative reads above happen each time.
        # Device metadata may lag resource use by at most 60 seconds.
        if scope.now - session.last_used_at >= timedelta(seconds=60):
            session = await self._store.advance_last_used(session.session_id, scope)
            if session is None or not session.live(scope):
                raise AuthError("AUTH_REQUIRED")
        return session

    async def authenticate_access(self, token: str) -> SessionRecord:
        async with self._operation() as scope:
            return await self._authenticate(token, scope)

    async def rotate_session(
        self, session_id: str, refresh_token: str
    ) -> TokenEnvelope:
        sid = self._session_id(session_id)
        digest = self._digest(refresh_token, "swr1_")
        async with self._operation() as scope:
            self._limit(self._refresh_attempts, sid, scope.now, 10, 120)
            self._refresh_attempts.setdefault(sid, []).append(scope.now)
            current = await self._store.get_session(sid)
            if (
                current is None
                or not current.live(scope)
                or not hmac.compare_digest(current.refresh_digest, digest)
            ):
                raise AuthError("REFRESH_REJECTED")
            envelope, access, successor = self._issue(sid, scope, current.expires_at)
            replacement = replace(
                current,
                generation=current.generation + 1,
                refresh_digest=successor,
                last_used_at=scope.now,
            )
            await self._store.prune_access(scope.now)
            if not await self._store.rotate_atomic(current, replacement, access, scope):
                raise AuthError("REFRESH_REJECTED")
            return envelope

    async def list_sessions(self, access_token: str) -> list[SessionMetadata]:
        async with self._operation() as scope:
            current = await self._authenticate(access_token, scope)
            sessions = await self._store.list_sessions(scope)
            return [
                SessionMetadata(
                    s.session_id,
                    s.device_name,
                    s.created_at,
                    s.last_used_at,
                    s.expires_at,
                    s.revoked_at,
                    s.session_id == current.session_id,
                )
                for s in sorted(sessions, key=lambda s: (s.created_at, s.session_id))
                if s.in_scope(scope) and s.expires_at > scope.now
            ]

    async def revoke_session(self, access_token: str, session_id: str) -> None:
        sid = self._session_id(session_id)
        async with self._operation() as scope:
            await self._authenticate(access_token, scope)
            await self._store.revoke_one(sid, scope.now)

    async def revoke_all_sessions(self, access_token: str) -> None:
        async with self._operation() as scope:
            await self._authenticate(access_token, scope)
            await self._store.revoke_all(scope.now)
