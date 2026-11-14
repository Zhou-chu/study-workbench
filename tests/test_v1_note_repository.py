"""Native transactional note proof; isolated synthetic SurrealDB only."""

import os
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("response", [{"result": []}, {"result": [{"status": "OK"}]}])
async def test_missing_transaction_ack_is_unknown(monkeypatch, response):
    from contextlib import asynccontextmanager

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NoteCommitOutcomeUnknown

    class Connection:
        async def query_raw(self, *args):
            return response

    @asynccontextmanager
    async def connection():
        yield Connection()

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(NoteCommitOutcomeUnknown):
        await repo._transaction("RETURN 1;", {})


@pytest_asyncio.fixture
async def database(monkeypatch):
    if os.getenv("STUDY_WORKBENCH_TEST_SURREAL") != "1":
        pytest.skip("requires isolated synthetic SurrealDB")
    from uuid import uuid4

    from open_notebook.database.async_migrate import (
        AsyncMigrationManager,
        _query_checked,
    )

    assert os.getenv("SURREAL_URL", "").startswith("ws://127.0.0.1:"), (
        "isolated loopback fixture required"
    )
    monkeypatch.setenv("SURREAL_DATABASE", "note_revision_" + uuid4().hex)

    # Exercise the supported fresh schema, not the obsolete 1/2/26/27 subset.
    # Migration 13 makes embeddings optional; editorial writes invalidate them.
    await AsyncMigrationManager().run_migration_up()
    await _query_checked(
        'CREATE notebook:proof SET name="Proof", description="Synthetic"; CREATE notebook:foreign SET name="Foreign", description="Synthetic";'
    )
    yield


async def test_real_cas_snapshot_and_foreign(database, monkeypatch, tmp_path):
    import asyncio

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NoteRevisionConflict, NotFoundError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"title": "Initial", "content": "zero"},
        notebook_id="notebook:proof",
        snapshot={"citations": [], "scope_snapshot": {}},
    )
    assert created.native["revision"] == created.snapshot["revision"] == 1
    identity = created.native["id"]

    async def update(content):
        return await repo.update_note(
            note_id=identity,
            notebook_id="notebook:proof",
            fields={"content": content},
            snapshot={"citations": [{"quote": content}], "scope_snapshot": {}},
            expected_revision=1,
            mode="multiclient",
        )

    outcomes = await asyncio.gather(update("a"), update("b"), return_exceptions=True)
    winner = next(x for x in outcomes if isinstance(x, repo.NoteWriteResult))
    loser = next(x for x in outcomes if isinstance(x, Exception))
    assert isinstance(loser, NoteRevisionConflict)
    assert loser.current_revision == 2
    bundle = await repo.read_note_bundle(identity, "notebook:proof")
    assert bundle.native["revision"] == bundle.snapshot["revision"] == 2
    assert (
        bundle.native["content"]
        == bundle.snapshot["citations"][0]["quote"]
        == winner.native["content"]
    )
    assert bundle.native["created"] == created.native["created"]
    assert bundle.snapshot["created_at"] == created.snapshot["created_at"]
    with pytest.raises(NotFoundError):
        await repo.update_note(
            note_id=identity,
            notebook_id="notebook:foreign",
            fields={"content": "bad"},
            snapshot={},
            expected_revision=1,
            mode="multiclient",
        )


async def test_real_failure_rolls_back(database, tmp_path, monkeypatch):
    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import DatabaseOperationError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    result = await repo.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot={}
    )
    from surrealdb import RecordID

    with pytest.raises(DatabaseOperationError):
        await repo._transaction(
            'UPDATE $note SET content="bad", revision=2; THROW "injected";',
            {"note": RecordID.parse(result.native["id"])},
        )
    bundle = await repo.read_note_bundle(result.native["id"], "notebook:proof")
    assert bundle.native["content"] == bundle.snapshot["content"] == "old"
    assert bundle.native["revision"] == bundle.snapshot["revision"] == 1


