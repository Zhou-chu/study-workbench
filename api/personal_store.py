"""V1 metadata in the existing SurrealDB; file locks coordinate API and worker.

The locks are advisory and require a shared data filesystem, as does Open
Notebook itself. Callers take the project lock around short commit/snapshot
sections; never hold it over a remote call or a CPU extraction.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from surrealdb import RecordID

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


def data_root() -> Path:
    return Path(os.getenv("STUDY_WORKBENCH_DATA_DIR", "data/personal")).resolve()


def record_key(kind: str, identity: str) -> str:
    if kind not in KINDS:
        raise ValueError("Unknown personal record kind")
    if not isinstance(identity, str) or not identity or len(identity) > 512:
        raise ValueError("Invalid record identity")
    return f"v1_{kind}:" + hashlib.sha256(identity.encode()).hexdigest()


@asynccontextmanager
async def project_lock(notebook_id: str, root: Path | None = None):
    folder = (root or data_root()) / ".locks"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (hashlib.sha256(notebook_id.encode()).hexdigest() + ".lock")
    handle = path.open("a+b")
    # A polling nonblocking lock avoids leaking a lock held by a cancelled
    # to_thread operation. No remote call or worker wait lives inside this lock.
    try:
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                await asyncio.sleep(0.01)
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


class PersonalStore:
    async def get(self, kind: str, identity: str) -> dict[str, Any] | None:
        target = RecordID.parse(record_key(kind, identity))
        rows = await repo_query("SELECT payload FROM $target;", {"target": target})
        return rows[0]["payload"] if rows else None

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

    def project_lock(self, notebook_id: str):
        return project_lock(notebook_id)


_store = PersonalStore()


def get_store() -> PersonalStore:
    return _store
