"""Native source snapshot transaction acceptance; synthetic isolated DB only."""

import asyncio

import pytest
from test_v1_note_repository import database as _database

from api.source_snapshot_contracts import (
    NoteSnapshotRequest,
    SnapshotProblem,
    TurnSnapshotRequest,
)
from api.source_snapshot_service import SourceSnapshotService
from open_notebook.database import note_repository as notes
from open_notebook.exceptions import NoteRevisionConflict, NotFoundError

database = _database

pytestmark = pytest.mark.asyncio


async def test_real_snapshot_atomic_replay_stale_and_foreign(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"title": "Title 🌞", "content": "saved body"},
        notebook_id="notebook:proof",
        snapshot={},
    )
    service = SourceSnapshotService()
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id=note.native["id"],
        expected_revision=1,
        idempotency_key="real",
    )
    first, second = await asyncio.gather(
        service.create("notebook:proof", request),
        service.create("notebook:proof", request),
    )
    assert first["source_id"] == second["source_id"]
    assert {first["existing"], second["existing"]} == {False, True}
    native = await notes.read_note_bundle(note.native["id"], "notebook:proof")
    assert native.native["revision"] == 1
    from open_notebook.database.repository import repo_query

    assert len(await repo_query("SELECT * FROM source;")) == 1
    assert len(await repo_query("SELECT * FROM reference;")) == 1
    assert len(await repo_query("SELECT * FROM v1_version;")) == 1
    await notes.update_note(
        note_id=note.native["id"],
        notebook_id="notebook:proof",
        fields={"content": "new"},
        expected_revision=1,
    )
    assert (await service.create("notebook:proof", request))[
        "source_version_id"
    ] == first["source_version_id"]
    with pytest.raises(NoteRevisionConflict):
        await service.create(
            "notebook:proof", request.model_copy(update={"idempotency_key": "stale"})
        )
    with pytest.raises(NotFoundError):
        await service.create("notebook:foreign", request)


async def test_real_snapshot_commit_rechecks_revision_and_rolls_back(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "old"}, notebook_id="notebook:proof", snapshot={}
    )
    service = SourceSnapshotService()
    original_commit = service.repository.commit

    # Simulate a competing independent-data-root client (bypassing local flock).
    async def racing_commit(prepared):
        from open_notebook.database.repository import repo_query

        await repo_query(
            "UPDATE $note SET content='new', revision=2;",
            {"note": __import__("surrealdb").RecordID.parse(note.native["id"])},
        )
        await repo_query("DELETE v1_note_snapshot;")
        return await original_commit(prepared)

    service.repository.commit = racing_commit
    with pytest.raises(NoteRevisionConflict):
        await service.create(
            "notebook:proof",
            NoteSnapshotRequest(
                origin_kind="note",
                note_id=note.native["id"],
                expected_revision=1,
                idempotency_key="race",
            ),
        )
    from open_notebook.database.repository import repo_query

    assert await repo_query("SELECT * FROM source;") == []
    assert (
        len(list(tmp_path.glob("originals/*/*.md"))) == 1
    )  # safe orphan; never unlink a possible concurrent winner


async def test_real_completed_turn_and_idempotency_request_conflict(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    service = SourceSnapshotService()
    await service.store.put(
        "turn",
        "turn_real",
        {
            "turn_id": "turn_real",
            "notebook_id": "notebook:proof",
            "status": "succeeded",
            "answer": "Result",
            "message": "Prompt",
            "scope_snapshot": {},
            "citations": [],
        },
    )
    request = TurnSnapshotRequest(
        origin_kind="turn", turn_id="turn_real", idempotency_key="turn"
    )
    result = await service.create("notebook:proof", request)
    assert result["provenance"]["authorship"] == "ai"
    with pytest.raises(SnapshotProblem, match="SNAPSHOT_IDEMPOTENCY_CONFLICT"):
        await service.create(
            "notebook:proof", request.model_copy(update={"turn_id": "turn_other"})
        )


async def test_real_lost_commit_ack_reconciles_without_losing_original(
    database, monkeypatch, tmp_path
):
    from contextlib import asynccontextmanager

    from api.source_snapshot_contracts import SnapshotCommitUnknown
    from open_notebook.database import source_snapshot_repository as repository

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "retained after lost ack"},
        notebook_id="notebook:proof",
        snapshot={},
    )
    actual = repository.db_connection

    @asynccontextmanager
    async def lost_ack():
        async with actual() as connection:

            class Connection:
                async def query_raw(self, *args):
                    await connection.query_raw(*args)
                    raise ConnectionError("lost acknowledgement after commit")

            yield Connection()

    monkeypatch.setattr(repository, "db_connection", lost_ack)
    service = SourceSnapshotService()
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id=note.native["id"],
        expected_revision=1,
        idempotency_key="lost",
    )
    with pytest.raises(SnapshotCommitUnknown):
        await service.create("notebook:proof", request)
    monkeypatch.setattr(repository, "db_connection", actual)
    result = await service.create("notebook:proof", request)
    assert result["existing"] is True
    path = await service.evidence.resolve_file(result["source_version_id"])
    assert path.read_text() == "retained after lost ack"


