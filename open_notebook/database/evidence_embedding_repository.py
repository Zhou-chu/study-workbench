"""Derived evidence vectors: canonical scope first, attempt-fenced publication.

No model/default resolution or evidence text is read here. Shared filesystem
project barriers coordinate local writers; DB guard writes and canonical
predicates are the cross-process authority. SQL execution/transaction isolation
still requires the separately authorized, isolated database acceptance gate.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any, NoReturn
from uuid import uuid4

from loguru import logger
from surrealdb import RecordID

from open_notebook.database.project_locks import project_lock
from open_notebook.database.repository import (
    db_connection,
    repo_query,
)
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    ScopeEntry,
    ScopeSnapshot,
)
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_MAX_ROWS = 5000
_MAX_ELEMENTS = 2_000_000


def _hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    ).hexdigest()


def _target(table: str, *parts: Any) -> RecordID:
    return RecordID(table, _hash(parts))


def _personal_target(kind: str, identity: str) -> RecordID:
    # Same physical identity as PersonalStore.record_key, without an API import.
    return RecordID("v1_" + kind, hashlib.sha256(identity.encode()).hexdigest())


def _fail(code: str) -> NoReturn:
    raise InvalidInputError(
        code + ": evidence index prerequisites changed or are unavailable"
    )


def _identity(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 512:
        _fail("INDEX_INTEGRITY")
    return value


def _vector_key(profile: EmbeddingProfile, row: dict) -> str:
    return _hash(
        [
            profile.fingerprint,
            profile.dimension,
            profile.preprocessing_revision,
            row["version_id"],
            row["extraction_id"],
            row["evidence_id"],
            row["quote_hash"],
            row["attempt_id"],
        ]
    )


def _namespace(profile: EmbeddingProfile) -> dict[str, Any]:
    return {
        "namespace": profile.fingerprint,
        "dimension": profile.dimension,
        "preprocessing_revision": profile.preprocessing_revision,
    }


# Every mutable operation writes the same per-version guard as invalidation.
# Merely reading an epoch under snapshot isolation would permit write skew.
_SCOPE_GUARD = """
FOR $entry IN $entries {
    LET $version_target = $entry.version_target;
    LET $extraction_target = $entry.extraction_target;
    LET $source_target = $entry.source_target;
    LET $scope_target = $entry.scope_target;
    LET $v = (SELECT payload.source_version_id AS version_id, payload.source_id AS source_id, payload.notebook_id AS notebook_id, payload.status AS status, payload.current_extraction_id AS extraction_id FROM $version_target)[0];
    LET $x = (SELECT payload.extraction_id AS extraction_id, payload.source_version_id AS version_id, payload.notebook_id AS notebook_id, payload.status AS status, payload.evidence_ids AS evidence_ids FROM $extraction_target)[0];
    IF array::len(SELECT id FROM $notebook_target) != 1 OR array::len(SELECT id FROM $source_target) != 1 OR array::len(SELECT id FROM reference WHERE in = $entry.source_target AND out = $notebook_target) = 0 { THROW "SCOPE_CHANGED"; };
    IF $v.version_id != $entry.version_id OR $v.source_id != $entry.source_id OR $v.notebook_id != $notebook_id OR $v.extraction_id != $entry.extraction_id OR $v.status NOT IN ['ready', 'partial'] { THROW "SCOPE_CHANGED"; };
    IF $x.version_id != $entry.version_id OR $x.extraction_id != $entry.extraction_id OR $x.notebook_id != $notebook_id OR $x.status NOT IN ['ready', 'partial'] OR $x.evidence_ids != $entry.evidence_ids { THROW "SCOPE_CHANGED"; };
    FOR $evidence IN $entry.canonical {
        LET $evidence_target = $evidence.target;
        LET $e = (SELECT payload.evidence_id AS evidence_id, payload.source_version_id AS version_id, payload.extraction_id AS extraction_id, payload.notebook_id AS notebook_id, payload.quote_hash AS quote_hash FROM $evidence_target)[0];
        IF $e.evidence_id != $evidence.evidence_id OR $e.quote_hash != $evidence.quote_hash OR $e.version_id != $entry.version_id OR $e.extraction_id != $entry.extraction_id OR $e.notebook_id != $notebook_id { THROW "SCOPE_CHANGED"; };
    };
    LET $old_epoch = (SELECT VALUE scope_epoch FROM $scope_target)[0] ?? 0;
    IF $old_epoch != $entry.scope_epoch { THROW "SCOPE_CHANGED"; };
    UPSERT $scope_target SET notebook_id = $notebook_id, version_id = $entry.version_id, scope_epoch = $old_epoch, fence = $fence;
};
"""
_ATTEMPT_GUARD = """
LET $attempt = (SELECT * FROM $attempt_target)[0];
IF $attempt = NONE { THROW "ATTEMPT_NOT_REGISTERED"; };
IF $attempt.cancelled = true { THROW "ATTEMPT_CANCELLED"; };
IF $attempt.scope_fingerprint != $scope_fingerprint OR $attempt.namespace != $namespace OR $attempt.dimension != $dimension OR $attempt.preprocessing_revision != $preprocessing_revision { THROW "INDEX_INTEGRITY"; };
UPDATE $attempt_target SET fence = $fence;
"""


async def _transaction(
    body: str, params: dict[str, Any], *, operation: str = "mutation"
) -> dict[str, Any]:
    """Require matching in-transaction AND post-COMMIT operation receipts.

    Follow the supported SurrealDB 2.3.10 envelope in embedding_repository:
    RETURN suppresses preceding successes. Only two matching OK receipts prove
    success; only all-ERR transaction results plus the matching suffix prove an
    abort. Missing/mixed/unrecognized envelopes remain outcome-unknown.
    """
    receipt = {"operation": operation, "token": uuid4().hex}
    params = {**params, "receipt": receipt}
    try:
        async with db_connection() as connection:
            response = await connection.query_raw(
                "BEGIN TRANSACTION;\n"
                + body
                + "\nRETURN $receipt;\nCOMMIT TRANSACTION;\nRETURN $receipt;",
                params,
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        # Drop raw exception context before returning a typed unknown outcome.
        response = None
    if not isinstance(response, dict) or response.get("error") is not None:
        raise DatabaseOperationError(
            "INDEX_COMMIT_UNKNOWN: missing transaction acknowledgement"
        )
    results = response.get("result")
    if (
        not isinstance(results, list)
        or not results
        or any(
            not isinstance(r, dict)
            or r.get("status") not in {"OK", "ERR"}
            or "result" not in r
            for r in results
        )
    ):
        raise DatabaseOperationError(
            "INDEX_COMMIT_UNKNOWN: incomplete statement acknowledgements"
        )
    errors = [r["result"] for r in results if r["status"] == "ERR"]
    if errors:
        if (
            len(results) < 2
            or results[-1]["status"] != "OK"
            or results[-1]["result"] != receipt
            or any(
                r["status"] != "ERR" or not isinstance(r["result"], str)
                for r in results[:-1]
            )
        ):
            raise DatabaseOperationError(
                "INDEX_COMMIT_UNKNOWN: incomplete or unrecognized abort"
            )
        # Only a complete supported abort envelope allows definitive domain
        # classification. Never expose its SQL/server/vector diagnostic body.
        for code in (
            "SCOPE_CHANGED",
            "ATTEMPT_CANCELLED",
            "ATTEMPT_NOT_REGISTERED",
            "INDEX_INTEGRITY",
        ):
            if any(code in error for error in errors):
                _fail(code)
        raise DatabaseOperationError("INDEX_COMMIT_REJECTED: transaction aborted")
    if len(results) != 2 or any(r["result"] != receipt for r in results):
        raise DatabaseOperationError(
            "INDEX_COMMIT_UNKNOWN: missing commit/publication receipt"
        )
    return {"ack": True}


class EvidenceEmbeddingRepository:
    def __init__(self, *, query=None):
        self._query = query or repo_query

    async def query(self, sql: str, params: dict | None = None):
        """All read/single-statement failures have a non-diagnostic boundary.

        The underlying repo_query logs sanitized metadata but rethrows its raw
        error. Preserve cancellation and our exact known-safe domain messages;
        do not trust arbitrary typed exception bodies from a query adapter.
        """
        clean_error: InvalidInputError | DatabaseOperationError = (
            DatabaseOperationError(
                "INDEX_READ_UNAVAILABLE: evidence metadata query failed"
            )
        )
        try:
            return await self._query(sql, params)
        except asyncio.CancelledError:
            raise
        except (InvalidInputError, DatabaseOperationError) as exc:
            safe_codes = {
                "NO_SOURCES_SELECTED",
                "SOURCE_LIMIT",
                "SCOPE_CHANGED",
                "INDEX_NOT_READY",
                "INDEX_STALE",
                "SCOPE_TOO_LARGE",
                "INDEX_INTEGRITY",
                "ATTEMPT_NOT_REGISTERED",
                "ATTEMPT_CANCELLED",
            }
            safe_messages = {
                code + ": evidence index prerequisites changed or are unavailable"
                for code in safe_codes
            }
            safe_messages.add("INDEX_READ_UNAVAILABLE: evidence metadata query failed")
            message = str(exc)
            if message in safe_messages:
                # A safe message does not make the original cause/context safe.
                # Preserve semantic classification, never the adapter's object.
                clean_error = (
                    InvalidInputError(message)
                    if isinstance(exc, InvalidInputError)
                    else DatabaseOperationError(message)
                )
        except Exception:
            pass
        # Raise the fresh error outside the handler, including recognized domain
        # errors: neither a raw cause nor implicit context survives this boundary.
        raise clean_error from None

    async def _metadata(
        self, notebook_id: str, version_ids: list[str]
    ) -> list[dict[str, Any]]:
        _identity(notebook_id)
        version_ids = sorted(set(_identity(v) for v in version_ids))
        if not version_ids:
            _fail("NO_SOURCES_SELECTED")
        if len(version_ids) > 20:
            _fail("SOURCE_LIMIT")
        notebook = RecordID.parse(notebook_id)
        rows = await self.query(
            "-- scope-notebook\nSELECT id FROM $notebook_target;",
            {"notebook_target": notebook},
        )
        if len(rows) != 1 or str(rows[0].get("id")) != notebook_id:
            _fail("SCOPE_CHANGED")
        versions = await self.query(
            """-- scope-versions