async def test_real_domain_stale_delete_and_shared_projection(
    database, monkeypatch, tmp_path
):
    from open_notebook.database import note_repository as repo
    from open_notebook.domain.notebook import Note
    from open_notebook.exceptions import NoteRevisionConflict, NotFoundError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value="synthetic"),
    )
    created = await repo.create_note(
        fields={"content": "old"},
        notebook_id="notebook:proof",
        snapshot={"citations": [{"quote": "private"}]},
    )
    first, second = Note(**created.native), Note(**created.native)
    first.content = "winner"
    await first.save()
    assert first.revision == 2
    second.content = "loser"
    with pytest.raises(NoteRevisionConflict):
        await second.save()
    assert first.id is not None
    await first.add_to_notebook("notebook:foreign")
    foreign = await repo.read_note_bundle(first.id, "notebook:foreign")
    assert foreign.snapshot is None
    assert foreign.native["content"] == "winner"
    owner = await repo.read_note_bundle(first.id, "notebook:proof")
    assert owner.snapshot["citations"] == [{"quote": "private"}]
    assert owner.snapshot["revision"] == 2
    with pytest.raises(NotFoundError):
        await repo.update_note(
            note_id=first.id,
            notebook_id="notebook:foreign",
            fields={"content": "bad"},
            snapshot={},
            expected_revision=1,
        )
    await first.delete()
    with pytest.raises(NotFoundError):
        await second.save()
    from open_notebook.database.repository import repo_query

    assert await repo_query("SELECT * FROM v1_note_snapshot;") == []


async def test_real_personal_native_only_and_modes(database, monkeypatch, tmp_path):
    from api.personal_service import PersonalService
    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NoteRevisionConflict, NoteRevisionRequired

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "legacy"}, notebook_id="notebook:proof", snapshot=None
    )
    service = PersonalService()
    result = await service.save_note(
        "notebook:proof",
        {"content": "personal", "expected_revision": 1},
        created.native["id"],
    )
    assert result["revision"] == 2
    monkeypatch.setenv("STUDY_WORKBENCH_NOTE_WRITE_MODE", "multiclient")
    with pytest.raises(NoteRevisionRequired):
        await service.save_note(
            "notebook:proof", {"content": "bad"}, created.native["id"]
        )
    with pytest.raises(NoteRevisionConflict):
        await service.save_note(
            "notebook:proof",
            {"content": "bad", "expected_revision": 1},
            created.native["id"],
        )
    bundles = await repo.read_project_notes_locked("notebook:proof")
    assert bundles[0].native["content"] == bundles[0].snapshot["content"] == "personal"


