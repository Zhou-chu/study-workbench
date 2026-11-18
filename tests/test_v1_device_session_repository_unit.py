"""Malformed or missing repository acknowledgements through a synthetic connection."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

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
