"""Workspace wire compatibility through actual service and ASGI serialization."""

from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from test_v1_evidence_ingest import MemoryStore

from api.personal_service import PersonalService
from api.routers import evidence
from open_notebook.database.note_repository import NoteWriteResult


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "selection",
    [None, {"engine": "future", "reading": ["legacy"], "source_version_ids": []}],
)
@pytest.mark.parametrize("native_text", ["absent", "null"])
async def test_workspace_preserves_null_absence_and_opaque_history(
    monkeypatch, selection, native_text
):
    store = MemoryStore()
    notebook_id = "notebook:synthetic"
    version = {
        "source_id": "source:synthetic",
        "notebook_id": notebook_id,
        "source_version_id": "sv_test",
        "file_path": "originals/synthetic.txt",
        "provenance": {"future": [None, "retained"]},
    }
    await store.put("version", "sv_test", version)
    for kind in ("turn", "job", "legacy_chat"):
        await store.put(
            kind,
            kind,
            {
                "notebook_id": notebook_id,
                "legacy": [None, {"opaque": True}],
                "dispatch_receipt": {
                    "dispatch_ack": "future",
                    "job_id": "job_conflicting",
                    "retry_safe": True,
                    "opaque": [None],
                },
            },
        )
    if selection is not None:
        await store.put("selection", notebook_id, selection)

    async def sources():
        return [SimpleNamespace(id="source:synthetic", title=None)]

    async def get(_):
        return SimpleNamespace(id=notebook_id, name="Synthetic", get_sources=sources)

    native = {"id": "note:native", "revision": 1, "title": None, "content": None}
    native["created"] = datetime(2026, 10, 22, tzinfo=timezone.utc)
    native["updated"] = datetime(2026, 10, 22, 1, 2, 3, 456789, tzinfo=timezone.utc)
    if native_text == "absent":
        native.pop("title")
        native.pop("content")
    personal = {
        "id": "note:personal",
        "revision": 2,
        "title": "Saved",
        "content": "Text",
    }
    snapshot = {
        "citations": [{"source_title": None, "future": [None]}],
        "scope_snapshot": {"future": True},
        "provenance": ["retained"],
        "title": "stale",
    }

    async def bundles(_):
        return [NoteWriteResult(native, None), NoteWriteResult(personal, snapshot)]

    monkeypatch.setattr(evidence.Notebook, "get", get)
    monkeypatch.setattr(
        "open_notebook.database.note_repository.read_project_notes_locked", bundles
    )

    async def no_dispatch(*_):
        pytest.fail("Workspace inspection must not dispatch retained receipts")

    service = PersonalService(store=store, submit=no_dispatch)
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    before = await service.workspace(notebook_id)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    schema = app.openapi()["paths"]["/api/personal/notebooks/{notebook_id}/workspace"][
        "get"
    ]["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema.get("$ref", "").endswith("/WorkspaceResponse")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/personal/notebooks/{notebook_id}/workspace")
    assert response.status_code == 200
    assert response.json() == jsonable_encoder(before)
    assert response.json()["notes"][0] == jsonable_encoder(native)
    assert response.json()["notes"][1] == {**snapshot, **personal}


@pytest.mark.asyncio
async def test_selection_response_preserves_unvalidated_optional_fields(monkeypatch):
    service = PersonalService(store=MemoryStore())
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)

    async def get(_):
        return SimpleNamespace(id="notebook:synthetic")

    monkeypatch.setattr(evidence.Notebook, "get", get)
    monkeypatch.setattr("api.personal_service.now", lambda: "2026-10-22T00:00:00+00:00")
    value = {"engine": "independent", "reading": ["opaque"], "remote_source_ids": None}
    before = await service.save_selection("notebook:synthetic", value)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.patch(
            "/api/personal/notebooks/notebook:synthetic/selection", json=value
        )
    assert response.status_code == 200
    assert response.json() == before
    schema = app.openapi()["paths"]["/api/personal/notebooks/{notebook_id}/selection"][
        "patch"
    ]["responses"]["200"]["content"]["application/json"]["schema"]
    assert schema.get("$ref", "").endswith("/SelectionResponse")


@pytest.mark.asyncio
async def test_personal_note_write_keeps_nullable_remote_citation(monkeypatch):
    """Real citation mapping; only the database and embedding boundaries are fake."""
    from open_notebook.domain.notebook import Note

    async def get(_):
        return SimpleNamespace(id="notebook:synthetic")

    async def create(*, fields, notebook_id, snapshot):
        native = {"id": "note:synthetic", "revision": 1, **fields}
        return NoteWriteResult(
            native,
            {
                **native,
                **snapshot,
                "note_id": native["id"],
                "notebook_id": notebook_id,
                "created_at": "2026-10-22T00:00:00+00:00",
                "updated_at": "2026-10-22T00:00:00+00:00",
            },
        )

    async def embed(_):
        return None

    monkeypatch.setattr(evidence.Notebook, "get", get)
    monkeypatch.setattr("open_notebook.database.note_repository.create_note", create)
    monkeypatch.setattr(Note, "submit_embedding", embed)
    service = PersonalService(store=MemoryStore())
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    value = {
        "content": "Synthetic",
        "citations": [
            {
                "citation_id": "c1",
                "kind": "remote_unmapped",
                "quote": "remote text",
                "source_title": None,
            }
        ],
    }
    before = await service.save_note(
        "notebook:synthetic", evidence.NoteCreateRequest(**value).model_dump()
    )
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/notebooks/notebook:synthetic/notes", json=value
        )
    assert response.status_code == 200
    assert response.json() == before
    citation = response.json()["citations"][0]
    assert citation["source_title"] is None
    assert citation["reference_validity"] == "unverified"
    assert citation["evidence_id"] is None


@pytest.mark.asyncio
async def test_shared_workspace_read_fixture_retains_opaque_wire_fields(monkeypatch):
    """The client read projection must not tighten the server's wire envelope."""
    import json
    from pathlib import Path

    fixture = json.loads(
        (
            Path(__file__).parents[1]
            / "contracts/v1/fixtures/workspace-read-compatibility.json"
        ).read_text()
    )
    payload = None

    class FixtureService:
        async def workspace(self, notebook_id):
            assert notebook_id == "notebook:synthetic"
            return payload

    monkeypatch.setattr(evidence, "PersonalService", FixtureService)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for case in fixture["selections"]:
            payload = {**fixture["workspace"], "selection": case["value"]}
            response = await client.get(
                "/api/personal/notebooks/notebook:synthetic/workspace"
            )
            assert response.status_code == 200, case["name"]
            assert response.json() == payload, case["name"]
            assert (
                "source_version_id" not in response.json()["sources"][0]["versions"][2]
            )
            assert "content" not in response.json()["notes"][1]
