"""Synthetic contract fake: not evidence of Surreal transaction/rollback semantics."""

import asyncio
import hashlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from api.device_session_credentials import StrictPasswordProvider
from api.device_session_models import AuthError, TokenEnvelope
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


@pytest.mark.asyncio
async def test_issue_digest_only_and_rotation_overlap_duplicate():
    svc, store, clock = setup()
    first = await svc.create_session("synthetic", " Device ", client_address="peer")
    assert first.access_token.startswith("swa1_") and first.refresh_token.startswith(
        "swr1_"
    )
    assert len(first.access_token) == 48
    assert first.access_token not in repr(store.sessions) + repr(store.access)
    assert first.refresh_token not in repr(store.sessions) + repr(store.access)
    assert first.access_expires_at == clock.now + timedelta(minutes=15)
    assert first.refresh_expires_at == clock.now + timedelta(days=30)
    results = await asyncio.gather(
        *(svc.rotate_session(first.session_id, first.refresh_token) for _ in range(2)),
        return_exceptions=True,
    )
    winner = next(x for x in results if not isinstance(x, Exception))
    loser = next(x for x in results if isinstance(x, Exception))
    assert isinstance(winner, TokenEnvelope)
    assert isinstance(loser, AuthError)
    assert loser.code == "REFRESH_REJECTED"
    assert (
        await svc.authenticate_access(first.access_token)
    ).session_id == first.session_id
    assert (
        await svc.authenticate_access(winner.access_token)
    ).session_id == first.session_id
    assert winner.refresh_expires_at == first.refresh_expires_at
    metadata = await svc.list_sessions(winner.access_token)
    assert metadata[0].device_name == "Device" and metadata[0].is_current
    assert "digest" not in repr(metadata)


@pytest.mark.asyncio
async def test_expiry_exact_boundary_and_absolute_rotation():
    svc, _, clock = setup()
    first = await svc.create_session("synthetic", "d")
    clock.advance(minutes=15)
    await error("ACCESS_EXPIRED", svc.authenticate_access(first.access_token))
    clock.advance(days=29, hours=23, minutes=44)
    last = await svc.rotate_session(first.session_id, first.refresh_token)
    assert last.access_expires_at == first.refresh_expires_at
    clock.advance(minutes=1)
    await error("AUTH_REQUIRED", svc.authenticate_access(last.access_token))
    await error(
        "REFRESH_REJECTED", svc.rotate_session(last.session_id, last.refresh_token)
    )


@pytest.mark.asyncio
async def test_revoke_one_all_and_boot_epoch():
    svc, store, _ = setup()
    a = await svc.create_session("synthetic", "a")
    b = await svc.create_session("synthetic", "b")
    await svc.revoke_session(b.access_token, a.session_id)
    await svc.revoke_session(b.access_token, a.session_id)
    await error("AUTH_REQUIRED", svc.authenticate_access(a.access_token))
    await error("REFRESH_REJECTED", svc.rotate_session(a.session_id, a.refresh_token))
    await svc.revoke_all_sessions(b.access_token)
    await error("AUTH_REQUIRED", svc.authenticate_access(b.access_token))
    c = await svc.create_session("synthetic", "c")
    restarted = DeviceSessionService(
        store, StrictPasswordProvider(password="synthetic")
    )
    await error("AUTH_REQUIRED", restarted.authenticate_access(c.access_token))


@pytest.mark.asyncio
async def test_strict_file_change_failure_recovery_barrier(tmp_path):
    path = tmp_path / "test-password"
    path.write_text(" synthetic\n")
    provider = StrictPasswordProvider(password="fallback", password_file=str(path))
    svc, store, _ = setup(provider)
    a = await svc.create_session("synthetic", "a")
    path.unlink()
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(a.access_token))
    await error("AUTH_UNAVAILABLE", svc.create_session("fallback", "a"))
    path.write_text("synthetic")
    await error("AUTH_REQUIRED", svc.authenticate_access(a.access_token))
    b = await svc.create_session("synthetic", "b")
    path.write_text("changed")
    store.fail = True
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(b.access_token))
    store.fail = False
    c = await svc.create_session("changed", "c")
    assert c.session_id != b.session_id
    await error("AUTH_REQUIRED", svc.authenticate_access(b.access_token))


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [b"", b" \n", b"\xff", b"x" * 4097])
async def test_file_invalid_never_falls_back(tmp_path, content):
    path = tmp_path / "test-password"
    path.write_bytes(content)
    provider = StrictPasswordProvider(password="fallback", password_file=str(path))
    await error("AUTH_UNAVAILABLE", provider.read())


