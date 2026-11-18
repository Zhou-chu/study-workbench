"""Actual schema, DTO, app and service compatibility without transport."""

import json

import pytest
from starlette.requests import Request
from test_v1_evidence_ingest import MemoryStore
from v1_api_contract_fixtures import CONTRACT, fixture


@pytest.mark.asyncio
async def test_job_fixture_is_real_submission_with_stable_ids(monkeypatch):
    from api.personal_service import PersonalService
    from api.routers.evidence import TurnRequest

    example = fixture("job")
    request = TurnRequest.model_validate(example["request"]).dispatch_payload()
    monkeypatch.setattr("api.personal_service.now", lambda: "2026-01-01T00:00:00+00:00")

    async def submit(command, args):
        assert command == "personal_turn"
        return "command:synthetic"

    service = PersonalService(store=MemoryStore(), submit=submit)
    actual = await service.submit_turn("chat:synthetic", request)
    assert actual == example["response"]
    assert await service.submit_turn("chat:synthetic", request) == actual


@pytest.mark.asyncio
async def test_note_conflict_fixture_matches_implemented_contract():
    from api.main import note_revision_conflict_handler, note_revision_required_handler
    from open_notebook.exceptions import NoteRevisionConflict, NoteRevisionRequired

    example = fixture("note-conflict")
    request = Request({"type": "http", "headers": []})
    response = await note_revision_conflict_handler(request, NoteRevisionConflict(2))
    assert response.status_code == example["status"] == 409
    assert json.loads(response.body) == example["body"]
    response = await note_revision_required_handler(request, NoteRevisionRequired())
    assert response.status_code == 428
    assert json.loads(response.body) == {"detail": {"code": "NOTE_REVISION_REQUIRED"}}
    schema = json.loads(CONTRACT.read_text())
    operation = schema["paths"][
        "/api/personal/notebooks/{notebook_id}/notes/{note_id}"
    ]["patch"]
    assert operation["requestBody"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("NoteUpdateRequest")
    assert (
        "expected_revision"
        in schema["components"]["schemas"]["NoteUpdateRequest"]["properties"]
    )
    assert "409" in operation["responses"]
    assert "428" in operation["responses"]


def test_snapshot_is_unmodified_actual_app_schema():
    from api.main import app

    assert json.loads(CONTRACT.read_text()) == app.openapi()
