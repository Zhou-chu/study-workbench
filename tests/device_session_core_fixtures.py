"""Synthetic in-memory store, deterministic clock and async event gates only."""

import asyncio
import hashlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from api.device_session_credentials import StrictPasswordProvider
from api.device_session_models import AuthError
from api.device_session_service import DeviceSessionService


class MemoryStore:
    def __init__(self):
        self.sessions = {}
        self.access = {}
        self.fail = False
        self.unknown_commit = False
        self.rotation_calls = 0

    def check(self):
        if self.fail:
            raise RuntimeError("sensitive storage detail")

    async def prune_access(self, now):
        self.check()
        self.access = {k: v for k, v in self.access.items() if v.expires_at > now}

    async def create_atomic(self, session, access, scope, live_limit):
        self.check()
        if sum(s.live(scope) for s in self.sessions.values()) >= live_limit:
            return False
        assert session.session_id not in self.sessions
        assert access.digest not in self.access
        self.sessions[session.session_id] = session
        self.access[access.digest] = access
        if self.unknown_commit:
            raise RuntimeError("unknown commit with secret")
        return True

    async def get_session(self, session_id):
        self.check()
        return self.sessions.get(session_id)

    async def get_access(self, digest):
        self.check()
        access = self.access.get(digest)
        return (
            (access, self.sessions.get(access.session_id)) if access else (None, None)
        )

    async def advance_last_used(self, session_id, scope):
        self.check()
        current = self.sessions.get(session_id)
        if current is None or not current.live(scope):
            return None
        if scope.now - current.last_used_at >= timedelta(seconds=60):
            current = replace(current, last_used_at=scope.now)
            self.sessions[session_id] = current
        return current

    async def rotate_atomic(self, expected, replacement, access, scope):
        self.check()
        self.rotation_calls += 1
        current = self.sessions.get(expected.session_id)
        if current != expected or not current.live(scope):
            return False
        self.sessions[current.session_id] = replacement
        self.access[access.digest] = access
        if self.unknown_commit:
            raise RuntimeError("unknown commit with secret")
        return True

    async def revoke_one(self, session_id, now):
        self.check()
        s = self.sessions.get(session_id)
        if s and s.revoked_at is None:
            self.sessions[session_id] = replace(s, revoked_at=now)

    async def revoke_all(self, now):
        self.check()
        for sid in list(self.sessions):
            await self.revoke_one(sid, now)

    async def list_sessions(self, scope):
        self.check()
        return [
            s
            for s in self.sessions.values()
            if s.in_scope(scope) and s.expires_at > scope.now
        ]


class Clock:
    def __init__(self):
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


class Random:
    def __init__(self):
        self.i = 0

    def __call__(self, n):
        self.i += 1
        return hashlib.sha256(str(self.i).encode()).digest()[:n]


def setup(provider=None, store=None):
    clock = Clock()
    store = store or MemoryStore()
    service = DeviceSessionService(
        store,
        provider or StrictPasswordProvider(password="synthetic"),
        clock=clock,
        random_bytes=Random(),
    )
    return service, store, clock


async def error(code, coro):
    with pytest.raises(AuthError) as caught:
        await coro
    assert caught.value.code == code
    assert "synthetic" not in str(caught.value)
    assert "secret" not in str(caught.value)
    return caught.value


class OperationGate:
    """One-shot deterministic suspension, armed after fixture login/barrier."""

    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.operation = None

    async def pause(self, operation):
        if self.operation == operation:
            self.operation = None
            self.entered.set()
            await self.release.wait()


class ObservedCredentials(StrictPasswordProvider):
    def __init__(self, gate):
        super().__init__(password="synthetic")
        self.gate = gate
        self.observations = 0
        self.current = "synthetic"

    async def read(self):
        self.observations += 1
        await self.gate.pause("credential")
        return self.current


class SuspendedStore(MemoryStore):
    def __init__(self, gate):
        super().__init__()
        self.gate = gate

    async def create_atomic(self, session, access, scope, live_limit):
        await self.gate.pause("create")
        return await super().create_atomic(session, access, scope, live_limit)

    async def rotate_atomic(self, expected, replacement, access, scope):
        await self.gate.pause("rotate")
        return await super().rotate_atomic(expected, replacement, access, scope)

    async def revoke_one(self, session_id, now):
        await self.gate.pause("revoke")
        return await super().revoke_one(session_id, now)

    async def revoke_all(self, now):
        await self.gate.pause("revoke_all")
        return await super().revoke_all(now)


async def contend(gate, provider, first_operation, second_operation):
    """The second task demonstrably runs up to its first suspension.

    The started event is set immediately before awaiting the operation, with no
    intervening yield. Thus when this waiter resumes, the competitor has either
    blocked on the auth lock or incorrectly entered credential/store I/O.
    Cleanup always releases/drains tasks, even in deliberate mutation probes.
    """
    first = asyncio.create_task(first_operation)
    second = None
    try:
        await asyncio.wait_for(gate.entered.wait(), timeout=5)
        observations = provider.observations
        started = asyncio.Event()

        async def start_second():
            started.set()
            return await second_operation

        second = asyncio.create_task(start_second())
        await asyncio.wait_for(started.wait(), timeout=5)
        assert provider.observations == observations, (
            "competing credential observation entered locked I/O"
        )
        assert not second.done(), (
            "competing operation completed before critical section released"
        )
    finally:
        gate.release.set()
        if second is None:
            second_operation.close()
            await asyncio.gather(first, return_exceptions=True)
        else:
            results = await asyncio.gather(first, second, return_exceptions=True)
    return results
