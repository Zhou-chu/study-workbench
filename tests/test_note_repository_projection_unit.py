"""Note write and projection policy with isolated database and lock edges."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from open_notebook.database import note_repository as repo
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NoteRevisionConflict,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def boundary(monkeypatch):
    events: list[tuple[str, str | None, str | None] | tuple[str]] = []
    reply = AsyncMock()
    lookup = AsyncMock()

    @asynccontextmanager
    async def hold(note_id=None, notebook_id=None):
        events.append(("enter", note_id, notebook_id))
        try:
            yield
        finally:
            events.append(("exit", note_id, notebook_id))

    async def transact(statement, params):
        events.append(("transaction",))
        return await reply(statement, params)

    monkeypatch.setattr(repo, "mutation_locks", hold)
    monkeypatch.setattr(repo, "_transaction", transact)
    monkeypatch.setattr(repo, "repo_query", lookup)
    return SimpleNamespace(events=events, reply=reply, lookup=lookup)


async def test_create_projects_canonical_fields_and_persisted_snapshot(boundary):
    native = {"id": "note:entry", "title": "Chapter"}
    snapshot = {
        "note_id": "note:entry",
        "notebook_id": "notebook:research",
        "revision": 1,
    }
    boundary.reply.return_value = [{"native": native, "snapshot": snapshot}]
    result = await repo.create_note(
        fields={"title": "Chapter", "content": "Notes", "updated": "ignored"},
        notebook_id="notebook:research",
        snapshot={"citations": []},
    )

    _, params = boundary.reply.await_args.args
    assert str(params["note"]) == params["identity"]
    assert str(params["project"]) == "notebook:research"
    assert params["notebook_identity"] == "notebook:research"
    assert params["fields"] == {"title": "Chapter", "content": "Notes"}
    assert params["snapshot"] == {"citations": []}
    assert result.native["revision"] == 1
    assert result.snapshot == snapshot
    assert boundary.events == [
        ("enter", None, "notebook:research"),
        ("transaction",),
        ("exit", None, "notebook:research"),
    ]
    boundary.lookup.assert_not_awaited()


async def test_blank_note_is_rejected_before_lock_or_write(boundary):
    with pytest.raises(InvalidInputError, match="cannot be empty"):
        await repo.create_note(fields={"content": "  "})
    assert boundary.events == []
    boundary.reply.assert_not_awaited()
    boundary.lookup.assert_not_awaited()


@pytest.mark.parametrize(
    "notebook,lookup,expected",
    [
        ("notebook:research", [], NotFoundError),
        ("notebook:research", [{"id": "notebook:research"}], DatabaseOperationError),
        (None, None, DatabaseOperationError),
    ],
)
async def test_create_conflict_resolves_parent_presence_without_retry(
    boundary, notebook, lookup, expected
):
    boundary.reply.side_effect = repo._AbortedConflict()
    boundary.lookup.return_value = lookup
    with pytest.raises(expected) as caught:
        await repo.create_note(fields={"content": "Notes"}, notebook_id=notebook)
    assert type(caught.value) is expected
    boundary.reply.assert_awaited_once()
    if notebook is None:
        boundary.lookup.assert_not_awaited()
    else:
        boundary.lookup.assert_awaited_once()
        assert str(boundary.lookup.await_args.args[1]["project"]) == notebook


@pytest.mark.parametrize(
    "mode,requires_revision", [("legacy_single_web", False), ("multiclient", True)]
)
async def test_update_carries_expected_revision_and_returns_next(
    boundary, mode, requires_revision
):
    boundary.reply.return_value = [{"native": {"id": "note:entry", "revision": 5}}]
    result = await repo.update_note(
        note_id="note:entry",
        notebook_id="notebook:research",
        fields={"content": "Updated"},
        expected_revision=4,
        mode=mode,
    )
    _, params = boundary.reply.await_args.args
    assert params["expected"] == 4
    assert params["required"] is requires_revision
    assert params["fields"] == {"content": "Updated"}
    assert str(params["note"]) == "note:entry"
    assert result.native["revision"] == 5
    assert result.snapshot is None


async def test_update_conflict_reads_current_revision_once_without_retry(boundary):
    boundary.reply.side_effect = [
        repo._AbortedConflict(),
        [{"native": {"id": "note:entry", "revision": 8}}],
    ]
    with pytest.raises(NoteRevisionConflict) as caught:
        await repo.update_note(
            note_id="note:entry",
            notebook_id="notebook:research",
            fields={"content": "Updated"},
            expected_revision=4,
        )
    assert caught.value.current_revision == 8
    write, read = [call.args[1] for call in boundary.reply.await_args_list]
    assert write["expected"] == 4
    assert "fields" not in read
    assert str(write["note"]) == str(read["note"]) == "note:entry"
    assert str(write["project"]) == str(read["project"]) == "notebook:research"


async def test_project_note_projection_matches_snapshots_by_native_identity(boundary):
    rows = [
        {"id": "note:first", "revision": 3},
        {"id": "note:second"},
    ]
    snapshot = {"note_id": "note:first", "revision": 3}
    boundary.reply.return_value = [None, {"notes": rows, "snapshots": [snapshot]}]

    first, second = await repo.read_project_notes_locked("notebook:research")

    assert first.native["id"] == "note:first"
    assert first.snapshot == snapshot
    assert second.native["revision"] == 1
    assert second.snapshot is None
    assert boundary.reply.await_args.args[1]["identity"] == "notebook:research"


@pytest.mark.parametrize(
    "rebuilt",
    [
        None,
        {
            "notes": [{"id": "note:first", "revision": 3}],
            "snapshots": [{"note_id": "note:first", "revision": 2}],
        },
    ],
)
async def test_project_note_projection_rejects_incomplete_transactions(
    boundary, rebuilt
):
    boundary.reply.return_value = [rebuilt]
    with pytest.raises(DatabaseOperationError, match="coherent|revision"):
        await repo.read_project_notes_locked("notebook:research")


async def test_link_and_delete_work_under_their_note_lock(boundary):
    boundary.reply.return_value = [True]
    await repo.add_to_notebook("note:entry", "notebook:research")
    await repo.delete_note("note:entry")
    assert boundary.events == [
        ("enter", "note:entry", "notebook:research"),
        ("transaction",),
        ("exit", "note:entry", "notebook:research"),
        ("enter", "note:entry", None),
        ("transaction",),
        ("exit", "note:entry", None),
    ]
    add, delete = [call.args for call in boundary.reply.await_args_list]
    assert str(add[1]["project"]) == "notebook:research"
    assert delete[1]["project"] is None
    assert str(add[1]["note"]) == str(delete[1]["note"]) == "note:entry"