async def test_real_http_legacy_personal_contract_and_cascade(
    database, monkeypatch, tmp_path
):
    import httpx
    from fastapi import FastAPI

    from api.main import app as main_app
    from api.routers import evidence, notes

    app = FastAPI()
    app.include_router(notes.router, prefix="/api")
    app.include_router(evidence.router, prefix="/api")
    for error, handler in main_app.exception_handlers.items():
        app.add_exception_handler(error, handler)
    from open_notebook.database import note_repository as repo
    from open_notebook.domain.notebook import Notebook
    from open_notebook.exceptions import NotFoundError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value="synthetic"),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        made = await client.post(
            "/api/personal/notebooks/notebook:proof/notes", json={"content": "initial"}
        )
        assert made.status_code == 200, made.text
        identity = made.json()["id"]
        assert made.json()["revision"] == 1
        saved = await client.put(
            "/api/notes/" + identity, json={"content": "legacy", "expected_revision": 1}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 2
        stale = await client.patch(
            "/api/personal/notebooks/notebook:proof/notes/" + identity,
            json={"content": "stale", "expected_revision": 1},
            headers={"Origin": "https://example.test"},
        )
        assert stale.status_code == 409, stale.text
        assert stale.json() == {
            "detail": {"code": "NOTE_REVISION_CONFLICT", "current_revision": 2}
        }
        assert (
            stale.headers.get("access-control-allow-origin") == "https://example.test"
        )
        personal = await client.patch(
            "/api/personal/notebooks/notebook:proof/notes/" + identity,
            json={"content": "personal winner", "expected_revision": 2},
        )
        assert personal.status_code == 200 and personal.json()["revision"] == 3
        stale_legacy = await client.put(
            "/api/notes/" + identity,
            json={"title": "stale title", "expected_revision": 2},
        )
        assert stale_legacy.status_code == 409
        assert stale_legacy.json()["detail"]["current_revision"] == 3
        compatibility = await client.put(
            "/api/notes/" + identity, json={"title": "compatible title"}
        )
        assert (
            compatibility.status_code == 200 and compatibility.json()["revision"] == 4
        )
        assert compatibility.json()["content"] == "personal winner"
        monkeypatch.setenv("STUDY_WORKBENCH_NOTE_WRITE_MODE", "multiclient")
        required = await client.put("/api/notes/" + identity, json={"content": "stale"})
        assert required.status_code == 428, required.text
        assert required.json() == {"detail": {"code": "NOTE_REVISION_REQUIRED"}}
        for bad in (True, 1.0, "1", 0, -1):
            response = await client.patch(
                "/api/personal/notebooks/notebook:proof/notes/" + identity,
                json={"content": "bad", "expected_revision": bad},
            )
            assert response.status_code == 422
        capabilities = (await client.get("/api/personal/note-capabilities")).json()
        assert capabilities["conditional_writes"] is True
        assert capabilities["expected_revision_required"] is True
        deleted = await (await Notebook.get("notebook:proof")).delete()
        assert deleted["deleted_notes"] == 1
        with pytest.raises(NotFoundError):
            await repo.read_note_bundle(identity)
        from open_notebook.database.repository import repo_query

        assert await repo_query("SELECT * FROM v1_note_snapshot;") == []


async def test_real_independent_roots_cas(database, monkeypatch, tmp_path):
    """Both transactions enter concurrently under different real flock roots."""
    import asyncio
    from contextvars import ContextVar

    from open_notebook.database import note_repository as repo
    from open_notebook.database import project_locks
    from open_notebook.exceptions import NoteRevisionConflict

    root = ContextVar("root", default=tmp_path / "initial")
    monkeypatch.setattr(
        repo, "note_mutation_lock", lambda: project_locks.note_mutation_lock(root.get())
    )
    monkeypatch.setattr(
        repo,
        "project_lock",
        lambda identity: project_locks.project_lock(identity, root.get()),
    )
    created = await repo.create_note(
        fields={"content": "initial"}, notebook_id="notebook:proof", snapshot={}
    )
    original = repo._transaction
    entered = 0
    ready = asyncio.Event()

    async def transaction(body, params):
        nonlocal entered
        if "LET $updated" in body:
            entered += 1
            if entered == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), 5)
        return await original(body, params)

    monkeypatch.setattr(repo, "_transaction", transaction)

    async def write(name):
        root.set(tmp_path / name)
        return await repo.update_note(
            note_id=created.native["id"],
            notebook_id="notebook:proof",
            fields={"content": name},
            snapshot={"citations": [{"quote": name}]},
            expected_revision=1,
            mode="multiclient",
        )

    outcomes = await asyncio.gather(
        write("host-a"), write("host-b"), return_exceptions=True
    )
    assert sum(isinstance(r, repo.NoteWriteResult) for r in outcomes) == 1, outcomes
    assert sum(isinstance(r, NoteRevisionConflict) for r in outcomes) == 1, outcomes
    bundle = await repo.read_note_bundle(created.native["id"], "notebook:proof")
    assert bundle.native["revision"] == bundle.snapshot["revision"] == 2
    assert bundle.native["content"] == bundle.snapshot["citations"][0]["quote"]


async def test_real_note_scope_revalidated_in_transaction(
    database, monkeypatch, tmp_path
):
    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import InvalidInputError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot={}
    )
    with pytest.raises(InvalidInputError):
        await repo.update_note(
            note_id=created.native["id"],
            notebook_id="notebook:proof",
            fields={"content": "bad"},
            snapshot={"scope_snapshot": {"source_version_ids": ["missing"]}},
            expected_revision=1,
        )
    bundle = await repo.read_note_bundle(created.native["id"], "notebook:proof")
    assert bundle.native["revision"] == 1


