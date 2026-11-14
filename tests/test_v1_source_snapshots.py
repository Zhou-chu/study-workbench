from copy import deepcopy

import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from api.source_snapshot_contracts import (
    NoteSnapshotRequest,
    SnapshotProblem,
    TurnSnapshotRequest,
)
from api.source_snapshot_service import SourceSnapshotService
from open_notebook.database.note_repository import NoteWriteResult
from open_notebook.exceptions import NoteRevisionConflict, NotFoundError


class Repository:
    def __init__(self, store):
        self.store = store
        self.note = {
            "id": "note:a",
            "title": "Title",
            "content": "🌞 saved body.\n\nSecond paragraph.",
            "revision": 3,
            "note_type": None,
        }
        self.commits = []
        self.failure = None

    async def read_note(self, notebook_id, note_id):
        if notebook_id != "notebook:a" or note_id != "note:a":
            raise NotFoundError("Note not found")
        return NoteWriteResult(
            deepcopy(self.note), {"citations": [], "scope_snapshot": {}}
        )

    async def check_available(self, notebook_id, result):
        return None

    async def commit(self, prepared):
        if self.failure:
            raise self.failure
        if (
            prepared["origin_kind"] == "note"
            and self.note["revision"] != prepared["origin_revision"]
        ):
            revision = self.note["revision"]
            assert isinstance(revision, int)
            raise NoteRevisionConflict(revision)
        self.commits.append(prepared)
        for kind, identity, payload in prepared["records"]:
            await self.store.put(kind, identity, payload)
        return prepared["receipt"]


@pytest.fixture
def setup(tmp_path):
    store = MemoryStore()
    repo = Repository(store)
    evidence = EvidenceService(store=store, data_root=tmp_path)
    return SourceSnapshotService(evidence=evidence, repository=repo), repo, store


@pytest.mark.asyncio
async def test_exact_saved_revision_ready_without_model_or_worker(setup):
    service, repo, store = setup
    request = NoteSnapshotRequest(
        origin_kind="note", note_id="note:a", expected_revision=3, idempotency_key="one"
    )
    result = await service.create("notebook:a", request)
    assert result["status"] == "ready"
    assert result["embedding_status"] == "not_requested"
    version = await store.get("version", result["source_version_id"])
    assert (service.evidence.data_root / version["file_path"]).read_text() == repo.note[
        "content"
    ]
    assert version["source_title"] == "Title"
    assert version["provenance"]["note_revision"] == 3
    assert version["provenance"]["authorship"] == "unknown"
    assert repo.note["revision"] == 3
    assert (
        len(await service.evidence.retrieve("saved", [version["source_version_id"]]))
        == 1
    )
    assert (await store.get("job", result["job_id"]))["state"] == "succeeded"


@pytest.mark.asyncio
async def test_same_key_replay_after_note_changed_is_original_and_conflict_is_explicit(
    setup,
):
    service, repo, store = setup
    request = NoteSnapshotRequest(
        origin_kind="note", note_id="note:a", expected_revision=3, idempotency_key="one"
    )
    first = await service.create("notebook:a", request)
    repo.note.update(revision=4, content="Edited")
    replay = await service.create("notebook:a", request)
    assert replay["existing"] is True
    assert replay["source_version_id"] == first["source_version_id"]
    assert len(repo.commits) == 1
    with pytest.raises(SnapshotProblem, match="SNAPSHOT_IDEMPOTENCY_CONFLICT"):
        await service.create(
            "notebook:a", request.model_copy(update={"expected_revision": 4})
        )
    with pytest.raises(NoteRevisionConflict):
        await service.create(
            "notebook:a", request.model_copy(update={"idempotency_key": "different"})
        )


@pytest.mark.asyncio
async def test_empty_large_foreign_and_incomplete_turn_rejected_without_commit(setup):
    service, repo, store = setup
    request = NoteSnapshotRequest(
        origin_kind="note", note_id="note:a", expected_revision=3, idempotency_key="one"
    )
    with pytest.raises(NotFoundError):
        await service.create("notebook:foreign", request)
    for body, code in [
        ("  ", "EMPTY_SNAPSHOT"),
        ("x" * (1024 * 1024 + 1), "SNAPSHOT_TOO_LARGE"),
    ]:
        repo.note["content"] = body
        with pytest.raises(SnapshotProblem, match=code):
            await service.create("notebook:a", request)
    await store.put(
        "turn",
        "turn_a",
        {
            "turn_id": "turn_a",
            "notebook_id": "notebook:a",
            "status": "running",
            "answer": "not final",
        },
    )
    with pytest.raises(SnapshotProblem, match="RESULT_NOT_READY"):
        await service.create(
            "notebook:a",
            TurnSnapshotRequest(
                origin_kind="turn", turn_id="turn_a", idempotency_key="turn"
            ),
        )
    assert not repo.commits