@pytest.mark.asyncio
async def test_limits_are_serialized_and_expire():
    svc, _, clock = setup()
    failures = await asyncio.gather(
        *(svc.create_session("wrong", "d", client_address="same") for _ in range(12)),
        return_exceptions=True,
    )
    assert all(isinstance(x, AuthError) for x in failures)
    codes = [x.code for x in failures if isinstance(x, AuthError)]
    assert codes.count("AUTH_INVALID_CREDENTIALS") == 5
    assert codes.count("AUTH_RATE_LIMITED") == 7
    await error(
        "AUTH_RATE_LIMITED", svc.create_session("synthetic", "d", client_address="same")
    )
    clock.advance(seconds=60)
    a = await svc.create_session("synthetic", "d", client_address="same")
    for _ in range(10):
        await error(
            "REFRESH_REJECTED", svc.rotate_session(a.session_id, "swr1_" + "A" * 43)
        )
    await error("AUTH_RATE_LIMITED", svc.rotate_session(a.session_id, a.refresh_token))
    clock.advance(seconds=60)
    await svc.rotate_session(a.session_id, a.refresh_token)
    for _ in range(31):
        await svc.create_session("synthetic", "d")
    await error("AUTH_RATE_LIMITED", svc.create_session("synthetic", "overflow"))


@pytest.mark.asyncio
async def test_global_limits_bounded_buckets():
    svc, _, _ = setup()
    for i in range(30):
        await error(
            "AUTH_INVALID_CREDENTIALS",
            svc.create_session("wrong", "d", client_address=str(i)),
        )
    await error(
        "AUTH_RATE_LIMITED", svc.create_session("synthetic", "d", client_address="new")
    )
    assert len(svc._login_failures) <= 30
    import uuid

    for _ in range(120):
        await error(
            "REFRESH_REJECTED",
            svc.rotate_session(str(uuid.uuid4()), "swr1_" + "A" * 43),
        )
    await error(
        "AUTH_RATE_LIMITED", svc.rotate_session(str(uuid.uuid4()), "swr1_" + "A" * 43)
    )
    assert len(svc._refresh_attempts) <= 120


@pytest.mark.asyncio
async def test_store_unknown_commit_no_retry_or_secret_error():
    svc, store, _ = setup()
    a = await svc.create_session("synthetic", "d")
    store.unknown_commit = True
    await error("AUTH_UNAVAILABLE", svc.rotate_session(a.session_id, a.refresh_token))
    assert store.rotation_calls == 1
    store.unknown_commit = False
    await error("REFRESH_REJECTED", svc.rotate_session(a.session_id, a.refresh_token))
    store.fail = True
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(a.access_token))


@pytest.mark.asyncio
async def test_validation_and_secret_repr():
    svc, _, _ = setup()
    await error("AUTH_INVALID_REQUEST", svc.create_session("x" * 4097, "d"))
    await error("AUTH_INVALID_REQUEST", svc.create_session("synthetic", " "))
    await error("AUTH_INVALID_REQUEST", svc.authenticate_access("swr1_" + "A" * 43))
    await error(
        "AUTH_INVALID_REQUEST", svc.rotate_session("not-uuid", "swr1_" + "A" * 43)
    )
    a = await svc.create_session("synthetic", "设备")
    assert a.access_token not in repr(a) and a.refresh_token not in repr(a)


