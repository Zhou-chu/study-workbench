"""Snapshot orchestration with persistence, lock and thread/file boundaries replaced."""

import asyncio
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import api.source_snapshot_service as module
from api.personal_service import digest
from api.source_snapshot_contracts import (
    NoteSnapshotRequest,
    SnapshotProblem,
    TurnSnapshotRequest,
)
from open_notebook.exceptions import (
    InvalidInputError,
    NoteRevisionConflict,
    NotFoundError,
)


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    events: list[str] = []
    rows: dict[tuple[str, str], dict[str, object]] = {}
    native: dict[str, object] = {
        "title": "Saved title",
        "content": "Saved body.",
        "revision": 3,
        "note_type": "human",
    }

    @asynccontextmanager
    async def lock(identity: str):
        events.append("lock:" + identity)
        try:
            yield
        finally:
            events.append("unlock:" + identity)

    async def get(kind: str, identity: str):
        return rows.get((kind, identity))

    async def commit(prepared):
        events.append("commit")
        return prepared["receipt"]

    async def publish(*args, **kwargs):
        events.append("publish")

    store = SimpleNamespace(get=AsyncMock(side_effect=get), project_lock=lock)
    evidence = SimpleNamespace(
        store=store,
        data_root=Path("/synthetic-never-opened"),
        resolve_file=AsyncMock(),
        validate_citation=AsyncMock(),
    )
    repository = SimpleNamespace(
        read_note=AsyncMock(return_value=SimpleNamespace(native=native, snapshot={})),
        commit=AsyncMock(side_effect=commit),
        check_available=AsyncMock(),
    )
    thread = AsyncMock(side_effect=publish)
    monkeypatch.setattr(module.asyncio, "to_thread", thread)
    request = NoteSnapshotRequest(
        origin_kind="note",
        note_id="note:one",
        expected_revision=3,
        idempotency_key="fixture",
    )
    identity = digest(
        {"notebook_id": "notebook:one", "source_snapshot": request.idempotency_key}
    )
    return SimpleNamespace(
        service=module.SourceSnapshotService(evidence, repository),
        store=store,
        evidence=evidence,
        repository=repository,
        thread=thread,
        rows=rows,
        native=native,
        events=events,
        request=request,
        job_id="job_" + identity,
        lock_id="source-snapshot:" + identity,
    )


def rejected_before_publish(s: SimpleNamespace) -> None:
    s.thread.assert_not_awaited()
    s.repository.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_blank_key_rejects_before_lock_or_reads(setup: SimpleNamespace) -> None:
    s = setup
    request = s.request.model_copy(update={"idempotency_key": "  "})
    with pytest.raises(SnapshotProblem) as error:
        await s.service.create("notebook:one", request)
    assert (error.value.code, error.value.status) == ("INVALID_IDEMPOTENCY_KEY", 400)
    assert s.events == []
    s.store.get.assert_not_awaited()
    rejected_before_publish(s)


@pytest.mark.asyncio
async def test_revision_conflict_never_publishes(setup: SimpleNamespace) -> None:
    s = setup
    s.native["revision"] = 4
    with pytest.raises(NoteRevisionConflict):
        await s.service.create("notebook:one", s.request)
    s.repository.read_note.assert_awaited_once_with("notebook:one", "note:one")
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [None, "", " \n ", 12])
async def test_empty_or_nonstr_content_rejects(
    setup: SimpleNamespace, content: object
) -> None:
    s = setup
    s.native["content"] = content
    with pytest.raises(SnapshotProblem) as error:
        await s.service.create("notebook:one", s.request)
    assert (error.value.code, error.value.status) == ("EMPTY_SNAPSHOT", 400)
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["content", "title"])
async def test_utf8_content_or_total_metadata_budget_rejects(
    setup: SimpleNamespace, field: str
) -> None:
    s = setup
    s.native[field] = "界" * (module.MAX_SNAPSHOT_BYTES // 3 + 1)
    with pytest.raises(SnapshotProblem) as error:
        await s.service.create("notebook:one", s.request)
    assert (error.value.code, error.value.status) == ("SNAPSHOT_TOO_LARGE", 413)
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["missing", "foreign", "running", "failed"])
async def test_turn_requires_owned_completed_result(
    setup: SimpleNamespace, state: str
) -> None:
    s = setup
    if state != "missing":
        s.rows["turn", "turn:one"] = {
            "notebook_id": "foreign" if state == "foreign" else "notebook:one",
            "status": state,
            "answer": "body",
        }
    request = TurnSnapshotRequest(
        origin_kind="turn", turn_id="turn:one", idempotency_key="fixture"
    )
    with pytest.raises((NotFoundError, SnapshotProblem)) as error:
        await s.service.create("notebook:one", request)
    if state in {"missing", "foreign"}:
        assert isinstance(error.value, NotFoundError)
    else:
        assert isinstance(error.value, SnapshotProblem)
        assert (error.value.code, error.value.status) == ("RESULT_NOT_READY", 409)
    s.repository.read_note.assert_not_awaited()
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["request_hash", "operation", "notebook_id"])
async def test_receipt_conflict_never_replays_or_reads_origin(
    setup: SimpleNamespace, field: str
) -> None:
    s = setup
    receipt = {
        "request_hash": digest(s.request.model_dump(exclude={"idempotency_key"})),
        "operation": "source_snapshot",
        "notebook_id": "notebook:one",
    }
    receipt[field] = "different"
    s.rows["job", s.job_id] = receipt
    with pytest.raises(SnapshotProblem) as error:
        await s.service.create("notebook:one", s.request)
    assert (error.value.code, error.value.status) == (
        "SNAPSHOT_IDEMPOTENCY_CONFLICT",
        409,
    )
    s.repository.read_note.assert_not_awaited()
    s.repository.check_available.assert_not_awaited()
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", ["note", "turn"])
async def test_success_constructs_immutable_records_before_commit(
    setup: SimpleNamespace, origin: str
) -> None:
    s = setup
    request = s.request
    if origin == "turn":
        s.rows["turn", "turn:one"] = {
            "notebook_id": "notebook:one",
            "status": "succeeded",
            "answer": "Saved body.",
            "message": "Saved title",
        }
        request = TurnSnapshotRequest(
            origin_kind="turn", turn_id="turn:one", idempotency_key="fixture"
        )
    result = await s.service.create("notebook:one", request)
    prepared = s.repository.commit.await_args.args[0]
    assert result == prepared["receipt"]["result"]
    assert result["existing"] is False and result["status"] == "ready"
    assert result["embedding_status"] == "not_requested"
    assert prepared["origin_revision"] == (3 if origin == "note" else None)
    records = prepared["records"]
    assert [row[0] for row in records] == ["version", "extraction", "evidence", "job"]
    version, extraction, evidence, receipt = [row[2] for row in records]
    assert version["sha256"] == hashlib.sha256(b"Saved body.").hexdigest()
    assert version["byte_size"] == len(b"Saved body.")
    assert version["origin"] == "derived_snapshot"
    assert extraction["evidence_ids"] == [evidence["evidence_id"]]
    assert evidence["source_version_id"] == version["source_version_id"]
    assert receipt["request_snapshot"]["origin_kind"] == origin
    assert receipt["replay_allowed"] is False
    assert receipt["remote_may_continue"] is False
    assert s.events == [
        "lock:" + s.lock_id,
        "lock:notebook:one",
        "publish",
        "commit",
        "unlock:notebook:one",
        "unlock:" + s.lock_id,
    ]
    s.thread.assert_awaited_once_with(
        module.publish_snapshot_bytes,
        s.evidence.data_root / version["file_path"],
        b"Saved body.",
        durability_root=s.evidence.data_root,
    )
    s.evidence.validate_citation.assert_not_awaited()


