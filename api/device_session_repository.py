"""Digest-only async SurrealDB adapter. No retries, including unknown commits.

Every successful mutation writes the singleton guard. This deliberately coarse
serialization point prevents snapshot write skew (count/create/revoke-all), even
across distinct adapter instances. The service still requires one API process.
Use raw SDK results: query() discards later transaction statement errors.
"""

from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime
from typing import Any

from api.device_session_models import AccessRecord, AuthScope, SessionRecord
from open_notebook.database.repository import db_connection

_LIVE = "boot_epoch=$scope.boot_epoch AND credential_epoch=$scope.credential_epoch AND revoked_at=NONE AND expires_at > <datetime>$scope.now"
_GUARD = """
LET $guard = UPDATE auth_session_guard:singleton SET revision += 1 RETURN AFTER;
IF array::len($guard) != 1 { THROW 'Auth guard unavailable'; };
"""


# Canonical SurrealDB 2.3.10 INFO definitions for migration 28. Exact matching
# deliberately rejects changed types, VALUE clauses, permissions and indexes,
# not merely missing names. Changes require an explicit migration/adapter update.
_SCHEMA_FIELDS = {
    "auth_session": {
        "session_id": "string",
        "device_name": "string",
        "created_at": "datetime VALUE <datetime> $value",
        "last_used_at": "datetime VALUE <datetime> $value",
        "expires_at": "datetime VALUE <datetime> $value",
        "revoked_at": "option<datetime> VALUE IF $value = NULL OR $value = NONE { NONE } ELSE { <datetime> $value }",
        "boot_epoch": "string",
        "credential_epoch": "int",
        "generation": "int",
        "refresh_digest": "string",
    },
    "auth_access": {
        "digest": "string",
        "session_id": "string",
        "issued_at": "datetime VALUE <datetime> $value",
        "expires_at": "datetime VALUE <datetime> $value",
    },
    "auth_session_guard": {"revision": "int"},
}
_SCHEMA_INDEXES = {
    "auth_session": {
        "auth_session_id": "DEFINE INDEX auth_session_id ON auth_session FIELDS session_id UNIQUE",
        "auth_refresh_digest": "DEFINE INDEX auth_refresh_digest ON auth_session FIELDS refresh_digest UNIQUE",
    },
    "auth_access": {
        "auth_access_digest": "DEFINE INDEX auth_access_digest ON auth_access FIELDS digest UNIQUE",
        "auth_access_expiry": "DEFINE INDEX auth_access_expiry ON auth_access FIELDS expires_at",
    },
    "auth_session_guard": {},
}
_SCHEMA_QUERY = "INFO FOR DB; " + " ".join(
    f"INFO FOR TABLE {table};" for table in _SCHEMA_FIELDS
)


async def _validate_schema(db: Any) -> None:
    # INFO cannot be a LET/subquery in Surreal2.3.10, so this precedes the
    # transaction on the same connection. Never cache it. Concurrent admin DDL
    # (like live restore) is unsupported; this is not an atomic DDL defense.
    raw = await db.query_raw(_SCHEMA_QUERY, {})
    if not isinstance(raw, dict) or "error" in raw:
        raise ValueError
    results = raw.get("result")
    if not isinstance(results, list) or len(results) != 4:
        raise ValueError
    for item in results:
        if (
            not isinstance(item, dict)
            or item.get("status") != "OK"
            or not isinstance(item.get("result"), dict)
        ):
            raise ValueError
    tables = results[0]["result"].get("tables")
    if not isinstance(tables, dict):
        raise ValueError
    for table, item in zip(_SCHEMA_FIELDS, results[1:], strict=True):
        if (
            tables.get(table)
            != f"DEFINE TABLE {table} TYPE NORMAL SCHEMAFULL PERMISSIONS NONE"
        ):
            raise ValueError
        schema = item["result"]
        fields = {
            name: f"DEFINE FIELD {name} ON {table} TYPE {kind} PERMISSIONS FULL"
            for name, kind in _SCHEMA_FIELDS[table].items()
        }
        if (
            schema.get("fields") != fields
            or schema.get("indexes") != _SCHEMA_INDEXES[table]
            or schema.get("events") != {}
        ):
            raise ValueError