SELECT id, payload.source_version_id AS source_version_id, payload.source_id AS source_id,
 payload.notebook_id AS notebook_id, payload.status AS status,
 payload.current_extraction_id AS current_extraction_id FROM $targets;""",
            {
                "targets": [_personal_target("version", v) for v in version_ids],
                "version_ids": version_ids,
            },
        )
        by_version = {v.get("source_version_id"): v for v in versions}
        if len(versions) != len(version_ids) or set(by_version) != set(version_ids):
            _fail("SCOPE_CHANGED")
        for v in versions:
            if str(v.get("id")) != str(
                _personal_target("version", v["source_version_id"])
            ):
                _fail("SCOPE_CHANGED")
            if v.get("notebook_id") != notebook_id or v.get("status") not in {
                "ready",
                "partial",
            }:
                _fail("SCOPE_CHANGED")
            _identity(v.get("source_id"))
            _identity(v.get("current_extraction_id"))
        extraction_ids = [by_version[v]["current_extraction_id"] for v in version_ids]
        extractions = await self.query(
            """-- scope-extractions
SELECT id, payload.extraction_id AS extraction_id, payload.source_version_id AS source_version_id,
 payload.notebook_id AS notebook_id, payload.status AS status,
 payload.parser_name AS parser_name, payload.parser_version AS parser_version,
 payload.schema_version AS schema_version, payload.evidence_ids AS evidence_ids FROM $targets;""",
            {
                "targets": [_personal_target("extraction", x) for x in extraction_ids],
                "extraction_ids": extraction_ids,
            },
        )
        by_extraction = {x.get("extraction_id"): x for x in extractions}
        if len(extractions) != len(extraction_ids) or set(by_extraction) != set(
            extraction_ids
        ):
            _fail("SCOPE_CHANGED")
        for x in extractions:
            if str(x.get("id")) != str(
                _personal_target("extraction", x["extraction_id"])
            ):
                _fail("SCOPE_CHANGED")
        sources = [RecordID.parse(by_version[v]["source_id"]) for v in version_ids]
        members = await self.query(
            """-- scope-membership