@pytest.mark.asyncio
async def test_file_read_off_event_loop_and_environment_snapshot(tmp_path):
    import threading

    class ThreadCheckedProvider(StrictPasswordProvider):
        def _read_file(self):
            assert threading.current_thread() is not threading.main_thread()
            return super()._read_file()

    path = tmp_path / "synthetic-secret"
    path.write_text(" temporary\n")
    assert await ThreadCheckedProvider(password_file=str(path)).read() == "temporary"
    environment = {"OPEN_NOTEBOOK_PASSWORD": "original"}
    provider = StrictPasswordProvider.from_environment(environment)
    environment["OPEN_NOTEBOOK_PASSWORD"] = "changed"
    assert await provider.read() == "original"
    await error(
        "AUTH_UNAVAILABLE",
        StrictPasswordProvider(password="fallback", password_file="").read(),
    )
    await error(
        "AUTH_UNAVAILABLE", StrictPasswordProvider(password_file=str(tmp_path)).read()
    )


@pytest.mark.asyncio
async def test_same_mtime_content_change_invalidates_and_failed_barrier_retries(
    tmp_path,
):
    import os

    path = tmp_path / "synthetic-secret"
    path.write_text("original")
    svc, store, _ = setup(StrictPasswordProvider(password_file=str(path)))
    first = await svc.create_session("original", "one")
    old_stat = path.stat()
    path.write_text("modified")
    os.utime(path, ns=(old_stat.st_atime_ns, old_stat.st_mtime_ns))
    store.fail = True
    await error("AUTH_UNAVAILABLE", svc.create_session("modified", "two"))
    await error("AUTH_UNAVAILABLE", svc.create_session("modified", "two"))
    store.fail = False
    await svc.create_session("modified", "two")
    assert store.sessions[first.session_id].revoked_at is not None
    await error("AUTH_REQUIRED", svc.authenticate_access(first.access_token))


@pytest.mark.asyncio
async def test_refresh_revoke_race_never_resurrects_and_create_orders_after_all():
    svc, store, _ = setup()
    caller = await svc.create_session("synthetic", "caller")
    target = await svc.create_session("synthetic", "target")
    winner, _ = await asyncio.gather(
        svc.rotate_session(target.session_id, target.refresh_token),
        svc.revoke_session(caller.access_token, target.session_id),
    )
    await error("AUTH_REQUIRED", svc.authenticate_access(winner.access_token))
    await error(
        "REFRESH_REJECTED", svc.rotate_session(winner.session_id, winner.refresh_token)
    )
    _, later = await asyncio.gather(
        svc.revoke_all_sessions(caller.access_token),
        svc.create_session("synthetic", "later"),
    )
    assert (
        await svc.authenticate_access(later.access_token)
    ).session_id == later.session_id
    assert store.sessions[caller.session_id].revoked_at is not None


@pytest.mark.asyncio
async def test_cas_zero_does_not_return_tokens_or_insert_access():
    class CasLoser(MemoryStore):
        async def rotate_atomic(self, expected, replacement, access, scope):
            return False

    svc, store, _ = setup(store=CasLoser())
    first = await svc.create_session("synthetic", "d")
    before = dict(store.access)
    await error(
        "REFRESH_REJECTED", svc.rotate_session(first.session_id, first.refresh_token)
    )
    assert store.access == before
    assert store.sessions[first.session_id].generation == 0
    await svc.authenticate_access(first.access_token)


@pytest.mark.asyncio
async def test_pruning_retains_live_overlap_but_may_forget_expired_tokens():
    svc, store, clock = setup()
    first = await svc.create_session("synthetic", "d")
    clock.advance(minutes=1)
    second = await svc.rotate_session(first.session_id, first.refresh_token)
    assert len(store.access) == 2
    clock.advance(minutes=14)
    await svc.create_session("synthetic", "new")
    await error("AUTH_REQUIRED", svc.authenticate_access(first.access_token))
    await svc.authenticate_access(second.access_token)


