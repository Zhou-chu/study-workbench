"""Legacy responses retain embedding command IDs with the atomic repository boundary."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    from api.main import app
    from open_notebook.database import note_repository as repository
    from open_notebook.domain.notebook import Note

    native = dict(
        id="note:abc123",
        title="Test Note",
        content="Original content",
        note_type="human",
        revision=1,
        created="2026-01-01T00:00:00Z",
        updated="2026-01-01T00:00:00Z",
    )

    async def create(**kwargs):
        return repository.NoteWriteResult(
            native={**native, **kwargs["fields"]}, snapshot=None
        )

    async def update(**kwargs):
        return repository.NoteWriteResult(
            native={**native, **kwargs["fields"], "revision": 2}, snapshot=None
        )

    monkeypatch.setattr(repository, "create_note", create)
    monkeypatch.setattr(repository, "update_note", update)
    monkeypatch.setattr(Note, "get", AsyncMock(return_value=Note(**native)))
    return TestClient(app)


@pytest.mark.parametrize("command_id", ["command:embed123", None])
def test_create_note_returns_command_id(client, monkeypatch, command_id):
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value=command_id),
    )
    response = client.post(
        "/api/notes", json={"content": "Some content", "note_type": "human"}
    )
    assert response.status_code == 200
    assert response.json()["command_id"] == command_id
    assert response.json()["revision"] == 1


@pytest.mark.parametrize("command_id", ["command:embed789", None])
def test_update_note_returns_command_id(client, monkeypatch, command_id):
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value=command_id),
    )
    response = client.put("/api/notes/note:abc123", json={"title": "Updated Title"})
    assert response.status_code == 200
    assert response.json()["command_id"] == command_id
    assert response.json()["content"] == "Original content"
    assert response.json()["title"] == "Updated Title"
    assert response.json()["revision"] == 2
