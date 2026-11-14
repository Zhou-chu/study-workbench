"""
Tests for Note.save()'s embed_note submission resilience
(open_notebook/domain/notebook.py) and its one caller that needs the
opposite behavior (api/routers/embedding.py).

Note.save()'s embed_note submission is now wrapped in try/except: the note
itself is already durably saved by the time it's attempted (verified
against a live embedded SurrealDB instance - see session notes), so a
transient submission failure shouldn't turn an otherwise-successful save
into a 500, unlike Source.vectorize()/add_insight() which are dedicated
"submit this job" calls with nothing useful to fall back on.

The explicit POST /embed endpoint submits embeddings without saving editorial
content or advancing the note revision, and still reports submission failure.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.notebook import Note


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestNoteSaveEmbedResilience:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "content,submission,expected",
        [
            ("some content", "command:xyz789", "command:xyz789"),
            ("some content", RuntimeError("queue down"), None),
            (None, "unused", None),
        ],
    )
    async def test_commit_precedes_best_effort_embedding(
        self, monkeypatch, content, submission, expected
    ):
        from open_notebook.database.note_repository import NoteWriteResult

        events = []

        async def commit(**kwargs):
            events.append("commit")
            return NoteWriteResult(
                native={"id": "note:abc123", **kwargs["fields"], "revision": 2},
                snapshot=None,
            )

        async def submit(*args):
            assert events == ["commit"]
            events.append("submit")
            if isinstance(submission, Exception):
                raise submission
            return submission

        monkeypatch.setattr(
            "open_notebook.database.note_repository.update_note", commit
        )
        monkeypatch.setattr("open_notebook.domain.notebook.submit_command", submit)
        note = Note(id="note:abc123", title="Test", content=content)
        assert await note.save() == expected
        assert note.revision == 2
        assert events == (["commit", "submit"] if content else ["commit"])

    @pytest.mark.asyncio
    async def test_failed_commit_never_submits_embedding(self, monkeypatch):
        from open_notebook.exceptions import NoteRevisionConflict

        async def rejected(**kwargs):
            raise NoteRevisionConflict(2)

        async def submit(*args):
            raise AssertionError("embedding before confirmed commit")

        monkeypatch.setattr(
            "open_notebook.database.note_repository.update_note", rejected
        )
        monkeypatch.setattr("open_notebook.domain.notebook.submit_command", submit)
        note = Note(id="note:abc123", content="draft")
        with pytest.raises(NoteRevisionConflict):
            await note.save()
        assert note.revision == 1


class TestEmbeddingEndpointNoteBranch:
    """api/routers/embedding.py: POST /api/embed with item_type=note."""

    def test_returns_500_when_submission_fails_with_content(self, client):
        note = Note(title="Test", content="some content")
        object.__setattr__(note, "id", "note:abc123")

        with (
            patch("api.routers.embedding.Note.get", new=AsyncMock(return_value=note)),
            patch.object(Note, "submit_embedding", return_value=None),
            patch(
                "open_notebook.ai.models.model_manager.get_embedding_model",
                new=AsyncMock(return_value=object()),
            ),
        ):
            response = client.post(
                "/api/embed",
                json={
                    "item_id": "note:abc123",
                    "item_type": "note",
                    "async_processing": False,
                },
            )

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to submit note embedding job"

    def test_succeeds_when_submission_works(self, client):
        note = Note(title="Test", content="some content")
        object.__setattr__(note, "id", "note:abc123")

        with (
            patch("api.routers.embedding.Note.get", new=AsyncMock(return_value=note)),
            patch.object(Note, "submit_embedding", return_value="command:abc123"),
            patch(
                "open_notebook.ai.models.model_manager.get_embedding_model",
                new=AsyncMock(return_value=object()),
            ),
        ):
            response = client.post(
                "/api/embed",
                json={
                    "item_id": "note:abc123",
                    "item_type": "note",
                    "async_processing": False,
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["command_id"] == "command:abc123"

    def test_succeeds_with_no_command_id_when_note_has_no_content(self, client):
        """A content-less note has nothing to embed - save() correctly
        returns None, and that must NOT be treated as a submission failure."""
        note = Note(title="Test", content=None)
        object.__setattr__(note, "id", "note:abc123")

        with (
            patch("api.routers.embedding.Note.get", new=AsyncMock(return_value=note)),
            patch.object(Note, "submit_embedding", return_value=None),
            patch(
                "open_notebook.ai.models.model_manager.get_embedding_model",
                new=AsyncMock(return_value=object()),
            ),
        ):
            response = client.post(
                "/api/embed",
                json={
                    "item_id": "note:abc123",
                    "item_type": "note",
                    "async_processing": False,
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["command_id"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("field_override", [False, True])
async def test_invalid_mutable_note_fields_never_reach_coordinator(
    monkeypatch, field_override
):
    from pydantic import ValidationError

    calls = []

    async def forbidden(**kwargs):
        calls.append(kwargs)
        raise AssertionError("invalid note reached coordinator")

    monkeypatch.setattr("open_notebook.database.note_repository.update_note", forbidden)
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(side_effect=lambda *a: calls.append(a)),
    )
    note = Note(id="note:synthetic", content="Retained body", note_type="human")
    if not field_override:
        note.note_type = "invalid"  # type: ignore[assignment]
    with pytest.raises(ValidationError):
        await note.save(fields={"note_type": "invalid"} if field_override else None)
    assert calls == []
