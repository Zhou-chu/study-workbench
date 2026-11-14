"""Real DB cases are opt-in, synthetic loopback namespaces only."""

import asyncio
import os
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from surrealdb import AsyncSurreal

from api.device_session_models import AccessRecord, AuthScope, SessionRecord
from api.device_session_repository import (
    _SCHEMA_FIELDS,
    _SCHEMA_INDEXES,
    _SCHEMA_QUERY,
    SurrealDeviceSessionStore,
)


def schema_ack():
    tables = {
        table: f"DEFINE TABLE {table} TYPE NORMAL SCHEMAFULL PERMISSIONS NONE"
        for table in _SCHEMA_FIELDS
    }
    results = [{"status": "OK", "result": {"tables": tables}}]
    for table, fields in _SCHEMA_FIELDS.items():
        results.append(
            {
                "status": "OK",
                "result": {
                    "fields": {
                        name: f"DEFINE FIELD {name} ON {table} TYPE {kind} PERMISSIONS FULL"
                        for name, kind in fields.items()
                    },
                    "indexes": _SCHEMA_INDEXES[table],
                    "events": {},
                },
            }
        )
    return {"result": results}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [None, {}, {"result": []}, {"result": [{"status": "ERR", "result": "secret"}]}],
)
async def test_unknown_ack_fails_without_retry(response):
    calls = []

    class Connection:
        async def query_raw(self, query, variables):
            if query == _SCHEMA_QUERY:
                return schema_ack()
            calls.append(query)
            return response

    @asynccontextmanager
    async def connection():
        yield Connection()

    store = SurrealDeviceSessionStore(connection)
    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await store.prune_access(datetime.now(timezone.utc))
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("AUTH_TEST_SURREAL_URL"),
    reason="synthetic local Surreal not requested",
)
async def test_native_surreal_transactions():
    url = os.environ["AUTH_TEST_SURREAL_URL"]
    assert url.startswith("ws://127.0.0.1:")
    namespace = "auth_test_" + uuid4().hex

    @asynccontextmanager
    async def connection():
        async with AsyncSurreal(url) as db:
            await db.signin({"username": "synthetic", "password": "synthetic"})
            await db.use(namespace, "test")
            yield db

    async with connection() as db:
        assert "2.3.10" in await db.version()
        raw = await db.query_raw(
            Path("open_notebook/database/migrations/28.surrealql").read_text()
        )
        assert all(x["status"] == "OK" for x in raw["result"]), raw
    store = SurrealDeviceSessionStore(connection)
    await store.ready()
    now = datetime.now(timezone.utc)
    scope = AuthScope(now, "boot", 1)

    def pair():
        sid = str(uuid4())
        return SessionRecord(
            sid,
            "Synthetic",
            now,
            now,
            now + timedelta(days=30),
            None,
            "boot",
            1,
            0,
            uuid4().hex,
        ), AccessRecord(uuid4().hex, sid, now, now + timedelta(minutes=15))

    session, access = pair()
    assert await store.create_atomic(session, access, scope, 32)
    assert await store.get_session(session.session_id) == session
    assert await store.get_access(access.digest) == (access, session)

    @asynccontextmanager
    async def delayed_connection():
        async with connection() as db:

            class Delayed:
                async def query_raw(self, query, variables):
                    # Real overlapping snapshots before the conflicting write.
                    return await db.query_raw(
                        query.replace(
                            "BEGIN TRANSACTION; ",
                            "BEGIN TRANSACTION; LET $snapshot = SELECT revision FROM auth_session_guard:singleton; SLEEP 150ms; ",
                        ),
                        variables,
                    )

            yield Delayed()

    racing = SurrealDeviceSessionStore(delayed_connection)
    replacement = replace(session, generation=1, refresh_digest=uuid4().hex)
    successors = [replace(access, digest=uuid4().hex) for _ in range(2)]
    outcomes = await asyncio.gather(
        *(racing.rotate_atomic(session, replacement, a, scope) for a in successors),
        return_exceptions=True,
    )
    assert sum(x is True for x in outcomes) == 1, outcomes
    assert any(isinstance(x, RuntimeError) for x in outcomes), outcomes
    assert all(x is True or x is False or isinstance(x, RuntimeError) for x in outcomes)
    assert await store.get_session(session.session_id) == replacement
    assert (
        sum([(await store.get_access(a.digest))[0] is not None for a in successors])
        == 1
    )
    assert (
        await store.rotate_atomic(
            session, replacement, replace(access, digest=uuid4().hex), scope
        )
        is False
    )
    # A digest collision rolls back the CAS; no generation/refresh mutation.
    with pytest.raises(RuntimeError):
        await store.rotate_atomic(
            replacement, replace(replacement, refresh_digest=uuid4().hex), access, scope
        )
    assert await store.get_session(session.session_id) == replacement
    await store.advance_last_used(
        session.session_id, replace(scope, now=now + timedelta(seconds=60))
    )
    current = await store.get_session(session.session_id)
    assert current is not None
    assert current.last_used_at == now + timedelta(seconds=60)
    await store.prune_access(now + timedelta(seconds=61))
    assert (await store.get_access(access.digest))[0] is not None
    # Unique refresh collisions cannot overwrite either session or insert access.
    collision, collision_access = pair()
    collision = replace(collision, refresh_digest=replacement.refresh_digest)
    with pytest.raises(RuntimeError):
        await store.create_atomic(collision, collision_access, scope, 32)
    assert await store.get_session(collision.session_id) is None
    assert await store.get_access(collision_access.digest) == (None, None)

    # Concurrent creates on distinct rows cannot both escape cap via write skew.
    pairs = [pair() for _ in range(8)]
    outcomes = await asyncio.gather(
        *(racing.create_atomic(s, a, scope, 2) for s, a in pairs),
        return_exceptions=True,
    )
    assert sum(x is True for x in outcomes) == 1, outcomes
    assert len(await store.list_sessions(scope)) == 2
    s, a = pair()
    assert await store.create_atomic(s, a, scope, 2) is False
    assert await store.get_access(a.digest) == (None, None)
    # Revoke-one versus refresh cannot clear a revocation or orphan access.
    current = await store.get_session(session.session_id)
    assert current is not None
    successor_access = replace(access, digest=uuid4().hex)
    next_session = replace(
        current, generation=current.generation + 1, refresh_digest=uuid4().hex
    )
    revoke_rotate = await asyncio.gather(
        racing.revoke_one(current.session_id, now),
        racing.rotate_atomic(current, next_session, successor_access, scope),
        return_exceptions=True,
    )
    assert sum(isinstance(x, RuntimeError) for x in revoke_rotate) == 1, revoke_rotate
    if isinstance(revoke_rotate[0], RuntimeError):
        await store.revoke_one(current.session_id, now)
    current = await store.get_session(session.session_id)
    assert current is not None and current.revoked_at == now
    assert (
        await store.rotate_atomic(
            current, next_session, replace(access, digest=uuid4().hex), scope
        )
        is False
    )

    # Guard serializes revoke-all/create: either new login follows revoke, or
    # is revoked / aborted. No preexisting row can remain live.
    s, a = pair()
    revoke_outcomes = await asyncio.gather(
        racing.revoke_all(now),
        racing.create_atomic(s, a, scope, 32),
        return_exceptions=True,
    )
    assert sum(isinstance(x, RuntimeError) for x in revoke_outcomes) == 1, (
        revoke_outcomes
    )
    if isinstance(revoke_outcomes[0], Exception):
        await store.revoke_all(now)  # explicit later operation, not adapter retry
    assert all(
        row.revoked_at is not None
        for row in await store.list_sessions(scope)
        if row.session_id != s.session_id
    )
    old, old_access = pair()
    old = replace(old, boot_epoch="old-boot", credential_epoch=99)
    assert await store.create_atomic(
        old, old_access, AuthScope(now, "old-boot", 99), 32
    )
    await store.revoke_all(now)
    assert all(row.revoked_at is not None for row in await store.list_sessions(scope))
    old_after = await store.get_session(old.session_id)
    assert old_after is not None and old_after.revoked_at == now
    await store.prune_access(now + timedelta(minutes=15))
    assert await store.get_access(access.digest) == (None, None)
    # Commit happened, acknowledgement lost: no retry and no reported success.
    calls = []

    @asynccontextmanager
    async def lost_ack_connection():
        async with connection() as db:

            class LostAck:
                async def query_raw(self, query, variables):
                    if query == _SCHEMA_QUERY:
                        return await db.query_raw(query, variables)
                    calls.append(query)
                    await db.query_raw(query, variables)
                    raise ConnectionError("synthetic lost acknowledgement")

            yield LostAck()

    s, a = pair()
    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await SurrealDeviceSessionStore(lost_ack_connection).create_atomic(
            s, a, scope, 32
        )
    assert len(calls) == 1
    assert await store.get_session(s.session_id) == s
    assert (await store.get_access(a.digest))[0] == a
    # Missing guard cannot silently recreate itself or report healthy storage.
    async with connection() as db:
        await db.query("DELETE auth_session_guard:singleton;")
    with pytest.raises(RuntimeError):
        await store.ready()
    with pytest.raises(RuntimeError):
        await store.list_sessions(scope)
    with pytest.raises(RuntimeError):
        missing_session, missing_access = pair()
        await store.create_atomic(missing_session, missing_access, scope, 32)
    async with connection() as db:
        raw = await db.query_raw(
            Path("open_notebook/database/migrations/28_down.surrealql").read_text()
        )
        assert all(x["status"] == "OK" for x in raw["result"])


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, False, 1, {}, []])
async def test_malformed_mutation_ack_is_not_success(value):
    class Connection:
        async def query_raw(self, query, variables):
            if query == _SCHEMA_QUERY:
                return schema_ack()
            return {
                "result": [
                    {
                        "status": "OK",
                        "result": {"ack": "device-session-v1", "value": value},
                    }
                ]
            }

    @asynccontextmanager
    async def connection():
        yield Connection()

    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await SurrealDeviceSessionStore(connection).revoke_all(
            datetime.now(timezone.utc)
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, False, {}, "secret", 1, [{}, {}]])
async def test_malformed_read_ack_is_not_absence(value):
    class Connection:
        async def query_raw(self, query, variables):
            if query == _SCHEMA_QUERY:
                return schema_ack()
            return {
                "result": [
                    {
                        "status": "OK",
                        "result": {"ack": "device-session-v1", "value": value},
                    }
                ]
            }

    @asynccontextmanager
    async def connection():
        yield Connection()

    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await SurrealDeviceSessionStore(connection).get_session(str(uuid4()))


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("AUTH_TEST_SURREAL_URL"),
    reason="synthetic local Surreal not requested",
)
@pytest.mark.parametrize(
    "corruption",
    [
        "REMOVE TABLE auth_access;",
        "REMOVE TABLE auth_session;",
        "REMOVE TABLE auth_session_guard;",
        "REMOVE INDEX auth_refresh_digest ON auth_session;",
        "DEFINE INDEX OVERWRITE auth_refresh_digest ON auth_session FIELDS refresh_digest;",
        "DEFINE INDEX OVERWRITE auth_refresh_digest ON auth_session FIELDS device_name UNIQUE;",
        "REMOVE INDEX auth_access_digest ON auth_access;",
        "REMOVE INDEX auth_session_id ON auth_session;",
        "REMOVE FIELD digest ON auth_access;",
        "DEFINE FIELD OVERWRITE expires_at ON auth_access TYPE string;",
        "DEFINE FIELD OVERWRITE revoked_at ON auth_session TYPE datetime;",
        "DEFINE FIELD OVERWRITE generation ON auth_session TYPE string;",
        "DEFINE FIELD OVERWRITE revision ON auth_session_guard TYPE string;",
        "DEFINE TABLE OVERWRITE auth_access SCHEMALESS;",
        "DEFINE FIELD OVERWRITE refresh_digest ON auth_session TYPE string VALUE 'forced';",
        "DEFINE FIELD OVERWRITE credential_epoch ON auth_session TYPE number;",
        "DEFINE TABLE OVERWRITE auth_session SCHEMAFULL PERMISSIONS FULL;",
    ],
)
async def test_corrupt_schema_fails_readiness_and_issuance(monkeypatch, corruption):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from api import device_session_repository
    from api.auth import PasswordAuthMiddleware
    from api.device_session_models import AuthError
    from api.device_session_runtime import initialize_device_auth, install_auth_handlers
    from api.routers.auth import router

    url = os.environ["AUTH_TEST_SURREAL_URL"]
    assert url.startswith("ws://127.0.0.1:")
    namespace = "auth_schema_" + uuid4().hex

    @asynccontextmanager
    async def connection():
        async with AsyncSurreal(url) as db:
            await db.signin({"username": "synthetic", "password": "synthetic"})
            await db.use(namespace, "test")
            yield db

    async with connection() as db:
        raw = await db.query_raw(
            Path("open_notebook/database/migrations/28.surrealql").read_text()
        )
        assert all(item["status"] == "OK" for item in raw["result"])
    store = SurrealDeviceSessionStore(connection)
    monkeypatch.setattr(
        device_session_repository, "SurrealDeviceSessionStore", lambda: store
    )
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "device_sessions")
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "")
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    app = FastAPI()
    install_auth_handlers(app)
    app.include_router(router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware)
    await initialize_device_auth(app)
    async with connection() as db:
        raw = await db.query_raw(corruption)
        assert all(item["status"] == "OK" for item in raw["result"]), raw
        before = await db.query("INFO FOR DB;")
    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await store.ready()
    with pytest.raises((RuntimeError, AuthError)):
        await initialize_device_auth(FastAPI())
    now = datetime.now(timezone.utc)
    sid = str(uuid4())
    record = SessionRecord(
        sid, "Test", now, now, now + timedelta(days=30), None, "boot", 1, 0, uuid4().hex
    )
    access = AccessRecord(uuid4().hex, sid, now, now + timedelta(minutes=15))
    with pytest.raises(RuntimeError, match="Authentication storage unavailable"):
        await store.create_atomic(record, access, AuthScope(now, "boot", 1), 32)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://synthetic"
    ) as client:
        assert (await client.get("/api/auth/status")).status_code == 503
        assert (
            await client.post(
                "/api/auth/sessions",
                json={"password": "synthetic", "device_name": "Test"},
            )
        ).status_code == 503
    async with connection() as db:
        after = await db.query("INFO FOR DB;")
        assert after == before  # Failed issuance never recreates a missing table.