SELECT in, out FROM reference WHERE out = $notebook_target AND in IN $sources
 AND in IN (SELECT VALUE id FROM $sources);""",
            {"notebook_target": notebook, "sources": sources},
        )
        membership = {
            str(m.get("in")) for m in members if str(m.get("out")) == notebook_id
        }
        result = []
        for vid in version_ids:
            v = by_version[vid]
            x = by_extraction[v["current_extraction_id"]]
            ids = x.get("evidence_ids")
            if (
                v["source_id"] not in membership
                or x.get("source_version_id") != vid
                or x.get("notebook_id") != notebook_id
                or x.get("status") not in {"ready", "partial"}
                or not isinstance(ids, list)
                or any(not isinstance(e, str) or not e or len(e) > 512 for e in ids)
                or len(set(ids)) != len(ids)
            ):
                _fail("SCOPE_CHANGED")
            result.append(
                {
                    "version_id": vid,
                    "source_id": v["source_id"],
                    "extraction_id": x["extraction_id"],
                    "evidence_ids": ids,
                }
            )
        # Only now, after EVERY source's metadata and active membership passed,
        # read bounded canonical evidence identity/hash projections (never text).
        canonical = await self._canonical(notebook_id, result)
        for entry in result:
            entry["canonical"] = [canonical[e] for e in entry["evidence_ids"]]
            entry["manifest_hash"] = _hash(
                [[e["evidence_id"], e["quote_hash"]] for e in entry["canonical"]]
            )
        return result

    async def _canonical(
        self, notebook_id: str, entries: list[dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        evidence_ids = [eid for e in entries for eid in e["evidence_ids"]]
        if len(set(evidence_ids)) != len(evidence_ids):
            _fail("INDEX_INTEGRITY")
        if not evidence_ids:
            return {}
        rows = await self.query(
            """-- canonical-evidence