@pytest.mark.asyncio
async def test_completed_turn_keeps_ai_origin_and_frozen_scope(setup):
    service, repo, store = setup
    await store.put(
        "turn",
        "turn_a",
        {
            "turn_id": "turn_a",
            "notebook_id": "notebook:a",
            "status": "succeeded",
            "message": "Question",
            "answer": "Final answer",
            "scope_snapshot": {},
            "citations": [],
        },
    )
    result = await service.create(
        "notebook:a",
        TurnSnapshotRequest(
            origin_kind="turn", turn_id="turn_a", idempotency_key="turn"
        ),
    )
    assert result["provenance"]["authorship"] == "ai"
    assert result["provenance"]["origin_id"] == "turn_a"


@pytest.mark.asyncio
async def test_rollback_and_unknown_commit_retain_deterministic_bytes(setup):
    from api.source_snapshot_contracts import (
        SnapshotCommitRejected,
        SnapshotCommitUnknown,
    )

    service, repo, store = setup
    request = NoteSnapshotRequest(
        origin_kind="note", note_id="note:a", expected_revision=3, idempotency_key="one"
    )
    repo.failure = SnapshotCommitRejected("Rejected")
    with pytest.raises(SnapshotCommitRejected):
        await service.create("notebook:a", request)
    assert len(list(service.evidence.data_root.glob("originals/*/*.md"))) == 1
    repo.failure = SnapshotCommitUnknown("Unknown")
    with pytest.raises(SnapshotCommitUnknown):
        await service.create("notebook:a", request)
    assert len(list(service.evidence.data_root.glob("originals/*/*.md"))) == 1


@pytest.mark.asyncio
async def test_two_publishers_cannot_replace_or_delete_winning_bytes(tmp_path):
    import asyncio

    from api.evidence_service import publish_snapshot_bytes

    target = tmp_path / "original.md"
    data = ("🌞 large complete saved note " * 10000).encode()
    await asyncio.gather(
        *[asyncio.to_thread(publish_snapshot_bytes, target, data) for _ in range(8)]
    )
    assert target.read_bytes() == data
    assert not list(tmp_path.glob("*.staging-*"))
    from open_notebook.exceptions import InvalidInputError

    with pytest.raises(InvalidInputError, match="SNAPSHOT_CONFLICT"):
        await asyncio.to_thread(
            publish_snapshot_bytes, target, b"losing different bytes"
        )
    assert target.read_bytes() == data


@pytest.mark.asyncio
async def test_foreign_evidence_id_is_not_copied_as_an_upstream_reference(setup):
    service, repo, store = setup
    original = repo.read_note

    async def note_with_unverified_foreign_reference(*args):
        bundle = await original(*args)
        return NoteWriteResult(
            bundle.native,
            {
                "scope_snapshot": {},
                "citations": [
                    {
                        "citation_id": "c1",
                        "evidence_id": "ev_foreign",
                        "quote": "User-written quotation",
                        "reference_validity": "unverified",
                    }
                ],
            },
        )

    repo.read_note = note_with_unverified_foreign_reference
    await store.put(
        "evidence",
        "ev_foreign",
        {
            "evidence_id": "ev_foreign",
            "source_version_id": "sv_foreign",
            "notebook_id": "notebook:foreign",
            "quote": "Never fetch me",
        },
    )
    result = await service.create(
        "notebook:a",
        NoteSnapshotRequest(
            origin_kind="note",
            note_id="note:a",
            expected_revision=3,
            idempotency_key="foreign-citation",
        ),
    )
    citation = result["provenance"]["citations"][0]
    assert citation["evidence_id"] is None
    assert citation["source_version_id"] is None
    assert citation["reference_validity"] == "out_of_scope"


@pytest.mark.asyncio
async def test_many_tiny_paragraphs_reject_before_database_without_truncation(setup):
    service, repo, store = setup
    repo.note["content"] = "\n\n".join(["tiny"] * 1001)
    with pytest.raises(SnapshotProblem, match="SNAPSHOT_TOO_LARGE"):
        await service.create(
            "notebook:a",
            NoteSnapshotRequest(
                origin_kind="note",
                note_id="note:a",
                expected_revision=3,
                idempotency_key="paragraph-limit",
            ),
        )
    assert not repo.commits
    assert not list(service.evidence.data_root.glob("originals/*/*.md"))
