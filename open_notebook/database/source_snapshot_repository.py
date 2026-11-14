"""One guarded transaction commits a source snapshot and its idempotency receipt."""

import asyncio

from surrealdb import RecordID

from api.personal_store import record_key
from api.source_snapshot_contracts import (
    SnapshotCommitRejected,
    SnapshotCommitUnknown,
    SnapshotProblem,
)
from open_notebook.database.note_repository import _AUTH, _params, read_note_bundle
from open_notebook.database.repository import (
    db_connection,
    parse_record_ids,
    repo_query,
)
from open_notebook.exceptions import NoteRevisionConflict, NotFoundError


class SourceSnapshotRepository:
    async def read_note(self, notebook_id, note_id):
        return await read_note_bundle(note_id, notebook_id)

    async def check_available(self, notebook_id, result):
        rows = await repo_query(
            """SELECT id FROM $source WHERE id IN (SELECT VALUE in FROM reference WHERE out=$project)
            AND array::len(SELECT id FROM $project)=1
            AND array::len(SELECT id FROM $version WHERE payload.notebook_id=$notebook_identity AND payload.source_id=$source_identity)=1;""",
            {
                "source": RecordID.parse(result["source_id"]),
                "project": RecordID.parse(notebook_id),
                "version": RecordID.parse(
                    record_key("version", result["source_version_id"])
                ),
                "notebook_identity": notebook_id,
                "source_identity": result["source_id"],
            },
        )
        if not rows:
            raise SnapshotProblem("SNAPSHOT_UNAVAILABLE", 410)

    async def commit(self, value):
        notebook_id, origin_id = value["notebook_id"], value["origin_id"]
        params = {
            "project": RecordID.parse(notebook_id),
            "notebook_identity": notebook_id,
            "parent_guard": RecordID("note_write_guard", notebook_id),
            "receipt_id": RecordID.parse(record_key("job", value["job_id"])),
            "request_hash": value["request_hash"],
            "source": RecordID.parse(value["source_id"]),
            "source_identity": value["source_id"],
            "title": value["title"],
            "content": value["content"],
            "receipt": value["receipt"],
            "versions": value["scope_version_ids"],
            "records": [
                {
                    "target": RecordID.parse(record_key(kind, identity)),
                    "value": {"app_id": identity, "payload": record},
                }
                for kind, identity, record in value["records"]
            ],
        }
        if value["origin_kind"] == "note":
            params.update(_params(origin_id, notebook_id))
            params.update(
                expected=value["origin_revision"],
                expected_scope=value["metadata"].get("scope_snapshot") or {},
                expected_citations=value["metadata"].get("citations") or [],
            )
            authorize = (
                _AUTH
                + """
IF $revision != $expected { THROW "NOTE_REVISION_CONFLICT"; };
IF ($native.title ?? '') != $title OR ($native.content ?? '') != $content { THROW "NOTE_REVISION_CONFLICT"; };
LET $scoped_snapshot = IF $old_snapshot.notebook_id = $notebook_identity { $old_snapshot } ELSE { NONE };
IF ($scoped_snapshot.scope_snapshot ?? {}) != $expected_scope OR ($scoped_snapshot.citations ?? []) != $expected_citations { THROW "NOTE_REVISION_CONFLICT"; };
UPSERT $note_guard SET token = rand::uuid();
"""
            )
        else:
            params.update(
                turn=RecordID.parse(record_key("turn", origin_id)),
                expected_turn=value["original"],
            )
            authorize = """
LET $turn_payload = (SELECT VALUE payload FROM $turn)[0];
IF $turn_payload = NONE OR $turn_payload.notebook_id != $notebook_identity { THROW "SNAPSHOT_NOT_FOUND"; };
IF $turn_payload.status != 'succeeded' OR $turn_payload != $expected_turn { THROW "RESULT_NOT_READY"; };
"""
        body = (
            """
IF array::len(SELECT id FROM $project) != 1 { THROW "SNAPSHOT_NOT_FOUND"; };
LET $old_receipt = (SELECT VALUE payload FROM $receipt_id)[0];
IF $old_receipt != NONE {
    IF $old_receipt.request_hash != $request_hash OR $old_receipt.notebook_id != $notebook_identity OR $old_receipt.operation != 'source_snapshot' { THROW "SNAPSHOT_IDEMPOTENCY_CONFLICT"; };
    IF array::len(SELECT id FROM $source) != 1 OR array::len(SELECT id FROM reference WHERE in=$source AND out=$project) != 1 OR array::len(SELECT id FROM v1_version WHERE app_id=$old_receipt.result.source_version_id AND payload.notebook_id=$notebook_identity AND payload.source_id=$source_identity) != 1 { THROW "SNAPSHOT_UNAVAILABLE"; };
    RETURN {receipt: $old_receipt, existing: true};
} ELSE {
"""
            + authorize
            + """
    UPSERT $parent_guard SET token = rand::uuid();
    LET $valid_versions = SELECT app_id FROM v1_version WHERE app_id IN $versions AND payload.notebook_id = $notebook_identity;
    IF array::len($valid_versions) != array::len($versions) { THROW "SOURCE_OUT_OF_SCOPE"; };
    CREATE $source CONTENT {title: $title, topics: []};
    RELATE $source->reference->$project;
    FOR $item IN $records {
        LET $target = $item.target;
        CREATE $target CONTENT $item.value;
    };
    RETURN {receipt: $receipt, existing: false};
};
"""
        )
        try:
            async with db_connection() as connection:
                response = await connection.query_raw(
                    "BEGIN TRANSACTION;\n" + body + "\nCOMMIT TRANSACTION;", params
                )
        except (Exception, asyncio.CancelledError) as exc:
            raise SnapshotCommitUnknown() from exc
        if isinstance(response, dict) and response.get("error"):
            raise SnapshotCommitRejected(
                "Snapshot query rejected: " + str(response["error"])
            )
        results = response.get("result", []) if isinstance(response, dict) else []
        if not results or any(
            not isinstance(row, dict) or row.get("status") not in ("OK", "ERR")
            for row in results
        ):
            raise SnapshotCommitUnknown()
        errors = [str(row.get("result")) for row in results if row["status"] == "ERR"]
        if errors:
            joined = "; ".join(errors)
            if "SNAPSHOT_NOT_FOUND" in joined or "NOTE_NOT_FOUND" in joined:
                raise NotFoundError("Snapshot origin not found")
            if "SNAPSHOT_IDEMPOTENCY_CONFLICT" in joined:
                raise SnapshotProblem("SNAPSHOT_IDEMPOTENCY_CONFLICT", 409)
            if "SNAPSHOT_UNAVAILABLE" in joined:
                raise SnapshotProblem("SNAPSHOT_UNAVAILABLE", 410)
            if "RESULT_NOT_READY" in joined:
                raise SnapshotProblem("RESULT_NOT_READY", 409)
            if "SOURCE_OUT_OF_SCOPE" in joined:
                raise SnapshotProblem("SOURCE_OUT_OF_SCOPE", 400)
            if "NOTE_REVISION_CONFLICT" in joined:
                bundle = await self.read_note(notebook_id, origin_id)
                raise NoteRevisionConflict(bundle.native["revision"])
            # Definite aborted conflicts may safely be retried with the same key.
            raise SnapshotCommitRejected(
                "Source snapshot transaction rolled back: " + joined
            )
        for item in reversed(parse_record_ids([row.get("result") for row in results])):
            if (
                isinstance(item, dict)
                and isinstance(item.get("receipt"), dict)
                and item["receipt"].get("job_id") == value["job_id"]
            ):
                receipt = item["receipt"]
                return {
                    **receipt,
                    "result": {**receipt["result"], "existing": item["existing"]},
                }
        raise SnapshotCommitUnknown()