SELECT id, payload.evidence_id AS evidence_id, payload.source_version_id AS version_id,
 payload.extraction_id AS extraction_id, payload.notebook_id AS notebook_id,
 payload.quote_hash AS quote_hash FROM v1_evidence WHERE id IN $targets AND payload.notebook_id = $notebook_id
 AND [payload.source_version_id, payload.extraction_id] IN $pairs AND app_id IN $evidence_ids
 LIMIT $metadata_limit;""",
            {
                "notebook_id": notebook_id,
                "version_ids": [e["version_id"] for e in entries],
                "pairs": [[e["version_id"], e["extraction_id"]] for e in entries],
                "evidence_ids": evidence_ids,
                "targets": [_personal_target("evidence", eid) for eid in evidence_ids],
                "metadata_limit": len(evidence_ids) + 1,
            },
        )
        by_id = {_identity(row.get("evidence_id")): row for row in rows}
        if len(rows) != len(evidence_ids) or set(by_id) != set(evidence_ids):
            _fail("INDEX_INTEGRITY")
        for entry in entries:
            for eid in entry["evidence_ids"]:
                row = by_id[eid]
                if (
                    str(row.get("id")) != str(_personal_target("evidence", eid))
                    or row.get("notebook_id") != notebook_id
                    or row.get("version_id") != entry["version_id"]
                    or row.get("extraction_id") != entry["extraction_id"]
                    or not isinstance(row.get("quote_hash"), str)
                    or not _DIGEST.fullmatch(row["quote_hash"])
                ):
                    _fail("INDEX_INTEGRITY")
        return by_id

    async def _capture_locked(self, notebook_id: str, version_ids: list[str]):
        metadata = await self._metadata(notebook_id, version_ids)
        ids = [e["version_id"] for e in metadata]
        rows = await self.query(
            "-- scope-epochs\nSELECT version_id, scope_epoch FROM $targets;",
            {
                "targets": [
                    _target("evidence_embedding_scope", notebook_id, v) for v in ids
                ],
                "version_ids": ids,
            },
        )
        epochs = {}
        for row in rows:
            if (
                row.get("version_id") not in ids
                or type(row.get("scope_epoch")) is not int
                or row["scope_epoch"] < 0
                or row["version_id"] in epochs
            ):
                _fail("INDEX_INTEGRITY")
            epochs[row["version_id"]] = row["scope_epoch"]
        for entry in metadata:
            entry["scope_epoch"] = epochs.get(entry["version_id"], 0)
        return ScopeSnapshot(
            notebook_id=notebook_id,
            entries=tuple(
                ScopeEntry(
                    **{
                        k: e[k]
                        for k in (
                            "version_id",
                            "extraction_id",
                            "manifest_hash",
                            "scope_epoch",
                        )
                    }
                )
                for e in metadata
            ),
        ), metadata

    async def capture_scope(
        self, notebook_id: str, version_ids: list[str]
    ) -> ScopeSnapshot:
        if not version_ids:
            _fail("NO_SOURCES_SELECTED")
        async with project_lock(notebook_id):
            return (await self._capture_locked(notebook_id, version_ids))[0]

    async def _assert_locked(self, snapshot: ScopeSnapshot) -> list[dict[str, Any]]:
        current, metadata = await self._capture_locked(
            snapshot.notebook_id, [e.version_id for e in snapshot.entries]
        )
        if current != snapshot:
            _fail("SCOPE_CHANGED")
        return metadata

    async def assert_scope(self, snapshot: ScopeSnapshot) -> None:
        async with project_lock(snapshot.notebook_id):
            await self._assert_locked(snapshot)

    def _params(self, snapshot, profile, metadata, attempt_id=None):
        entries = []
        for row in metadata:
            e = {
                **row,
                "version_target": _personal_target("version", row["version_id"]),
                "extraction_target": _personal_target(
                    "extraction", row["extraction_id"]
                ),
                "source_target": RecordID.parse(row["source_id"]),
                "scope_target": _target(
                    "evidence_embedding_scope", snapshot.notebook_id, row["version_id"]
                ),
            }
            e["canonical"] = [
                {**c, "target": _personal_target("evidence", c["evidence_id"])}
                for c in row["canonical"]
            ]
            entries.append(e)
        return {
            "notebook_id": snapshot.notebook_id,
            "notebook_target": RecordID.parse(snapshot.notebook_id),
            "entries": entries,
            "scope_fingerprint": _hash(snapshot.model_dump()),
            "fence": uuid4().hex,
            **_namespace(profile),
            "attempt_id": attempt_id,
            "attempt_target": _target("evidence_embedding_attempt", attempt_id)
            if attempt_id
            else None,
        }

    async def register_attempt(
        self, attempt_id: str, snapshot: ScopeSnapshot, profile: EmbeddingProfile
    ) -> None:
        """Idempotently bind an attempt; cancellation tombstones never reset."""
        _identity(attempt_id)
        async with project_lock(snapshot.notebook_id):
            metadata = await self._assert_locked(snapshot)
            params = self._params(snapshot, profile, metadata, attempt_id)
            params["profile_target"] = _target(
                "evidence_embedding_profile", profile.fingerprint
            )
            params["profile"] = profile.model_dump(exclude_computed_fields=True)
            await _transaction(
                "-- attempt-register\n"
                + _SCOPE_GUARD
                + """
LET $existing = (SELECT * FROM $attempt_target)[0];
IF $existing.cancelled = true { THROW "ATTEMPT_CANCELLED"; };
IF $existing != NONE AND ($existing.scope_fingerprint != $scope_fingerprint OR $existing.namespace != $namespace OR $existing.dimension != $dimension OR $existing.preprocessing_revision != $preprocessing_revision) { THROW "INDEX_INTEGRITY"; };
UPSERT $attempt_target SET attempt_id = $attempt_id, notebook_id = $notebook_id, scope_fingerprint = $scope_fingerprint, namespace = $namespace, dimension = $dimension, preprocessing_revision = $preprocessing_revision, cancelled = false, fence = $fence;
UPSERT $profile_target CONTENT $profile;
""",
                params,
                operation="register_attempt",
            )

    async def cancel_attempt(self, attempt_id: str) -> None:
        """Attempt-local durable fence, including cancel-before-first-batch."""
        _identity(attempt_id)
        await _transaction(
            """-- attempt-cancel
