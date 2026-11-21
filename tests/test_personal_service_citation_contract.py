"""Personal service and actual evidence trust boundary collaboration."""

from unittest.mock import AsyncMock

import pytest
from personal_service_fixture import MemoryStore


@pytest.mark.asyncio
async def test_note_cannot_forge_verified_citation(monkeypatch):
    from api.personal_service import PersonalService

    store = MemoryStore()
    from open_notebook.database import note_repository

    async def create_note(**kwargs):
        return note_repository.NoteWriteResult(
            native={
                "id": "note:test",
                "content": kwargs["fields"]["content"],
                "revision": 1,
            },
            snapshot={**kwargs["snapshot"], "id": "note:test", "revision": 1},
        )

    monkeypatch.setattr(note_repository, "create_note", create_note)
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Note.submit_embedding",
        AsyncMock(return_value=None),
    )
    note = await PersonalService(store).save_note(
        "nb",
        {
            "content": "claim",
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": "ev_missing",
                    "quote": "invented",
                    "reference_validity": "verified",
                }
            ],
            "scope_snapshot": {"source_version_ids": []},
        },
    )
    assert note["citations"][0]["reference_validity"] != "verified"
