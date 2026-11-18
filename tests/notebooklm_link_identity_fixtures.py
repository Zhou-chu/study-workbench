"""Synthetic SQL and actual collaborator fixture for NotebookLM linking."""

from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI

from api.notebooklm_service import get_notebooklm_service
from api.personal_service import PersonalService
from api.personal_store import PersonalStore
from api.routers import evidence, notebooklm

NOTEBOOK = "notebook:synthetic"
# Independently checked against the existing route's UUID5/NAMESPACE_URL identity.
LINK = "link_049a5990-9206-58e5-96eb-233512c8f131"
STAMP = "2026-10-26T00:00:00+00:00"
SENTINEL = "private-sentinel-do-not-echo"


def live(**updates):
    return {
        "link_id": LINK,
        "notebook_id": NOTEBOOK,
        "connection_id": "notebooklm",
        "remote_notebook_id": "remote-current",
        "last_checked_at": STAMP,
        "future_metadata": {"opaque": [None, "retained"]},
        **updates,
    }


@pytest.fixture
def physical(monkeypatch):
    """Fake only the SQL/remote boundaries; keep store hashing/envelopes real."""
    rows = {}
    events: list[tuple[str, Any]] = []
    held = []

    async def query(sql, args=None):
        if sql.startswith("UPSERT"):
            events.append(("put", str(args["target"])))
            rows[str(args["target"])] = deepcopy(args["value"])
            return []
        if sql == "SELECT payload FROM $target;":
            events.append(("get", str(args["target"])))
            row = rows.get(str(args["target"]))
            return [deepcopy(row)] if row is not None else []
        if sql == "SELECT id, payload FROM $targets;":
            targets = args["targets"]
            events.append(("get_many", tuple(str(target) for target in targets)))
            return [
                {"id": target, **deepcopy(rows[str(target)])}
                for target in reversed(targets)
                if str(target) in rows
            ]
        if sql.startswith("SELECT payload FROM v1_"):
            kind = sql.split("FROM ")[1].rstrip(";")
            assert kind != "v1_link", "Link reads must never scan historical rows"
            return [deepcopy(v) for k, v in rows.items() if k.startswith(kind + ":")]
        pytest.fail(f"Unexpected SQL: {sql}")

    @asynccontextmanager
    async def lock(identity):
        events.append(("lock", identity))
        held.append(identity)
        try:
            yield
        finally:
            held.pop()
            events.append(("unlock", identity))

    async def get_notebook(identity):
        assert identity == NOTEBOOK
        events.append(("notebook", identity))

        async def sources():
            return []

        return SimpleNamespace(id=identity, name="Synthetic", get_sources=sources)

    async def notes(identity):
        assert identity == NOTEBOOK
        return []

    async def ensure_connection():
        assert not held, "Remote verification must remain outside the project lock"
        events.append(("connection", "notebooklm"))

    async def all_sources(identity):
        assert not held, "Remote verification must remain outside the project lock"
        events.append(("remote", identity))
        return []

    monkeypatch.setattr("api.personal_store.repo_query", query)
    monkeypatch.setattr(notebooklm.Notebook, "get", get_notebook)
    monkeypatch.setattr(
        "open_notebook.database.note_repository.read_project_notes_locked", notes
    )
    monkeypatch.setattr(notebooklm, "now", lambda: STAMP)
    store = PersonalStore()
    monkeypatch.setattr(store, "project_lock", lock)
    service = PersonalService(store=store)
    remote = SimpleNamespace(
        store=store, _ensure_connection=ensure_connection, all_sources=all_sources
    )
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    app = FastAPI()
    app.include_router(notebooklm.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")
    app.dependency_overrides[get_notebooklm_service] = lambda: remote
    return SimpleNamespace(
        store=store, service=service, remote=remote, rows=rows, events=events, app=app
    )