UPSERT $attempt_target SET attempt_id = $attempt_id, cancelled = true, fence = $fence;
""",
            {
                "attempt_id": attempt_id,
                "attempt_target": _target("evidence_embedding_attempt", attempt_id),
                "fence": uuid4().hex,
            },
            operation="cancel_attempt",
        )

    def _checked_rows(
        self,
        rows,
        snapshot,
        profile,
        metadata,
        *,
        attempt_id=None,
        payload=False,
        stored=False,
    ):
        entries = {e["version_id"]: e for e in metadata}
        seen = set()
        for row in rows:
            e = entries.get(row.get("version_id"))
            if (
                not e
                or row.get("notebook_id") != snapshot.notebook_id
                or row.get("extraction_id") != e["extraction_id"]
                or row.get("manifest_hash") != e["manifest_hash"]
                or type(row.get("scope_epoch")) is not int
                or type(row.get("dimension")) is not int
                or row.get("scope_epoch") != e["scope_epoch"]
                or any(row.get(k) != v for k, v in _namespace(profile).items())
                or (attempt_id is not None and row.get("attempt_id") != attempt_id)
            ):
                _fail("INDEX_INTEGRITY")
            canonical = {c["evidence_id"]: c["quote_hash"] for c in e["canonical"]}
            eid = row.get("evidence_id")
            if (
                eid in seen
                or eid not in canonical
                or row.get("quote_hash") != canonical[eid]
            ):
                _fail("INDEX_INTEGRITY")
            seen.add(eid)
            _identity(row.get("attempt_id"))
            if (stored or "row_key" in row) and row.get("row_key") != _vector_key(
                profile, row
            ):
                _fail("INDEX_INTEGRITY")
            if payload:
                if set(row) - {
                    "id",
                    "row_key",
                    "notebook_id",
                    "version_id",
                    "extraction_id",
                    "manifest_hash",
                    "scope_epoch",
                    "namespace",
                    "dimension",
                    "preprocessing_revision",
                    "attempt_id",
                    "evidence_id",
                    "quote_hash",
                    "vector",
                }:
                    _fail("INDEX_INTEGRITY")
                vector = row.get("vector")
                if (
                    not isinstance(vector, list)
                    or len(vector) != profile.dimension
                    or any(
                        type(n) not in (int, float) or not math.isfinite(n)
                        for n in vector
                    )
                ):
                    _fail("INDEX_INTEGRITY")
                if not math.isclose(
                    math.hypot(*vector), 1.0, rel_tol=1e-5, abs_tol=1e-5
                ):
                    _fail("INDEX_INTEGRITY")
        return rows

    async def write_batch(
        self,
        attempt_id: str,
        snapshot: ScopeSnapshot,
        profile: EmbeddingProfile,
        rows: list[dict],
    ) -> None:
        _identity(attempt_id)
        if not rows or len(rows) > 16:
            _fail("INDEX_INTEGRITY")
        async with project_lock(snapshot.notebook_id):
            metadata = await self._assert_locked(snapshot)
            params = self._params(snapshot, profile, metadata, attempt_id)
            # Accept only complete, explicitly scoped rows; never silently assign
            # a foreign returned vector to the current version.
            self._checked_rows(
                rows, snapshot, profile, metadata, attempt_id=attempt_id, payload=True
            )
            stored = []
            for row in rows:
                key = _vector_key(profile, row)
                stored.append(
                    {
                        **row,
                        "row_key": key,
                        "id": RecordID("evidence_embedding_vector", key),
                    }
                )
            params["rows"] = stored
            await _transaction(
                "-- vector-write\n"
                + _SCOPE_GUARD
                + _ATTEMPT_GUARD
                + """
IF $attempt.published = true { THROW "INDEX_INTEGRITY"; };
FOR $row IN $rows {
    LET $vector_target = $row.id;
    LET $old = (SELECT * FROM $vector_target)[0];
    IF $old != NONE AND $old != $row { THROW "INDEX_INTEGRITY"; };
    IF $old = NONE { CREATE $vector_target CONTENT $row; };
};
""",
                params,
                operation="write_batch",
            )

    async def _status_locked(self, snapshot, profile, metadata):
        rows = await self.query(
            """-- index-manifests
