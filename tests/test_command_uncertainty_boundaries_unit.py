"""Note.save retains its committed content on uncertain mocked embedding submission."""

from unittest.mock import AsyncMock

import pytest

from open_notebook.domain.notebook import Note
from open_notebook.exceptions import CommandSubmissionUnknownError


@pytest.mark.asyncio
async def test_automatic_note_embedding_still_preserves_saved_content(monkeypatch):
    from open_notebook.database.note_repository import NoteWriteResult

    note = Note(id="note:fixture", content="body")
    commit = AsyncMock(
        return_value=NoteWriteResult(
            native={"id": note.id, "content": "body", "revision": 2}, snapshot=None
        )
    )
    monkeypatch.setattr("open_notebook.database.note_repository.update_note", commit)
    submit = AsyncMock(side_effect=CommandSubmissionUnknownError())
    monkeypatch.setattr("open_notebook.domain.notebook.submit_command", submit)
    assert await note.save() is None
    assert note.content == "body" and note.revision == 2
    commit.assert_awaited_once()
    submit.assert_awaited_once()
