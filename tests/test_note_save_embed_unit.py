"""Isolated business logic with external I/O doubles; no live services."""

from unittest.mock import AsyncMock

import pytest

from open_notebook.domain.notebook import Note


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