SELECT notebook_id, version_id, extraction_id, manifest_hash, scope_epoch, namespace,
 dimension, preprocessing_revision, attempt_id, expected_count, vector_manifest_hash, state
 FROM evidence_embedding_manifest WHERE notebook_id = $notebook_id AND version_id IN $version_ids
 AND namespace = $namespace AND dimension = $dimension AND preprocessing_revision = $preprocessing_revision;""",
            {
                "notebook_id": snapshot.notebook_id,
                "version_ids": [e.version_id for e in snapshot.entries],
                **_namespace(profile),
            },
        )
        entries = {e.version_id: e for e in snapshot.entries}
        manifests = {}
        stale = False
        for row in rows:
            e = entries.get(row.get("version_id"))
            if (
                not e
                or row.get("notebook_id") != snapshot.notebook_id
                or type(row.get("scope_epoch")) is not int
                or type(row.get("dimension")) is not int
                or any(row.get(k) != v for k, v in _namespace(profile).items())
                or row["version_id"] in manifests
            ):
                _fail("INDEX_INTEGRITY")
            if row.get("state") != "complete" or any(
                row.get(k) != getattr(e, k)
                for k in ("extraction_id", "manifest_hash", "scope_epoch")
            ):
                stale = True
                continue
            if (
                type(row.get("expected_count")) is not int
                or row["expected_count"] < 0
                or not isinstance(row.get("vector_manifest_hash"), str)
                or not _DIGEST.fullmatch(row["vector_manifest_hash"])
            ):
                _fail("INDEX_INTEGRITY")
            _identity(row.get("attempt_id"))
            canonical_entry = next(
                m for m in metadata if m["version_id"] == e.version_id
            )
            canonical = sorted(
                [
                    [c["evidence_id"], c["quote_hash"]]
                    for c in canonical_entry["canonical"]
                ]
            )
            if row["expected_count"] != len(canonical) or row[
                "vector_manifest_hash"
            ] != _hash(canonical):
                _fail("INDEX_INTEGRITY")
            manifests[row["version_id"]] = row
        state = (
            "stale"
            if stale
            else "ready"
            if len(manifests) == len(entries)
            else "not_indexed"
        )
        return {
            "state": state,
            "indexed_version_count": len(manifests),
            "selected_version_count": len(entries),
            "profile_id": profile.profile_id,
            "manifests": list(manifests.values()),
        }

    async def status(self, snapshot, profile) -> dict:
        async with project_lock(snapshot.notebook_id):
            metadata = await self._assert_locked(snapshot)
            return await self._status_locked(snapshot, profile, metadata)

    async def scoped_vectors(
        self, snapshot, profile, row_cap=5000, element_cap=2_000_000
    ) -> list[dict]:
        if (
            type(row_cap) is not int
            or not 1 <= row_cap <= _MAX_ROWS
            or type(element_cap) is not int
            or not 1 <= element_cap <= _MAX_ELEMENTS
        ):
            _fail("SCOPE_TOO_LARGE")
        async with project_lock(snapshot.notebook_id):
            metadata = await self._assert_locked(snapshot)
            status = await self._status_locked(snapshot, profile, metadata)
            if status["state"] != "ready":
                _fail(
                    "INDEX_STALE" if status["state"] == "stale" else "INDEX_NOT_READY"
                )
            manifests = status["manifests"]
            expected = sum(m["expected_count"] for m in manifests)
            if expected > row_cap or expected * profile.dimension > element_cap:
                _fail("SCOPE_TOO_LARGE")
            params = {
                "notebook_id": snapshot.notebook_id,
                **_namespace(profile),
                "bindings": [
                    [
                        m[k]
                        for k in (
                            "version_id",
                            "extraction_id",
                            "attempt_id",
                            "scope_epoch",
                            "manifest_hash",
                        )
                    ]
                    for m in manifests
                ],
                "payload_limit": min(row_cap + 1, element_cap // profile.dimension),
            }
            predicate = """WHERE notebook_id = $notebook_id AND namespace = $namespace AND dimension = $dimension
 AND preprocessing_revision = $preprocessing_revision
 AND [version_id, extraction_id, attempt_id, scope_epoch, manifest_hash] IN $bindings"""
            counts = await self.query(
                "-- vector-count\nSELECT count() AS count FROM evidence_embedding_vector "
                + predicate
                + " GROUP ALL;",
                params,
            )
            if len(counts) > 1 or (
                counts
                and (type(counts[0].get("count")) is not int or counts[0]["count"] < 0)
            ):
                _fail("INDEX_INTEGRITY")
            count = counts[0]["count"] if counts else 0
            # The canonical expected count already passed the legitimate size
            # gate. Any different actual count is corruption, even above caps.
            if count != expected:
                _fail("INDEX_INTEGRITY")
            # Metadata computes ACTUAL array lengths inside DB, without
            # returning vectors. Corrupt dimensions are integrity failures, not
            # a legitimate whole-scope size fallback.
            shape_projection = """row_key, notebook_id, version_id, extraction_id,
 manifest_hash, scope_epoch, namespace, dimension, preprocessing_revision,
 attempt_id, evidence_id, quote_hash,
 IF type::is::array(vector) { array::len(vector) } ELSE { -1 } AS vector_elements"""
            shapes = await self.query(
                "-- vector-shapes\nSELECT "
                + shape_projection
                + " FROM evidence_embedding_vector "
                + predicate
                + " LIMIT $payload_limit;",
                params,
            )
            if len(shapes) != count:
                _fail("INDEX_INTEGRITY")
            self._checked_rows(shapes, snapshot, profile, metadata, stored=True)
            by_version = {m["version_id"]: m for m in manifests}
            for row in shapes:
                if (
                    type(row.get("vector_elements")) is not int
                    or row["vector_elements"] != profile.dimension
                    or row["attempt_id"] != by_version[row["version_id"]]["attempt_id"]
                ):
                    _fail("INDEX_INTEGRITY")
            if sum(row["vector_elements"] for row in shapes) > element_cap:
                _fail("SCOPE_TOO_LARGE")
            # A separate read may race a corrupt/new row. Its projection itself
            # is bounded, regardless of stored dimension/array length. Return
            # actual length alongside it and REJECT a mismatch; never score a
            # truncated vector. Non-numeric/nested components become NULL (and
            # fail strict validation), so they cannot transport arbitrary blobs.
            # Official 2.x-compatible functions: array::slice/map/len and
            # pre-3.0 type checks (3.x renamed these with underscores).
            rows = await self.query(
                "-- vector-payload\nSELECT "
                + shape_projection
                + """,
 IF type::is::array(vector) {
   array::map(array::slice(vector, 0, $dimension), |$component|
     IF type::is::number($component) { <float>$component } ELSE { NULL })
 } ELSE { [] } AS vector FROM evidence_embedding_vector """
                + predicate
                + " LIMIT $payload_limit;",
                params,
            )
            if len(rows) != count or len(rows) * profile.dimension > element_cap:
                _fail("INDEX_INTEGRITY")
            for row in rows:
                actual_elements = row.pop("vector_elements", None)
                if (
                    type(actual_elements) is not int
                    or actual_elements != profile.dimension
                ):
                    _fail("INDEX_INTEGRITY")
            self._checked_rows(
                rows, snapshot, profile, metadata, payload=True, stored=True
            )
            by_version = {m["version_id"]: m for m in manifests}
            if any(
                r["attempt_id"] != by_version[r["version_id"]]["attempt_id"]
                for r in rows
            ):
                _fail("INDEX_INTEGRITY")
            # Canonical row-count completeness as well as manifest metadata.
            if len(rows) != sum(len(e["evidence_ids"]) for e in metadata):
                _fail("INDEX_INTEGRITY")
            await self._assert_locked(snapshot)
            return rows

    async def publish(self, attempt_id, snapshot, profile, expected_count: int) -> dict:
        _identity(attempt_id)
        async with project_lock(snapshot.notebook_id):
            metadata = await self._assert_locked(snapshot)
            count = sum(len(e["evidence_ids"]) for e in metadata)
            if type(expected_count) is not int or expected_count != count:
                _fail("INDEX_INTEGRITY")
            if count > _MAX_ROWS or count * profile.dimension > _MAX_ELEMENTS:
                _fail("SCOPE_TOO_LARGE")
            params = self._params(snapshot, profile, metadata, attempt_id)
            params["version_ids"] = [e.version_id for e in snapshot.entries]
            params["publication_limit"] = count + 1
            rows = await self.query(
                """-- publication-rows