async def test_real_unknown_ack_after_commit_requires_reconciliation(
    database, monkeypatch, tmp_path
):
    import asyncio
    from contextlib import asynccontextmanager

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NoteCommitOutcomeUnknown

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot={}
    )
    connection = repo.db_connection

    @asynccontextmanager
    async def lost_ack():
        async with connection() as db:

            class LostAck:
                async def query_raw(self, *args):
                    await db.query_raw(*args)
                    raise asyncio.CancelledError()

            yield LostAck()

    with monkeypatch.context() as m:
        m.setattr(repo, "db_connection", lost_ack)
        with pytest.raises(NoteCommitOutcomeUnknown):
            await repo.update_note(
                note_id=created.native["id"],
                fields={"content": "committed"},
                expected_revision=1,
            )
    bundle = await repo.read_note_bundle(created.native["id"], "notebook:proof")
    assert bundle.native["revision"] == bundle.snapshot["revision"] == 2
    assert bundle.native["content"] == "committed"


async def test_real_coherent_read_during_writes_and_delete_race(
    database, monkeypatch, tmp_path
):
    import asyncio

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import NotFoundError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "1"},
        notebook_id="notebook:proof",
        snapshot={"citations": [{"quote": "1"}]},
    )
    identity = created.native["id"]
    start = asyncio.Event()

    async def writer():
        await start.wait()
        for revision in range(2, 7):
            await repo.update_note(
                note_id=identity,
                notebook_id="notebook:proof",
                fields={"content": str(revision)},
                snapshot={"citations": [{"quote": str(revision)}]},
                expected_revision=revision - 1,
            )

    async def reader():
        start.set()
        for _ in range(8):
            bundles = await repo.read_project_notes_locked("notebook:proof")
            assert len(bundles) == 1
            row = bundles[0]
            assert row.native["revision"] == row.snapshot["revision"]
            assert (
                row.native["content"]
                == row.snapshot["content"]
                == row.snapshot["citations"][0]["quote"]
                == str(row.native["revision"])
            )

    await asyncio.gather(writer(), reader())
    outcomes = await asyncio.gather(
        repo.delete_note(identity),
        repo.update_note(
            note_id=identity, fields={"content": "late"}, expected_revision=6
        ),
        return_exceptions=True,
    )
    assert all(
        r is None or isinstance(r, (repo.NoteWriteResult, NotFoundError))
        for r in outcomes
    )
    with pytest.raises(NotFoundError):
        await repo.read_note_bundle(identity)
    from open_notebook.database.repository import repo_query

    assert await repo_query("SELECT * FROM v1_note_snapshot;") == []


async def test_real_embedding_only_route_does_not_increment(
    database, monkeypatch, tmp_path
):
    from unittest.mock import AsyncMock

    from api.models import EmbedRequest
    from api.routers.embedding import embed_content
    from open_notebook.database import note_repository as repo

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value="synthetic"),
    )
    monkeypatch.setattr(
        "open_notebook.ai.models.model_manager.get_embedding_model",
        AsyncMock(return_value=object()),
    )
    created = await repo.create_note(
        fields={"content": "unchanged"}, notebook_id="notebook:proof", snapshot={}
    )
    await embed_content(
        EmbedRequest(
            item_id=created.native["id"], item_type="note", async_processing=False
        )
    )
    bundle = await repo.read_note_bundle(created.native["id"])
    assert bundle.native["revision"] == bundle.snapshot["revision"] == 1


