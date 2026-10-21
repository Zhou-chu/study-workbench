"""One atomic editorial writer. Native revision is the only concurrency authority.

Lock order: mutation barrier -> sorted related projects -> one DB transaction.
Project-only readers never enter the mutation barrier. DB predicates, not flock,
protect against writers using independent data roots. Unknown outcomes never retry.
"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from surrealdb import RecordID

from open_notebook.database.note_contract import NoteWriteMode
from open_notebook.database.project_locks import note_mutation_lock, project_lock
from open_notebook.database.repository import (
    db_connection,
    parse_record_ids,
    repo_query,
)
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NoteCommitOutcomeUnknown,
    NoteRevisionConflict,
    NoteRevisionRequired,
    NotFoundError,
)


@dataclass(frozen=True)
class NoteWriteResult:
    native: dict[str, Any]
    snapshot: dict[str, Any] | None


def _snapshot_id(identity):
    return RecordID("v1_note_snapshot", hashlib.sha256(identity.encode()).hexdigest())


def revision(row):
    value = row.get("revision", 1)
    if type(value) is not int or value < 1:
        raise DatabaseOperationError("Corrupt note revision")
    return value


async def _transaction(body, params):
    try:
        async with db_connection() as connection:
            response = await connection.query_raw(
                "BEGIN TRANSACTION;\n" + body + "\nCOMMIT TRANSACTION;", params
            )
    except (Exception, asyncio.CancelledError) as exc:
        raise NoteCommitOutcomeUnknown(
            "Note commit outcome is unknown; read/reconcile before retrying."
        ) from exc
    if isinstance(response, dict) and response.get("error"):
        raise DatabaseOperationError("Note query rejected by database")
    results = response.get("result", []) if isinstance(response, dict) else []
    if not results or any(
        not isinstance(r, dict) or r.get("status") not in ("OK", "ERR") for r in results
    ):
        raise NoteCommitOutcomeUnknown(
            "Note transaction returned no valid acknowledgement; read/reconcile before retrying."
        )
    errors = [str(r.get("result")) for r in results if r["status"] == "ERR"]
    if errors:
        if any("NOTE_SCOPE_CHANGED" in e for e in errors):
            raise InvalidInputError("OUT_OF_SCOPE: note prerequisites changed")
        if any("NOTE_NOT_FOUND" in e for e in errors):
            raise NotFoundError("Note not found")
        if any("NOTE_REVISION_REQUIRED" in e for e in errors):
            raise NoteRevisionRequired()
        # Revision is only read back through an authorized consistent query.
        if any("NOTE_REVISION_CONFLICT" in e or "can be retried" in e for e in errors):
            raise _AbortedConflict()
        raise DatabaseOperationError(
            "Note transaction rejected and rolled back: " + "; ".join(errors)
        )
    if all(r.get("result") is None for r in results):
        raise NoteCommitOutcomeUnknown(
            "Note transaction omitted its acknowledgement; read/reconcile before retrying."
        )
    return parse_record_ids([r.get("result") for r in results])


class _AbortedConflict(DatabaseOperationError):
    """Definitively aborted; caller must reconcile, never blindly retry."""

    def __init__(self):
        super().__init__(
            "Note transaction conflicted and was rolled back; reconcile before retrying"
        )


async def related_projects(note_id):
    rows = await repo_query(
        "SELECT out FROM artifact WHERE in = $note;", {"note": RecordID.parse(note_id)}
    )
    return sorted({str(row["out"]) for row in rows})


@asynccontextmanager
async def mutation_locks(note_id=None, notebook_id=None):
    async with note_mutation_lock():
        projects = set(await related_projects(note_id)) if note_id else set()
        if notebook_id:
            projects.add(notebook_id)
        async with AsyncExitStack() as stack:
            for identity in sorted(projects):
                await stack.enter_async_context(project_lock(identity))
            yield


# Dedicated guard writes make membership changes conflict with deletion:
# Surreal snapshot reads alone permit write skew. Guard records have no user
# timestamps or events, unlike touching native notebook/note rows.
# Authorization precedes every revision observation. A personal snapshot never
# grants membership, and its metadata belongs to exactly one notebook.
_AUTH = """
LET $native = (SELECT * FROM $note)[0];
IF $native = NONE { THROW "NOTE_NOT_FOUND"; };
IF $project != NONE {
    IF array::len(SELECT id FROM $project) = 0 OR array::len(SELECT id FROM artifact WHERE in = $note AND out = $project) = 0 { THROW "NOTE_NOT_FOUND"; };
};
LET $old_snapshot = (SELECT VALUE payload FROM $snapshot_id)[0];
LET $revision = IF $native.revision = NONE { 1 } ELSE { $native.revision };
IF type::is::int($revision) = false OR $revision < 1 { THROW "CORRUPT_NOTE_REVISION"; };
IF $old_snapshot != NONE {
    LET $snapshot_revision = IF $old_snapshot.revision = NONE { 1 } ELSE { $old_snapshot.revision };
    IF type::is::int($snapshot_revision) = false OR $snapshot_revision < 1 OR $snapshot_revision != $revision { THROW "INCONSISTENT_NOTE_REVISION"; };
};
"""


_PREREQUISITES = """
IF $snapshot != NONE {
    LET $versions = $snapshot.scope_snapshot.source_version_ids ?? [];
    LET $valid = SELECT app_id FROM v1_version WHERE app_id IN $versions AND payload.notebook_id = $notebook_identity;
    IF array::len($valid) != array::len(array::distinct($versions)) { THROW "NOTE_SCOPE_CHANGED"; };
    FOR $citation IN ($snapshot.citations ?? []) {
        IF $citation.reference_validity = "verified" {
            LET $evidence = SELECT id FROM v1_evidence WHERE app_id = $citation.evidence_id AND payload.notebook_id = $notebook_identity AND payload.source_version_id IN $versions;
            IF array::len($evidence) != 1 { THROW "NOTE_SCOPE_CHANGED"; };
        };
    };
};
"""


def _params(note_id, notebook_id):
    return {
        "note": RecordID.parse(note_id),
        "project": RecordID.parse(notebook_id) if notebook_id else None,
        "snapshot_id": _snapshot_id(note_id),
        "note_guard": RecordID("note_write_guard", note_id),
        "parent_guard": RecordID("note_write_guard", notebook_id)
        if notebook_id
        else None,
    }


def _bundle(results, notebook_id=None):
    for result in reversed(results):
        if isinstance(result, dict) and "native" in result:
            native, snapshot = result["native"], result.get("snapshot")
            native["revision"] = revision(native)
            if snapshot:
                if revision(snapshot) != native["revision"]:
                    raise DatabaseOperationError("Inconsistent note snapshot revision")
                if notebook_id and snapshot.get("notebook_id") != notebook_id:
                    snapshot = None
            return NoteWriteResult(native, snapshot)
    raise NoteCommitOutcomeUnknown(
        "Note transaction omitted its result; read/reconcile before retrying."
    )


async def read_note_bundle(note_id: str, notebook_id: str | None = None):
    return _bundle(
        await _transaction(
            _AUTH + "RETURN { native: $native, snapshot: $old_snapshot };",
            _params(note_id, notebook_id),
        ),
        notebook_id,
    )


async def read_project_notes_locked(notebook_id):
    """Caller owns project barrier. One consistent transaction for all note data."""
    results = await _transaction(
        """
    LET $notes = SELECT * OMIT embedding FROM note WHERE id IN (SELECT VALUE in FROM artifact WHERE out = $project);
    LET $snapshots = SELECT VALUE payload FROM v1_note_snapshot WHERE payload.notebook_id = $identity;
    RETURN { notes: $notes, snapshots: $snapshots };
    """,
        {"project": RecordID.parse(notebook_id), "identity": notebook_id},
    )
    result = next(
        (r for r in reversed(results) if isinstance(r, dict) and "notes" in r), None
    )
    if result is None:
        raise DatabaseOperationError("Missing coherent note read")
    snapshots = {r["note_id"]: r for r in result["snapshots"]}
    bundles = []
    for native in result["notes"]:
        native["revision"] = revision(native)
        snapshot = snapshots.get(native["id"])
        if snapshot and revision(snapshot) != native["revision"]:
            raise DatabaseOperationError("Inconsistent note snapshot revision")
        bundles.append(NoteWriteResult(native, snapshot))
    return bundles


def _editorial_fields(fields):
    # Validate before commit; constructing the refreshed domain model afterwards
    # must not be the first time invalid editorial content is rejected.
    values = {k: v for k, v in fields.items() if k in ("title", "content", "note_type")}
    if isinstance(values.get("content"), str) and not values["content"].strip():
        raise InvalidInputError("Note content cannot be empty")
    return values


async def create_note(*, fields, notebook_id=None, snapshot=None):
    identity = "note:" + uuid4().hex
    params = _params(identity, notebook_id)
    params.update(
        fields=_editorial_fields(fields),
        snapshot=snapshot,
        identity=identity,
        notebook_identity=notebook_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    body = (
        _PREREQUISITES
        + """
    IF $project != NONE AND array::len(SELECT id FROM $project) = 0 { THROW "NOTE_NOT_FOUND"; };
    IF $project != NONE { UPSERT $parent_guard SET token = rand::uuid(); };
    UPSERT $note_guard SET token = rand::uuid();
    LET $native = (CREATE $note CONTENT object::from_entries(array::concat(object::entries($fields), object::entries({revision: 1, embedding: []}))))[0];
    IF $project != NONE { RELATE $note->artifact->$project; };
    LET $saved = IF $snapshot != NONE { object::from_entries(array::concat(object::entries($snapshot), object::entries({ id: $identity, note_id: $identity, notebook_id: $notebook_identity, title: $native.title, content: $native.content, revision: 1, created_at: $timestamp, updated_at: $timestamp }))) } ELSE { NONE };
    IF $saved != NONE { CREATE $snapshot_id CONTENT {app_id: $identity, payload: $saved}; };
    RETURN {native: $native, snapshot: $saved};
    """
    )
    async with mutation_locks(notebook_id=notebook_id):
        try:
            return _bundle(await _transaction(body, params), notebook_id)
        except _AbortedConflict:
            if notebook_id and not await repo_query(
                "SELECT id FROM $project;", {"project": params["project"]}
            ):
                raise NotFoundError("Notebook not found") from None
            raise DatabaseOperationError(
                "Note creation transaction conflicted; reconcile before retrying"
            ) from None


async def update_note(
    *,
    note_id,
    notebook_id=None,
    fields,
    snapshot=None,
    expected_revision=None,
    mode: NoteWriteMode = "legacy_single_web",
):
    params = _params(note_id, notebook_id)
    params.update(
        fields=_editorial_fields(fields),
        snapshot=snapshot,
        expected=expected_revision,
        required=mode == "multiclient",
        identity=note_id,
        notebook_identity=notebook_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    body = (
        _AUTH
        + _PREREQUISITES
        + """
    IF $snapshot != NONE AND $old_snapshot != NONE AND $old_snapshot.notebook_id != $notebook_identity { THROW "NOTE_NOT_FOUND"; };
    IF $expected = NONE AND $required { THROW "NOTE_REVISION_REQUIRED"; };
    IF $expected != NONE AND $expected != $revision { THROW "NOTE_REVISION_CONFLICT"; };
    UPSERT $note_guard SET token = rand::uuid();
    LET $updated = (UPDATE $note MERGE object::from_entries(array::concat(object::entries($fields), object::entries({revision: $revision + 1}))) WHERE (revision ?? 1) = $revision)[0];
    IF $updated = NONE { THROW "NOTE_REVISION_CONFLICT"; };
    LET $metadata = $snapshot ?? $old_snapshot;
    LET $saved = IF $metadata != NONE { object::from_entries(array::concat(object::entries($metadata), object::entries({id: $identity, note_id: $identity, notebook_id: $old_snapshot.notebook_id ?? $notebook_identity, title: $updated.title, content: $updated.content, revision: $updated.revision, created_at: $old_snapshot.created_at ?? $timestamp, updated_at: $timestamp}))) } ELSE { NONE };
    IF $saved != NONE { UPSERT $snapshot_id CONTENT {app_id: $identity, payload: $saved}; };
    RETURN {native: $updated, snapshot: $saved};
    """
    )
    async with mutation_locks(note_id, notebook_id):
        try:
            return _bundle(await _transaction(body, params), notebook_id)
        except _AbortedConflict:
            current = await read_note_bundle(note_id, notebook_id)
            raise NoteRevisionConflict(current.native["revision"]) from None


async def _delete_note_locked(note_id):
    await _transaction(
        "UPSERT $note_guard SET token = rand::uuid(); DELETE artifact WHERE in = $note; DELETE $snapshot_id; DELETE $note; RETURN true;",
        _params(note_id, None),
    )


async def delete_note(note_id):
    async with mutation_locks(note_id):
        await _delete_note_locked(note_id)


async def add_to_notebook(note_id, notebook_id):
    async with mutation_locks(note_id, notebook_id):
        await _transaction(
            """
        IF array::len(SELECT id FROM $note) = 0 OR array::len(SELECT id FROM $project) = 0 { THROW "NOTE_NOT_FOUND"; };
        UPSERT $parent_guard SET token = rand::uuid();
        UPSERT $note_guard SET token = rand::uuid();
        RELATE $note->artifact->$project;
        RETURN true;
        """,
            _params(note_id, notebook_id),
        )


@asynccontextmanager
async def notebook_mutation_locks(notebook_id):
    """Own barrier for entire cascade; native notes/parent disappear atomically."""
    async with note_mutation_lock():
        rows = await repo_query(
            "SELECT in FROM artifact WHERE out = $project;",
            {"project": RecordID.parse(notebook_id)},
        )
        projects = {notebook_id}
        for row in rows:
            projects.update(await related_projects(str(row["in"])))
        async with AsyncExitStack() as stack:
            for identity in sorted(projects):
                await stack.enter_async_context(project_lock(identity))
            yield


async def delete_notebook_notes_locked(notebook_id):
    results = await _transaction(
        """
    UPSERT $parent_guard SET token = rand::uuid();
    LET $notes = SELECT VALUE in FROM artifact WHERE out = $project;
    FOR $n IN $notes { UPSERT type::thing("note_write_guard", <string>$n) SET token = rand::uuid(); };
    LET $identities = $notes.map(|$n| <string>$n);
    DELETE v1_note_snapshot WHERE payload.note_id IN $identities;
    DELETE artifact WHERE in IN $notes;
    DELETE note WHERE id IN $notes;
    DELETE $project;
    RETURN {deleted_notes: array::len($notes)};
    """,
        {
            "project": RecordID.parse(notebook_id),
            "parent_guard": RecordID("note_write_guard", notebook_id),
        },
    )
    return next(
        r["deleted_notes"]
        for r in results
        if isinstance(r, dict) and "deleted_notes" in r
    )