async def test_real_delete_origin_before_commit_cannot_create_orphan_source(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "saved"}, notebook_id="notebook:proof", snapshot={}
    )
    service = SourceSnapshotService()
    original = service.repository.commit

    async def deleted(prepared):
        from surrealdb import RecordID

        from open_notebook.database.repository import repo_query

        await repo_query(
            "DELETE artifact WHERE in=$note; DELETE $note;",
            {"note": RecordID.parse(note.native["id"])},
        )
        return await original(prepared)

    service.repository.commit = deleted
    with pytest.raises(NotFoundError):
        await service.create(
            "notebook:proof",
            NoteSnapshotRequest(
                origin_kind="note",
                note_id=note.native["id"],
                expected_revision=1,
                idempotency_key="delete",
            ),
        )
    from open_notebook.database.repository import repo_query

    assert await repo_query("SELECT * FROM source;") == []
    assert await repo_query("SELECT * FROM v1_version;") == []


async def test_real_independent_writers_share_bytes_without_deleting_winner(
    database, monkeypatch, tmp_path
):
    from contextlib import asynccontextmanager

    from api.evidence_service import EvidenceService
    from api.personal_store import PersonalStore
    from api.source_snapshot_contracts import SnapshotCommitRejected
    from open_notebook.database.source_snapshot_repository import (
        SourceSnapshotRepository,
    )

    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "same immutable data"},
        notebook_id="notebook:proof",
        snapshot={},
    )

    class IndependentStore(PersonalStore):
        @asynccontextmanager
        async def project_lock(self, _):
            yield  # model clients without a shared advisory-lock root

    barrier = asyncio.Event()
    arrived = 0

    class Repository(SourceSnapshotRepository):
        async def read_note(self, *args):
            nonlocal arrived
            result = await super().read_note(*args)
            arrived += 1
            if arrived == 2:
                barrier.set()
            await barrier.wait()
            return result

    services = [
        SourceSnapshotService(
            evidence=EvidenceService(store=IndependentStore(), data_root=tmp_path),
            repository=Repository(),
        )
        for _ in range(2)
    ]
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id=note.native["id"],
        expected_revision=1,
        idempotency_key="independent",
    )
    results = await asyncio.gather(
        *[service.create("notebook:proof", request) for service in services],
        return_exceptions=True,
    )
    assert any(isinstance(result, dict) for result in results)
    assert all(isinstance(result, (dict, SnapshotCommitRejected)) for result in results)
    for service in services:
        replay = await service.create("notebook:proof", request)
        assert replay["existing"] is True
        assert (
            await service.evidence.resolve_file(replay["source_version_id"])
        ).read_text() == "same immutable data"
    from open_notebook.database.repository import repo_query

    assert len(await repo_query("SELECT * FROM source;")) == 1
    assert len(await repo_query("SELECT * FROM v1_version;")) == 1


async def test_real_deleted_source_replay_is_unavailable_and_never_resurrects(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "saved"}, notebook_id="notebook:proof", snapshot={}
    )
    service = SourceSnapshotService()
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id=note.native["id"],
        expected_revision=1,
        idempotency_key="deleted-source",
    )
    result = await service.create("notebook:proof", request)
    from surrealdb import RecordID

    from open_notebook.database.repository import repo_query

    await repo_query("DELETE $source;", {"source": RecordID.parse(result["source_id"])})
    with pytest.raises(SnapshotProblem, match="SNAPSHOT_UNAVAILABLE"):
        await service.create("notebook:proof", request)
    assert await repo_query("SELECT * FROM source;") == []


async def test_real_deleted_origin_does_not_invalidate_retained_snapshot(
    database, monkeypatch, tmp_path
):
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    note = await notes.create_note(
        fields={"content": "retained material"},
        notebook_id="notebook:proof",
        snapshot={},
    )
    service = SourceSnapshotService()
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id=note.native["id"],
        expected_revision=1,
        idempotency_key="deleted-origin",
    )
    result = await service.create("notebook:proof", request)
    await notes.delete_note(note.native["id"])
    replay = await service.create("notebook:proof", request)
    assert replay["source_version_id"] == result["source_version_id"]
    assert replay["existing"] is True
    assert replay["provenance"]["origin_id"] == note.native["id"]