async def test_real_parent_delete_cannot_leave_late_created_child(
    database, monkeypatch, tmp_path
):
    """Separate lock roots; DB pause after parent read exercises deletion overlap."""
    import asyncio
    from contextvars import ContextVar

    from open_notebook.database import note_repository as repo
    from open_notebook.database import project_locks
    from open_notebook.database.repository import repo_query
    from open_notebook.exceptions import OpenNotebookError

    root = ContextVar("root", default=tmp_path / "creator")
    monkeypatch.setattr(
        repo, "note_mutation_lock", lambda: project_locks.note_mutation_lock(root.get())
    )
    monkeypatch.setattr(
        repo,
        "project_lock",
        lambda identity: project_locks.project_lock(identity, root.get()),
    )
    original = repo._transaction
    started = asyncio.Event()

    async def paused(body, params):
        if "LET $native = (CREATE" in body:
            body = body.replace(
                "LET $native = (CREATE", "SLEEP 300ms; LET $native = (CREATE"
            )
            started.set()
        return await original(body, params)

    monkeypatch.setattr(repo, "_transaction", paused)

    async def destroy():
        root.set(tmp_path / "deleter")
        await started.wait()
        # A real DB-side sleep holds the already-read parent snapshot open.
        await asyncio.sleep(0.15)
        async with repo.notebook_mutation_locks("notebook:proof"):
            return await repo.delete_notebook_notes_locked("notebook:proof")

    outcomes = await asyncio.gather(
        repo.create_note(
            fields={"content": "late"}, notebook_id="notebook:proof", snapshot={}
        ),
        destroy(),
        return_exceptions=True,
    )
    assert all(
        not isinstance(r, Exception) or isinstance(r, OpenNotebookError)
        for r in outcomes
    ), outcomes
    parent = await repo_query("SELECT * FROM notebook:proof;")
    if parent:
        assert isinstance(outcomes[1], OpenNotebookError), outcomes
        assert len(await repo_query("SELECT * FROM note;")) == 1
        # Explicit reconciliation after a known aborted deletion, not auto retry.
        async with repo.notebook_mutation_locks("notebook:proof"):
            await repo.delete_notebook_notes_locked("notebook:proof")
    assert await repo_query("SELECT * FROM notebook:proof;") == []
    assert await repo_query("SELECT * FROM note;") == []
    assert await repo_query("SELECT * FROM artifact;") == []
    assert await repo_query("SELECT * FROM v1_note_snapshot;") == []


async def test_real_guards_preserve_timestamps_and_corruption_fails_closed(
    database, monkeypatch, tmp_path
):
    from api.personal_store import PersonalStore
    from open_notebook.database import note_repository as repo
    from open_notebook.database.repository import repo_query
    from open_notebook.exceptions import DatabaseOperationError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    before = (await repo_query("SELECT * FROM notebook:proof;"))[0]["updated"]
    created = await repo.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot={}
    )
    assert (await repo_query("SELECT * FROM notebook:proof;"))[0]["updated"] == before
    await repo.add_to_notebook(created.native["id"], "notebook:foreign")
    row = await repo.read_note_bundle(created.native["id"])
    assert row.native["updated"] == created.native["updated"]
    snapshot = dict(created.snapshot)
    store = PersonalStore()
    for bad in [True, 1.0, "1", 0, -1, None]:
        await store.put(
            "note_snapshot", created.native["id"], {**snapshot, "revision": bad}
        )
        if bad is None:
            # Python client None encodes NONE (absence), not the persisted NULL literal.
            await repo_query(
                "UPDATE $snapshot SET payload.revision = NULL;",
                {"snapshot": repo._snapshot_id(created.native["id"])},
            )
        with pytest.raises(DatabaseOperationError):
            await repo.update_note(
                note_id=created.native["id"],
                fields={"content": "bad"},
                expected_revision=1,
            )
    await store.put("note_snapshot", created.native["id"], snapshot)
    assert (await repo.read_note_bundle(created.native["id"])).native["revision"] == 1


async def test_real_schema_rejects_invalid_native_revision(
    database, monkeypatch, tmp_path
):
    from surrealdb import RecordID

    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import DatabaseOperationError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot=None
    )
    for bad in [True, 1.0, "1", 0, -1, None]:
        with pytest.raises(DatabaseOperationError):
            await repo._transaction(
                "UPDATE $note SET revision="
                + ("NULL" if bad is None else "$revision")
                + "; RETURN true;",
                {"note": RecordID.parse(created.native["id"]), "revision": bad},
            )
    assert (await repo.read_note_bundle(created.native["id"])).native["revision"] == 1


async def test_real_invalid_editorial_content_never_commits(
    database, monkeypatch, tmp_path
):
    from open_notebook.database import note_repository as repo
    from open_notebook.exceptions import InvalidInputError

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    created = await repo.create_note(
        fields={"content": "valid"}, notebook_id="notebook:proof", snapshot={}
    )
    with pytest.raises(InvalidInputError):
        await repo.update_note(
            note_id=created.native["id"], fields={"content": "   "}, expected_revision=1
        )
    assert (await repo.read_note_bundle(created.native["id"])).native["revision"] == 1