@pytest.mark.asyncio
async def test_unknown_create_commit_and_restart_preserved_clock():
    svc, store, clock = setup()
    store.unknown_commit = True
    await error("AUTH_UNAVAILABLE", svc.create_session("synthetic", "d"))
    assert len(store.sessions) == 1
    store.unknown_commit = False
    issued = await svc.create_session("synthetic", "d")
    restarted = DeviceSessionService(
        store, StrictPasswordProvider(password="synthetic"), clock=clock
    )
    await error("AUTH_REQUIRED", restarted.authenticate_access(issued.access_token))
    await error(
        "REFRESH_REJECTED",
        restarted.rotate_session(issued.session_id, issued.refresh_token),
    )


@pytest.mark.asyncio
async def test_failed_login_retry_after_and_unicode_constant_time_password():
    svc, _, clock = setup(StrictPasswordProvider(password="密码🔒"))
    envelope = await svc.create_session("密码🔒", "设备")
    await svc.authenticate_access(envelope.access_token)
    for _ in range(5):
        await error("AUTH_INVALID_CREDENTIALS", svc.create_session("wrong", "d"))
    clock.advance(seconds=10)
    limited = await error("AUTH_RATE_LIMITED", svc.create_session("密码🔒", "d"))
    assert limited.retry_after == 50


@pytest.mark.asyncio
async def test_resource_access_advances_last_used_at_most_once_per_minute():
    class UsageStore(MemoryStore):
        writes = 0
        fail_usage = False

        async def advance_last_used(self, session_id, scope):
            self.check()
            if self.fail_usage:
                raise RuntimeError("private DB write detail")
            current = self.sessions.get(session_id)
            if current is None or not current.live(scope):
                return None
            self.writes += 1
            updated = replace(
                current, last_used_at=max(current.last_used_at, scope.now)
            )
            self.sessions[session_id] = updated
            return updated

    svc, store, clock = setup(store=UsageStore())
    first = await svc.create_session("synthetic", "d")
    clock.advance(seconds=59)
    await svc.authenticate_access(first.access_token)
    assert store.writes == 0
    clock.advance(seconds=1)
    authenticated = await svc.authenticate_access(first.access_token)
    assert authenticated.last_used_at == clock.now
    assert store.writes == 1
    await svc.authenticate_access(first.access_token)
    assert store.writes == 1
    clock.advance(seconds=60)
    store.fail_usage = True
    await error("AUTH_UNAVAILABLE", svc.authenticate_access(first.access_token))
    store.fail_usage = False
    await svc.revoke_session(first.access_token, first.session_id)
    assert store.writes == 2
    clock.advance(seconds=60)
    await error("AUTH_REQUIRED", svc.authenticate_access(first.access_token))
    assert store.writes == 2


@pytest.mark.asyncio
async def test_invalid_unicode_device_name_is_sanitized_validation_error():
    svc, _, _ = setup()
    await error("AUTH_INVALID_REQUEST", svc.create_session("synthetic", "\ud800"))


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


@pytest.mark.asyncio
async def test_credential_io_holds_lock_before_second_observation():
    gate = OperationGate()
    provider = ObservedCredentials(gate)
    svc, _, _ = setup(provider, SuspendedStore(gate))
    issued = await svc.create_session("synthetic", "d")
    gate.operation = "credential"
    results = await contend(
        gate,
        provider,
        svc.authenticate_access(issued.access_token),
        svc.create_session("synthetic", "second"),
    )
    assert results[0].session_id == issued.session_id
    assert isinstance(results[1], TokenEnvelope)