@pytest.mark.asyncio
async def test_existing_receipt_replays_without_publication(
    setup: SimpleNamespace,
) -> None:
    s = setup
    result = {"source_version_id": "sv_existing", "existing": False}
    s.rows["job", s.job_id] = {
        "request_hash": digest(s.request.model_dump(exclude={"idempotency_key"})),
        "operation": "source_snapshot",
        "notebook_id": "notebook:one",
        "result": result,
    }
    assert await s.service.create("notebook:one", s.request) == {
        **result,
        "existing": True,
    }
    assert result["existing"] is False
    s.repository.check_available.assert_awaited_once_with("notebook:one", result)
    s.evidence.resolve_file.assert_awaited_once_with("sv_existing")
    s.repository.read_note.assert_not_awaited()
    rejected_before_publish(s)


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [NotFoundError("gone"), InvalidInputError("invalid")])
async def test_replay_missing_file_maps_to_unavailable(
    setup: SimpleNamespace, error: Exception
) -> None:
    s = setup
    s.evidence.resolve_file.side_effect = error
    with pytest.raises(SnapshotProblem) as caught:
        await s.service._replay("notebook:one", {"result": {"source_version_id": "sv"}})
    assert (caught.value.code, caught.value.status) == ("SNAPSHOT_UNAVAILABLE", 410)
    assert caught.value.__cause__ is error


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["publish", "commit"])
@pytest.mark.parametrize("cancel", [False, True])
async def test_publication_and_commit_errors_preserve_identity_release_locks(
    setup: SimpleNamespace, boundary: str, cancel: bool
) -> None:
    s = setup
    error = asyncio.CancelledError("cancel") if cancel else OSError("failure")
    target = s.thread if boundary == "publish" else s.repository.commit
    target.side_effect = error
    with pytest.raises(type(error)) as caught:
        await s.service.create("notebook:one", s.request)
    assert caught.value is error
    assert s.events[-2:] == ["unlock:notebook:one", "unlock:" + s.lock_id]
    if boundary == "publish":
        s.repository.commit.assert_not_awaited()
    else:
        s.thread.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("foreign", [False, True])
async def test_scope_version_must_exist_in_same_notebook(
    setup: SimpleNamespace, foreign: bool
) -> None:
    s = setup
    s.repository.read_note.return_value.snapshot = {
        "scope_snapshot": {"source_version_ids": ["sv_one"]}
    }
    if foreign:
        s.rows["version", "sv_one"] = {"notebook_id": "foreign"}
    with pytest.raises(SnapshotProblem) as error:
        await s.service.create("notebook:one", s.request)
    assert (error.value.code, error.value.status) == ("SOURCE_OUT_OF_SCOPE", 400)
    assert s.store.get.await_args_list[-1].args == ("version", "sv_one")
    rejected_before_publish(s)


@pytest.mark.asyncio
async def test_concurrent_commit_winner_is_rechecked_before_return(
    setup: SimpleNamespace,
) -> None:
    s = setup
    winner = {"result": {"source_version_id": "sv_winner", "existing": True}}
    s.repository.commit.side_effect = None
    s.repository.commit.return_value = winner
    result = await s.service.create("notebook:one", s.request)
    assert result == winner["result"]
    s.thread.assert_awaited_once()
    s.repository.commit.assert_awaited_once()
    s.repository.check_available.assert_awaited_once_with(
        "notebook:one", winner["result"]
    )
    s.evidence.resolve_file.assert_awaited_once_with("sv_winner")