SELECT row_key, notebook_id, version_id, extraction_id, manifest_hash, scope_epoch, namespace,
 dimension, preprocessing_revision, attempt_id, evidence_id, quote_hash FROM evidence_embedding_vector
 WHERE notebook_id = $notebook_id AND version_id IN $version_ids AND namespace = $namespace
 AND dimension = $dimension AND preprocessing_revision = $preprocessing_revision AND attempt_id = $attempt_id
 LIMIT $publication_limit;""",
                params,
            )
            if len(rows) != count:
                _fail("INDEX_INTEGRITY")
            self._checked_rows(rows, snapshot, profile, metadata, attempt_id=attempt_id)
            manifests = []
            for e in metadata:
                canonical = sorted(
                    [[c["evidence_id"], c["quote_hash"]] for c in e["canonical"]]
                )
                manifests.append(
                    {
                        "id": _target(
                            "evidence_embedding_manifest",
                            snapshot.notebook_id,
                            e["version_id"],
                            profile.fingerprint,
                            profile.dimension,
                            profile.preprocessing_revision,
                        ),
                        "notebook_id": snapshot.notebook_id,
                        "version_id": e["version_id"],
                        "extraction_id": e["extraction_id"],
                        "manifest_hash": e["manifest_hash"],
                        "scope_epoch": e["scope_epoch"],
                        **_namespace(profile),
                        "attempt_id": attempt_id,
                        "expected_count": len(canonical),
                        "vector_manifest_hash": _hash(canonical),
                        "state": "complete",
                        "canonical": canonical,
                    }
                )
            params["manifests"] = manifests
            await _transaction(
                "-- manifest-publish\n"
                + _SCOPE_GUARD
                + _ATTEMPT_GUARD
                + """
FOR $manifest IN $manifests {
    LET $actual = SELECT evidence_id, quote_hash FROM evidence_embedding_vector
      WHERE notebook_id = $notebook_id AND version_id = $manifest.version_id AND extraction_id = $manifest.extraction_id
      AND manifest_hash = $manifest.manifest_hash AND scope_epoch = $manifest.scope_epoch
      AND namespace = $namespace AND dimension = $dimension AND preprocessing_revision = $preprocessing_revision
      AND attempt_id = $attempt_id ORDER BY evidence_id;
    IF array::len($actual) != $manifest.expected_count { THROW "INDEX_INTEGRITY"; };
    FOR $canonical IN $manifest.canonical {
        IF array::len(SELECT evidence_id FROM evidence_embedding_vector WHERE notebook_id = $notebook_id
          AND version_id = $manifest.version_id AND extraction_id = $manifest.extraction_id
          AND manifest_hash = $manifest.manifest_hash AND scope_epoch = $manifest.scope_epoch
          AND namespace = $namespace AND dimension = $dimension AND preprocessing_revision = $preprocessing_revision
          AND attempt_id = $attempt_id AND evidence_id = $canonical[0] AND quote_hash = $canonical[1]) != 1 { THROW "INDEX_INTEGRITY"; };
    };
    LET $manifest_target = $manifest.id;
    UPSERT $manifest_target CONTENT $manifest;
};
UPDATE $attempt_target SET published = true, fence = $fence;
""",
                params,
                operation="publish",
            )
            return {
                "state": "ready",
                "indexed_version_count": len(manifests),
                "selected_version_count": len(manifests),
                "attempt_id": attempt_id,
            }

    async def _invalidate_scopes(self, identities: list[tuple[str, str]]) -> None:
        scopes = [
            {
                "notebook_id": nb,
                "version_id": vid,
                "target": _target("evidence_embedding_scope", nb, vid),
            }
            for nb, vid in sorted(
                set((_identity(nb), _identity(vid)) for nb, vid in identities)
            )
        ]
        if not scopes:
            return
        params: dict[str, Any] = {
            "version_ids": [s["version_id"] for s in scopes],
            "scopes": scopes,
            "fence": uuid4().hex,
        }
        # One DB transaction revokes every retained version before ANY cleanup,
        # across all notebooks, including inactive/unlinked historical versions.
        # Shared guard writes conflict with staging/publication in other roots.
        await _transaction(
            """-- epoch-invalidate