@pytest.mark.asyncio
@pytest.mark.parametrize("first_kind", ["rotate", "revoke"])
async def test_suspended_store_serializes_rotate_and_revoke_both_orders(first_kind):
    gate = OperationGate()
    provider = ObservedCredentials(gate)
    svc, _, _ = setup(provider, SuspendedStore(gate))
    caller = await svc.create_session("synthetic", "caller")
    target = await svc.create_session("synthetic", "target")
    gate.operation = first_kind
    rotate = svc.rotate_session(target.session_id, target.refresh_token)
    revoke = svc.revoke_session(caller.access_token, target.session_id)
    first, second = (rotate, revoke) if first_kind == "rotate" else (revoke, rotate)
    results = await contend(gate, provider, first, second)
    if first_kind == "rotate":
        assert isinstance(results[0], TokenEnvelope)
        await error("AUTH_REQUIRED", svc.authenticate_access(results[0].access_token))
        assert results[1] is None
    else:
        assert results[0] is None
        assert isinstance(results[1], AuthError)
        assert results[1].code == "REFRESH_REJECTED"
    await error("AUTH_REQUIRED", svc.authenticate_access(target.access_token))


@pytest.mark.asyncio
@pytest.mark.parametrize("first_kind", ["create", "revoke_all"])
async def test_suspended_store_orders_create_and_revoke_all_both_orders(first_kind):
    gate = OperationGate()
    provider = ObservedCredentials(gate)
    svc, _, _ = setup(provider, SuspendedStore(gate))
    caller = await svc.create_session("synthetic", "caller")
    gate.operation = first_kind
    create = svc.create_session("synthetic", "new")
    revoke = svc.revoke_all_sessions(caller.access_token)
    first, second = (create, revoke) if first_kind == "create" else (revoke, create)
    results = await contend(gate, provider, first, second)
    new = results[0] if first_kind == "create" else results[1]
    assert isinstance(new, TokenEnvelope)
    if first_kind == "create":
        await error("AUTH_REQUIRED", svc.authenticate_access(new.access_token))
    else:
        assert (
            await svc.authenticate_access(new.access_token)
        ).session_id == new.session_id
    await error("AUTH_REQUIRED", svc.authenticate_access(caller.access_token))


@pytest.mark.asyncio
async def test_epoch_barrier_blocks_concurrent_login_until_revoke_acknowledged():
    gate = OperationGate()
    provider = ObservedCredentials(gate)
    svc, store, _ = setup(provider, SuspendedStore(gate))
    old = await svc.create_session("synthetic", "old")
    old_epoch = store.sessions[old.session_id].credential_epoch
    provider.current = "changed-synthetic"
    gate.operation = "revoke_all"
    results = await contend(
        gate,
        provider,
        svc.authenticate_access(old.access_token),
        svc.create_session("changed-synthetic", "new"),
    )
    assert isinstance(results[0], AuthError)
    assert results[0].code == "AUTH_REQUIRED"
    assert isinstance(results[1], TokenEnvelope)
    new = results[1]
    assert store.sessions[old.session_id].revoked_at is not None
    assert store.sessions[new.session_id].credential_epoch > old_epoch
    await svc.authenticate_access(new.access_token)
    await error(
        "REFRESH_REJECTED", svc.rotate_session(old.session_id, old.refresh_token)
    )


@pytest.mark.asyncio
async def test_persisted_fields_contain_exact_digests_and_no_raw_credentials():
    import json
    from dataclasses import asdict

    svc, store, _ = setup()
    issued = await svc.create_session("synthetic", "device")
    refresh_digest = hashlib.sha256(issued.refresh_token.encode("ascii")).hexdigest()
    access_digest = hashlib.sha256(issued.access_token.encode("ascii")).hexdigest()
    assert store.sessions[issued.session_id].refresh_digest == refresh_digest
    assert set(store.access) == {access_digest}
    assert store.access[access_digest].digest == access_digest
    assert len(refresh_digest) == len(access_digest) == 64
    persisted = json.dumps(
        {
            "sessions": {k: asdict(v) for k, v in store.sessions.items()},
            "access": {k: asdict(v) for k, v in store.access.items()},
        },
        default=str,
    )
    assert refresh_digest in persisted and access_digest in persisted
    for secret in ("synthetic", issued.access_token, issued.refresh_token):
        assert secret not in persisted
    metadata = await svc.list_sessions(issued.access_token)
    assert set(asdict(metadata[0])) == {
        "session_id",
        "device_name",
        "created_at",
        "last_used_at",
        "expires_at",
        "revoked_at",
        "is_current",
    }