async def test_real_insight_creation_has_atomic_membership_and_revision(
    database, monkeypatch, tmp_path
):
    from unittest.mock import AsyncMock

    from api.models import SaveAsNoteRequest
    from api.routers.insights import save_insight_as_note
    from open_notebook.database import note_repository as repo
    from open_notebook.domain.notebook import Source, SourceInsight

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value="synthetic"),
    )
    insight = SourceInsight(
        id="source_insight:synthetic",
        insight_type="summary",
        content="Synthetic insight",
    )
    monkeypatch.setattr(SourceInsight, "get", AsyncMock(return_value=insight))
    monkeypatch.setattr(
        SourceInsight,
        "get_source",
        AsyncMock(return_value=Source(title="Synthetic source")),
    )
    response = await save_insight_as_note(
        "source_insight:synthetic", SaveAsNoteRequest(notebook_id="notebook:proof")
    )
    assert response.revision == 1
    bundle = await repo.read_note_bundle(response.id, "notebook:proof")
    assert bundle.native["content"] == "Synthetic insight"
    assert bundle.snapshot is None


async def test_real_migration_backfills_legacy_without_touching_embedding(
    database, monkeypatch, tmp_path
):
    from pathlib import Path

    from api.personal_store import PersonalStore
    from open_notebook.database import note_repository as repo
    from open_notebook.database.repository import db_connection

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    async with db_connection() as db:
        await db.query(
            'REMOVE FIELD revision ON note; CREATE note:legacy SET content="legacy", embedding=[0.25]; RELATE note:legacy->artifact->notebook:proof;'
        )
        await db.query(
            Path("open_notebook/database/migrations/27.surrealql").read_text()
        )
    old = await repo.read_note_bundle("note:legacy", "notebook:proof")
    assert old.native["revision"] == 1
    assert old.native["embedding"] == [0.25]
    await PersonalStore().put(
        "note_snapshot",
        "note:legacy",
        {
            "note_id": "note:legacy",
            "notebook_id": "notebook:proof",
            "content": "legacy",
            "created_at": "original",
        },
    )
    updated = await repo.update_note(
        note_id="note:legacy",
        notebook_id="notebook:proof",
        fields={"content": "updated"},
        snapshot={},
        expected_revision=1,
    )
    assert updated.native["revision"] == updated.snapshot["revision"] == 2
    # Migration preserved the old vector above; changing its source text must
    # invalidate it rather than expose stale search results.
    assert updated.native.get("embedding") is None
    assert updated.snapshot["created_at"] == "original"


async def test_real_summary_note_rename_preserves_body_and_snapshot(
    database, monkeypatch, tmp_path
):
    from open_notebook.database import note_repository as repo
    from open_notebook.domain.notebook import Notebook

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(return_value="synthetic"),
    )
    created = await repo.create_note(
        fields={"title": "Before", "content": "Retained body", "note_type": "human"},
        notebook_id="notebook:proof",
        snapshot={"citations": [{"quote": "Retained citation"}], "scope_snapshot": {}},
    )
    summary = (await (await Notebook.get("notebook:proof")).get_notes())[0]
    assert summary.content is None
    summary.title = "After"
    await summary.save()
    row = await repo.read_note_bundle(created.native["id"], "notebook:proof")
    assert row.native["content"] == row.snapshot["content"] == "Retained body"
    assert row.native["title"] == row.snapshot["title"] == "After"
    assert row.snapshot["citations"] == created.snapshot["citations"]
    assert row.native["revision"] == row.snapshot["revision"] == 2
    assert summary.content == "Retained body"


async def test_real_invalid_assigned_note_type_is_rejected_before_write(
    database, monkeypatch, tmp_path
):
    from pydantic import ValidationError

    from open_notebook.database import note_repository as repo
    from open_notebook.domain.notebook import Note

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    submissions = []
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command",
        AsyncMock(side_effect=lambda *a, **k: submissions.append(a)),
    )
    created = await repo.create_note(
        fields={"content": "Retained body", "note_type": "human"},
        notebook_id="notebook:proof",
        snapshot={},
    )
    note = Note(**created.native)
    note.note_type = "invalid"  # type: ignore[assignment]
    with pytest.raises(ValidationError):
        await note.save()
    row = await repo.read_note_bundle(created.native["id"], "notebook:proof")
    assert row.native["note_type"] == "human"
    assert row.native["revision"] == row.snapshot["revision"] == 1
    assert submissions == []
