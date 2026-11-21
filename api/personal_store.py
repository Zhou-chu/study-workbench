"""V1 metadata in the existing SurrealDB; file locks coordinate API and worker.

The locks are advisory and require a shared data filesystem, as does Open
Notebook itself. Callers take the project lock around short commit/snapshot
sections; never hold it over a remote call or a CPU extraction.
"""

from __future__ import annotations

import hashlib
from typing import Any, List

from surrealdb import RecordID

from open_notebook.database.project_locks import data_root as data_root
from open_notebook.database.project_locks import project_lock
from open_notebook.database.repository import repo_query

KINDS = frozenset(
    {
        "version",
        "extraction",
        "evidence",
        "turn",
        "job",
        "link",
        "source_link",
        "artifact",
        "selection",
        "import_report",
        "connection",
        "note_snapshot",
        "export",
        "legacy_chat",
    }
)
READ_BATCH_SIZE = 128


def record_key(kind: str, identity: str) -> str:
    if kind not in KINDS:
        raise ValueError("Unknown personal record kind")
    if not isinstance(identity, str) or not identity or len(identity) > 512:
        raise ValueError("Invalid record identity")
    return f"v1_{kind}:" + hashlib.sha256(identity.encode()).hexdigest()


class PersonalStore:
    async def get(self, kind: str, identity: str) -> dict[str, Any] | None:
        target = RecordID.parse(record_key(kind, identity))
        rows = await repo_query("SELECT payload FROM $target;", {"target": target})
        return rows[0]["payload"] if rows else None

    async def get_many(
        self, kind: str, identities: list[str]
    ) -> dict[str, dict[str, Any] | None]:
        """Read raw rows by physical identity, with None for absent records.

        Payloads are deliberately not decoded here: a malformed later row must
        not hide an earlier missing row when the caller consumes input order.
        The caller owns ordering, duplicate expansion, and payload validation.
        """
        record_key(kind, "validate")
        targets = {
            identity: RecordID.parse(record_key(kind, identity))
            for identity in identities
        }
        result: dict[str, dict[str, Any] | None] = {}
        items = list(targets.items())
        for offset in range(0, len(items), READ_BATCH_SIZE):
            batch = items[offset : offset + READ_BATCH_SIZE]
            rows = await repo_query(
                "SELECT id, payload FROM $targets;",
                {"targets": [target for _, target in batch]},
            )
            by_target = {str(row["id"]): row for row in rows}
            result.update(
                (identity, by_target.get(str(target))) for identity, target in batch
            )
        return result

    async def list(
        self, kind: str, notebook_id: str | None = None, **filters: Any
    ) -> list[dict[str, Any]]:
        record_key(kind, "validate")
        # Values are bound; the table and fields come solely from allowlists.
        rows = await repo_query(f"SELECT payload FROM v1_{kind};")
        values = [row["payload"] for row in rows]
        if notebook_id is not None:
            filters["notebook_id"] = notebook_id
        return [
            item for item in values if all(item.get(k) == v for k, v in filters.items())
        ]

    async def put(
        self, kind: str, identity: str, value: dict[str, Any], create_only: bool = False
    ) -> dict[str, Any]:
        target = RecordID.parse(record_key(kind, identity))
        operation = "CREATE" if create_only else "UPSERT"
        await repo_query(
            f"{operation} $target CONTENT $value;",
            {"target": target, "value": {"app_id": identity, "payload": value}},
        )
        return value

    async def delete(self, kind: str, identity: str) -> None:
        await repo_query(
            "DELETE $target;", {"target": RecordID.parse(record_key(kind, identity))}
        )

    async def invalidate_evidence_scope(
        self, notebook_id: str, version_ids: List[str], reason: str
    ) -> None:
        """Extraction publisher owns the same project lock; do not reacquire it."""
        from open_notebook.database.evidence_embedding_repository import (
            EvidenceEmbeddingRepository,
        )

        await EvidenceEmbeddingRepository(query=repo_query).invalidate_locked(
            notebook_id, version_ids, reason
        )

    def project_lock(self, notebook_id: str):
        return project_lock(notebook_id)


_store = PersonalStore()


def get_store() -> PersonalStore:
    return _store