FOR $scope IN $scopes {
    LET $scope_target = $scope.target;
    LET $epoch = (SELECT VALUE scope_epoch FROM $scope_target)[0] ?? 0;
    UPSERT $scope_target SET notebook_id = $scope.notebook_id, version_id = $scope.version_id, scope_epoch = $epoch + 1, fence = $fence;
};
""",
            params,
            operation="invalidate",
        )
        for scope in scopes:
            try:
                await self.query(
                    """-- delete-vectors
DELETE evidence_embedding_vector WHERE notebook_id = $notebook_id AND version_id = $version_id
 AND scope_epoch < (SELECT VALUE scope_epoch FROM $scope_target)[0];""",
                    {
                        "notebook_id": scope["notebook_id"],
                        "version_id": scope["version_id"],
                        "scope_target": scope["target"],
                    },
                )
            except Exception:
                logger.warning(
                    "Derived evidence vector cleanup remains pending after scope revocation"
                )

    async def invalidate_locked(
        self, notebook_id: str, version_ids: list[str], reason: str
    ) -> None:
        """Caller owns project barrier; no locks are reacquired.

        Reason is neither stored nor logged; diagnostics can contain user data.
        Tombstone commit precedes cleanup, and cleanup cannot remove newer rows.
        """
        await self._invalidate_scopes([(notebook_id, v) for v in version_ids])

    async def invalidate(
        self, notebook_id: str, version_ids: list[str], reason: str
    ) -> None:
        async with project_lock(notebook_id):
            await self.invalidate_locked(notebook_id, version_ids, reason)

    async def _versions_for_invalidation(self, *, notebook_id=None, source_id=None):
        if notebook_id is None and source_id is None:
            _fail("NO_SOURCES_SELECTED")
        return await self.query(
            """-- invalidate-versions
SELECT payload.source_version_id AS version_id, payload.notebook_id AS notebook_id FROM v1_version
 WHERE ($notebook_id = NONE OR payload.notebook_id = $notebook_id)
 AND ($source_id = NONE OR payload.source_id = $source_id);""",
            {"notebook_id": notebook_id, "source_id": source_id},
        )

    async def invalidate_notebook_locked(self, notebook_id: str) -> None:
        rows = await self._versions_for_invalidation(notebook_id=notebook_id)
        await self.invalidate_locked(
            notebook_id, [r["version_id"] for r in rows], "notebook_delete"
        )

    @asynccontextmanager
    async def source_deletion_barrier(self, source_id: str):
        """Public source deletion keeps related-project locks through cleanup."""
        rows = await self._versions_for_invalidation(source_id=_identity(source_id))
        projects = {_identity(r["notebook_id"]) for r in rows}
        async with AsyncExitStack() as stack:
            for project in sorted(projects):
                await stack.enter_async_context(project_lock(project))
            # Re-read under the barrier; a changed related-project set requires
            # explicit reconciliation, never acquire new locks out of order.
            current = await self._versions_for_invalidation(source_id=source_id)
            if {_identity(r["notebook_id"]) for r in current} - projects:
                _fail("SCOPE_CHANGED")
            await self._invalidate_scopes(
                [(r["notebook_id"], r["version_id"]) for r in current]
            )
            yield

    async def invalidate_source_locked(self, source_id: str) -> None:
        """Already-locked cascade path: atomically revoke ALL source versions.

        Never acquire another project lock from inside a notebook barrier.
        Cross-notebook safety is provided by the same DB guard writes as the
        public path, not by assuming retained versions still have membership.
        """
        rows = await self._versions_for_invalidation(source_id=_identity(source_id))
        await self._invalidate_scopes(
            [(r["notebook_id"], r["version_id"]) for r in rows]
        )

    async def invalidate_source(
        self,
        source_id: str,
        notebook_id: str | None = None,
        *,
        locked_notebook_id: str | None = None,
    ) -> None:
        rows = await self._versions_for_invalidation(
            notebook_id=notebook_id, source_id=_identity(source_id)
        )
        identities = [
            (_identity(r["notebook_id"]), _identity(r["version_id"])) for r in rows
        ]
        projects = {nb for nb, _ in identities}
        # The unlink path holds exactly the requested notebook's project lock.
        # It may not use this escape hatch to acquire unrelated nested locks.
        if locked_notebook_id is not None and (
            notebook_id != locked_notebook_id or projects - {locked_notebook_id}
        ):
            _fail("INDEX_INTEGRITY")
        async with AsyncExitStack() as stack:
            for project in sorted(projects):
                if project != locked_notebook_id:
                    await stack.enter_async_context(project_lock(project))
            await self._invalidate_scopes(identities)

    async def cleanup_staging(self, attempt_id: str) -> None:
        """Fence first; never delete rows referenced by a last-good manifest."""
        await self.cancel_attempt(attempt_id)
        await self.query(
            """-- delete-staging
DELETE evidence_embedding_vector WHERE attempt_id = $attempt_id
 AND attempt_id NOT IN (SELECT VALUE attempt_id FROM evidence_embedding_manifest WHERE state = 'complete');""",
            {"attempt_id": attempt_id},
        )