def _rows(value: Any, *, single: bool = False) -> list[dict[str, Any]]:
    if (
        not isinstance(value, list)
        or any(not isinstance(row, dict) for row in value)
        or (single and len(value) > 1)
    ):
        raise RuntimeError("Authentication storage unavailable")
    return value


def _session(row: dict[str, Any]) -> SessionRecord:
    data = {k: row[k] for k in SessionRecord.__dataclass_fields__ if k != "revoked_at"}
    data["revoked_at"] = row.get("revoked_at")
    for key in ("created_at", "last_used_at", "expires_at", "revoked_at"):
        value = data[key]
        if value is not None and not isinstance(value, datetime):
            data[key] = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return SessionRecord(**data)


class SurrealDeviceSessionStore:
    def __init__(self, connection: Callable = db_connection):
        self._connection = connection

    async def _query(self, body: str, variables: dict[str, Any]) -> Any:
        # RETURN collapses successful transaction results to exactly one value
        # in Surreal 2.3.10; failed commits instead return ERR result entries.
        query = (
            "BEGIN TRANSACTION; "
            "IF array::len((SELECT VALUE revision FROM auth_session_guard:singleton)) != 1 { THROW 'Auth guard unavailable'; }; "
            + body
            + " COMMIT TRANSACTION;"
        )
        try:
            async with self._connection() as db:
                await _validate_schema(db)
                raw = await db.query_raw(query, variables)
            if not isinstance(raw, dict) or "error" in raw:
                raise ValueError
            results = raw.get("result")
            if not isinstance(results, list) or len(results) != 1:
                raise ValueError
            item = results[0]
            if not isinstance(item, dict) or item.get("status") != "OK":
                raise ValueError
            result = item.get("result")
            if (
                not isinstance(result, dict)
                or result.get("ack") != "device-session-v1"
                or "value" not in result
            ):
                raise ValueError
            return result["value"]
        except Exception:
            raise RuntimeError("Authentication storage unavailable") from None

    @staticmethod
    def _return(expression: str) -> str:
        return 'RETURN {ack: "device-session-v1", value: ' + expression + "};"

    async def create_atomic(
        self,
        session: SessionRecord,
        access: AccessRecord,
        scope: AuthScope,
        live_limit: int,
    ) -> bool:
        body = f"LET $live = SELECT id FROM auth_session WHERE {_LIVE}; "
        body += "LET $ok = array::len($live) < $limit; IF $ok { " + _GUARD
        body += """CREATE type::thing('auth_session', $new_session.session_id) CONTENT $new_session;
        CREATE type::thing('auth_access', $new_access.digest) CONTENT $new_access;
        }; """ + self._return("$ok")
        value = await self._query(
            body,
            {
                "new_session": asdict(session),
                "new_access": asdict(access),
                "scope": asdict(scope),
                "limit": live_limit,
            },
        )
        if type(value) is not bool:
            raise RuntimeError("Authentication storage unavailable")
        return value

    async def get_session(self, session_id: str) -> SessionRecord | None:
        rows = await self._query(
            self._return("(SELECT * FROM type::thing('auth_session', $id))"),
            {"id": session_id},
        )
        rows = _rows(rows, single=True)
        return _session(rows[0]) if rows else None

    async def get_access(
        self, digest: str
    ) -> tuple[AccessRecord | None, SessionRecord | None]:
        value = await self._query(
            "LET $a = SELECT * FROM type::thing('auth_access', $digest); LET $s = SELECT * FROM auth_session WHERE session_id=$a[0].session_id; "
            + self._return("{access:$a, session:$s}"),
            {"digest": digest},
        )
        if not isinstance(value, dict) or set(value) != {"access", "session"}:
            raise RuntimeError("Authentication storage unavailable")
        value["access"] = _rows(value["access"], single=True)
        value["session"] = _rows(value["session"], single=True)
        if not value["access"]:
            return None, None
        row = value["access"][0]
        dates = [
            datetime.fromisoformat(str(row[k]).replace("Z", "+00:00"))
            if not isinstance(row[k], datetime)
            else row[k]
            for k in ("issued_at", "expires_at")
        ]
        return AccessRecord(row["digest"], row["session_id"], *dates), _session(
            value["session"][0]
        ) if value["session"] else None

    async def advance_last_used(
        self, session_id: str, scope: AuthScope
    ) -> SessionRecord | None:
        body = (
            f"LET $rows = SELECT * FROM auth_session WHERE session_id=$id AND {_LIVE}; "
        )
        body += (
            "IF array::len($rows)=1 AND $rows[0].last_used_at <= <datetime>$scope.now - 60s { "
            + _GUARD
        )
        body += "UPDATE type::thing('auth_session', $id) SET last_used_at=<datetime>$scope.now; }; "
        body += self._return(
            "(SELECT * FROM auth_session WHERE session_id=$id AND " + _LIVE + ")"
        )
        rows = await self._query(body, {"id": session_id, "scope": asdict(scope)})
        rows = _rows(rows, single=True)
        return _session(rows[0]) if rows else None

    async def rotate_atomic(
        self,
        expected: SessionRecord,
        replacement: SessionRecord,
        access: AccessRecord,
        scope: AuthScope,
    ) -> bool:
        body = f"LET $rows = SELECT * FROM auth_session WHERE session_id=$expected.session_id AND generation=$expected.generation AND refresh_digest=$expected.refresh_digest AND boot_epoch=$expected.boot_epoch AND credential_epoch=$expected.credential_epoch AND {_LIVE}; "
        body += "LET $ok = array::len($rows)=1; IF $ok { " + _GUARD
        # Immutable fields are never copied from the replacement.
        body += """UPDATE type::thing('auth_session', $expected.session_id) SET generation += 1, refresh_digest=$replacement.refresh_digest, last_used_at=<datetime>$scope.now;
        CREATE type::thing('auth_access', $new_access.digest) CONTENT $new_access;
        }; """ + self._return("$ok")
        value = await self._query(
            body,
            {
                "expected": asdict(expected),
                "replacement": asdict(replacement),
                "new_access": asdict(access),
                "scope": asdict(scope),
            },
        )
        if type(value) is not bool:
            raise RuntimeError("Authentication storage unavailable")
        return value

    async def _mutation(self, body: str, variables: dict[str, Any]) -> None:
        value = await self._query(body, variables)
        if value is not True:
            raise RuntimeError("Authentication storage unavailable")

    async def revoke_one(self, session_id: str, now: datetime) -> None:
        await self._mutation(
            _GUARD
            + "UPDATE auth_session SET revoked_at=<datetime>$now WHERE session_id=$id AND revoked_at=NONE; "
            + self._return("true"),
            {"id": session_id, "now": now},
        )

    async def revoke_all(self, now: datetime) -> None:
        await self._mutation(
            _GUARD
            + "UPDATE auth_session SET revoked_at=<datetime>$now WHERE revoked_at=NONE; "
            + self._return("true"),
            {"now": now},
        )

    async def list_sessions(self, scope: AuthScope) -> list[SessionRecord]:
        rows = await self._query(
            self._return(
                "(SELECT * FROM auth_session WHERE boot_epoch=$scope.boot_epoch AND credential_epoch=$scope.credential_epoch AND expires_at > <datetime>$scope.now ORDER BY created_at, session_id)"
            ),
            {"scope": asdict(scope)},
        )
        return [_session(row) for row in _rows(rows)]

    async def prune_access(self, now: datetime) -> None:
        await self._mutation(
            _GUARD
            + "DELETE auth_access WHERE expires_at <= <datetime>$now; "
            + self._return("true"),
            {"now": now},
        )

    async def ready(self) -> None:
        value = await self._query(
            self._return("(SELECT VALUE revision FROM auth_session_guard:singleton)"),
            {},
        )
        if not isinstance(value, list) or len(value) != 1 or type(value[0]) is not int:
            raise RuntimeError("Authentication storage unavailable")
