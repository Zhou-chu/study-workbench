"""Direct notebook note-route decisions; storage, model and queue boundaries are fake."""

import asyncio
import sys
from dataclasses import dataclass
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from api.models import NoteCreate, NoteUpdate
from api.routers import notes
from open_notebook.database import note_repository
from open_notebook.domain.notebook import Note, Notebook
from open_notebook.exceptions import (
    DatabaseOperationError,
    NoteCommitOutcomeUnknown,
    NoteRevisionConflict,
    NoteRevisionRequired,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio
NOTE_ID = "note:fixture"
NOTEBOOK_ID = "notebook:fixture"


@dataclass
class Boundaries:
    note_get: AsyncMock
    note_all: AsyncMock
    notebook_get: AsyncMock
    notebook_notes: AsyncMock
    note_save: AsyncMock
    note_delete: AsyncMock
    commit: AsyncMock
    embedding: AsyncMock
    prompt: AsyncMock
    mode: Mock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    saved = Note(
        id=NOTE_ID, title="Existing", content="原文", note_type="human", revision=3
    )

    async def save(note: Note, **kwargs: object) -> str:
        note.id = NOTE_ID
        return "command:created"

    note_save = AsyncMock(side_effect=save)

    async def save_boundary(note: Note, **kwargs: object) -> str:
        return await note_save(note, **kwargs)

    result = note_repository.NoteWriteResult(
        native={
            "id": NOTE_ID,
            "title": "Saved",
            "content": "提交时正文",
            "note_type": "ai",
            "revision": 4,
        },
        snapshot=None,
    )
    b = Boundaries(
        note_get=AsyncMock(return_value=saved),
        note_all=AsyncMock(return_value=[saved]),
        notebook_get=AsyncMock(
            return_value=Notebook(id=NOTEBOOK_ID, name="Notebook", description="")
        ),
        notebook_notes=AsyncMock(return_value=[saved]),
        note_save=note_save,
        note_delete=AsyncMock(),
        commit=AsyncMock(return_value=result),
        embedding=AsyncMock(return_value="command:updated"),
        prompt=AsyncMock(return_value={"output": "生成的标题"}),
        mode=Mock(return_value="legacy"),
    )
    for obj, name, value in (
        (Note, "get", b.note_get),
        (Note, "get_all", b.note_all),
        (Note, "save", save_boundary),
        (Note, "delete", b.note_delete),
        (Note, "submit_embedding", b.embedding),
        (Notebook, "get", b.notebook_get),
        (Notebook, "get_notes", b.notebook_notes),
        (note_repository, "update_note", b.commit),
    ):
        monkeypatch.setattr(obj, name, value)
    config = ModuleType("open_notebook.config")
    config.__dict__["get_note_write_mode"] = b.mode
    prompt = ModuleType("open_notebook.graphs.prompt")
    prompt.__dict__["graph"] = SimpleNamespace(ainvoke=b.prompt)
    monkeypatch.setitem(sys.modules, config.__name__, config)
    monkeypatch.setitem(sys.modules, prompt.__name__, prompt)
    return b


@pytest.mark.parametrize("notebook_id", [None, NOTEBOOK_ID])
async def test_list_selects_global_or_notebook_scope_and_projects_revision(
    io: Boundaries, notebook_id: str | None
) -> None:
    (item,) = await notes.get_notes(notebook_id)
    assert (item.id, item.revision, item.title, item.content) == (
        NOTE_ID,
        3,
        "Existing",
        "原文",
    )
    if notebook_id is None:
        io.note_all.assert_awaited_once_with(order_by="updated desc")
        io.notebook_get.assert_not_awaited()
    else:
        io.notebook_get.assert_awaited_once_with(NOTEBOOK_ID)
        io.notebook_notes.assert_awaited_once()
        io.note_all.assert_not_awaited()


async def test_detail_keeps_required_nullable_fields_and_revision(
    io: Boundaries,
) -> None:
    io.note_get.return_value = Note(id=NOTE_ID, revision=8)
    item = await notes.get_note(NOTE_ID)
    assert item.model_dump() == {
        "id": NOTE_ID,
        "revision": 8,
        "title": None,
        "content": None,
        "note_type": None,
        "created": "None",
        "updated": "None",
        "command_id": None,
    }
    io.note_get.assert_awaited_once_with(NOTE_ID)


@pytest.mark.parametrize(
    ("note_type", "title", "expected_title", "generates"),
    [
        ("human", None, None, False),
        (None, None, None, False),
        ("ai", "Pinned title", "Pinned title", False),
        ("ai", None, "生成的标题", True),
    ],
)
async def test_create_selects_title_and_reports_saved_note_receipt(
    io: Boundaries,
    note_type: str | None,
    title: str | None,
    expected_title: str | None,
    generates: bool,
) -> None:
    response = await notes.create_note(
        NoteCreate(
            title=title, content="正文", note_type=note_type, notebook_id=NOTEBOOK_ID
        )
    )

    assert (response.id, response.revision, response.title, response.content) == (
        NOTE_ID,
        1,
        expected_title,
        "正文",
    )
    assert response.note_type == note_type and response.command_id == "command:created"
    assert io.note_save.await_args is not None
    assert io.note_save.await_args.kwargs == {"notebook_id": NOTEBOOK_ID}
    assert io.prompt.await_count == int(generates)
    if generates:
        assert io.prompt.await_args is not None
        assert io.prompt.await_args.args[0]["input_text"] == "正文"


async def test_create_with_no_title_in_model_result_keeps_fallback(
    io: Boundaries,
) -> None:
    io.prompt.return_value = {}
    result = await notes.create_note(NoteCreate(content="正文", note_type="ai"))
    assert result.title == "Untitled Note"
    io.note_save.assert_awaited_once()


@pytest.mark.parametrize("entry", ["create", "update"])
async def test_invalid_note_type_never_writes_or_queues(
    io: Boundaries, entry: str
) -> None:
    with pytest.raises(HTTPException) as caught:
        if entry == "create":
            await notes.create_note(
                NoteCreate(content="Text", note_type="unrecognized")
            )
        else:
            await notes.update_note(NOTE_ID, NoteUpdate(note_type="unrecognized"))
    assert (caught.value.status_code, caught.value.detail) == (
        400,
        "note_type must be 'human' or 'ai'",
    )
    io.note_save.assert_not_awaited()
    io.commit.assert_not_awaited()
    io.embedding.assert_not_awaited()


async def test_create_rejects_blank_content_before_persistence(io: Boundaries) -> None:
    with pytest.raises(HTTPException) as caught:
        await notes.create_note(NoteCreate(content=" \t "))
    assert (caught.value.status_code, caught.value.detail) == (
        400,
        "Note content cannot be empty",
    )
    io.prompt.assert_not_awaited()
    io.note_save.assert_not_awaited()


@pytest.mark.parametrize(
    ("mode", "revision", "update", "expected_fields"),
    [
        ("legacy", None, {"title": ""}, {"title": ""}),
        ("legacy", 3, {"note_type": "ai"}, {"note_type": "ai"}),
        ("multiclient", 3, {"content": "新草稿", "title": None}, {"content": "新草稿"}),
    ],
)
async def test_edit_commits_supplied_fields_and_projects_repository_acknowledgment(
    io: Boundaries,
    mode: str,
    revision: int | None,
    update: dict[str, str | None],
    expected_fields: dict[str, str],
) -> None:
    io.mode.return_value = mode
    item = await notes.update_note(
        NOTE_ID, NoteUpdate(expected_revision=revision, **update)
    )
    io.commit.assert_awaited_once_with(
        note_id=NOTE_ID, expected_revision=revision, fields=expected_fields, mode=mode
    )
    assert (
        item.title,
        item.content,
        item.note_type,
        item.revision,
        item.command_id,
    ) == ("Saved", "提交时正文", "ai", 4, "command:updated")
    io.embedding.assert_awaited_once()
    io.note_save.assert_not_awaited()


async def test_edit_multiclient_requires_revision_before_commit(io: Boundaries) -> None:
    io.mode.return_value = "multiclient"
    with pytest.raises(NoteRevisionRequired):
        await notes.update_note(NOTE_ID, NoteUpdate(title="Draft"))
    io.commit.assert_not_awaited()
    io.embedding.assert_not_awaited()


@pytest.mark.parametrize("failure", ["conflict", "unknown", "cancelled"])
async def test_edit_preserves_failed_commit_identity_without_embedding_or_retry(
    io: Boundaries,
    failure: str,
) -> None:
    error: BaseException
    if failure == "conflict":
        error = NoteRevisionConflict(current_revision=5)
    elif failure == "unknown":
        error = NoteCommitOutcomeUnknown("Unconfirmed")
    else:
        error = asyncio.CancelledError()
    io.commit.side_effect = error
    with pytest.raises(type(error)) as caught:
        await notes.update_note(NOTE_ID, NoteUpdate(expected_revision=3, title="Draft"))
    assert caught.value is error
    if isinstance(error, NoteRevisionConflict):
        assert error.current_revision == 5
    io.commit.assert_awaited_once()
    io.embedding.assert_not_awaited()


@pytest.mark.parametrize(
    ("entry", "detail"),
    [
        ("list", "Notebook not found"),
        ("create", "Notebook not found"),
        ("get", "Note not found"),
        ("update", "Note not found"),
        ("delete", "Note not found"),
    ],
)
async def test_missing_resource_maps_to_actionable_not_found(
    io: Boundaries, entry: str, detail: str
) -> None:
    unavailable = NotFoundError("Synthetic missing record")
    io.note_get.side_effect = unavailable
    io.notebook_get.side_effect = unavailable
    io.note_save.side_effect = unavailable
    with pytest.raises(HTTPException) as caught:
        if entry == "list":
            await notes.get_notes(NOTEBOOK_ID)
        elif entry == "create":
            await notes.create_note(NoteCreate(content="text", notebook_id=NOTEBOOK_ID))
        elif entry == "get":
            await notes.get_note(NOTE_ID)
        elif entry == "update":
            await notes.update_note(NOTE_ID, NoteUpdate())
        else:
            await notes.delete_note(NOTE_ID)

    assert (caught.value.status_code, caught.value.detail) == (404, detail)
    io.commit.assert_not_awaited()
    io.note_delete.assert_not_awaited()


async def test_delete_completes_only_after_loaded_note_is_deleted(
    io: Boundaries,
) -> None:
    assert await notes.delete_note(NOTE_ID) == {"message": "Note deleted successfully"}
    io.note_get.assert_awaited_once_with(NOTE_ID)
    io.note_delete.assert_awaited_once()


async def test_delete_preserves_typed_persistence_failure(io: Boundaries) -> None:
    failure = DatabaseOperationError("Synthetic write failure")
    io.note_delete.side_effect = failure
    with pytest.raises(DatabaseOperationError) as caught:
        await notes.delete_note(NOTE_ID)
    assert caught.value is failure
    io.note_delete.assert_awaited_once()
