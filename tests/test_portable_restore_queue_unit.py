"""Pure restore transformation and queue orchestration; no filesystem/DB/worker."""

import asyncio
import copy
import hashlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import NAMESPACE_URL, uuid5

import pytest

from api import portable_service as mod
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)
from open_notebook.utils import command_submission


def project():
    data = {kind: [] for kind in mod.FILES}
    data.update(
        notebook={"id": "notebook:old", "name": "source:old"},
        sources=[{"id": "source:old", "notebook_id": "notebook:old"}],
        notes=[{"id": "note:old", "content": "source:old", "parent_id": "source:old"}],
        chat_sessions=[{"id": "chat_session:old"}],
        source_insights=[{"id": "source_insight:old", "source": "source:old"}],
        version=[
            {
                "source_version_id": "sv_old",
                "source_id": "source:old",
                "status": "extracting",
            }
        ],
        extraction=[
            {
                "extraction_id": "ex_old",
                "status": "running",
                "verification_origin": "local_extraction",
                "revalidation": {"trusted": True},
            }
        ],
        evidence=[
            {
                "evidence_id": "ev_old",
                "verification_origin": "local_extraction",
                "revalidation": {},
                "file_path": "assets/a.pdf",
            }
        ],
        turn=[
            {
                "turn_id": "turn_old",
                "citations": [
                    {"evidence_id": "ev_old", "reference_validity": "verified"},
                    {"reference_validity": "invalid"},
                ],
            }
        ],
        job=[
            {
                "job_id": "job_old",
                "state": "running",
                "replay_allowed": True,
                "idempotency_key": "old",
            }
        ],
        link=[
            {
                "link_id": "link_old",
                "remote_notebook_id": "notebook:old",
                "last_checked_at": "yesterday",
            }
        ],
        source_link=[{"source_link_id": "sl_old", "remote_source_id": "source:old"}],
        artifact=[
            {
                "artifact_id": "artifact_old",
                "source_ids": ["source:old", "external"],
                "number": 3,
            }
        ],
        selection=[{"notebook_id": "notebook:old", "source_ids": ["source:old"]}],
        note_snapshot=[{"note_id": "note:old"}],
        legacy_chat=[{"chat_session_id": "chat_session:old"}],
        import_report=[{"import_report_id": "report_old"}],
    )
    return data


def service():
    # Bypass only constructor filesystem root resolution; target methods are real.
    return object.__new__(mod.PortableService)


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


def test_remap_preserves_graph_prose_remote_ids_and_input():
    source = project()
    before = copy.deepcopy(source)
    restored, ids = service()._remap(source, "restored/bundle")
    assert source == before
    assert len(set(ids.values())) == len(ids)
    assert all(old != new for old, new in ids.items())
    assert restored["notebook"]["id"].startswith("notebook:")
    assert restored["notes"][0]["id"].startswith("note:")
    assert restored["source_insights"][0]["source"] == ids["source:old"]
    assert restored["notes"][0]["parent_id"] == ids["source:old"]
    assert restored["notes"][0]["content"] == "source:old"
    assert restored["notebook"]["name"] == "source:old"
    assert restored["selection"][0]["notebook_id"] == ids["notebook:old"]
    assert restored["note_snapshot"][0]["note_id"] == ids["note:old"]
    assert restored["legacy_chat"][0]["chat_session_id"] == ids["chat_session:old"]
    assert restored["artifact"][0]["source_ids"] == [ids["source:old"], "external"]
    assert restored["artifact"][0]["number"] == 3
    assert restored["link"][0]["remote_notebook_id"] == "notebook:old"
    assert restored["source_link"][0]["remote_source_id"] == "source:old"
    assert restored["evidence"][0]["file_path"] == "restored/bundle/assets/a.pdf"


def test_remap_distrusts_citations_and_provenance_and_disables_replay():
    restored, ids = service()._remap(project(), "bundle")
    citation, invalid = restored["turn"][0]["citations"]
    assert citation["reference_validity"] == "unverified"
    assert citation["archived_reference_validity"] == "verified"
    assert citation["evidence_id"] == ids["ev_old"]
    assert "archive integrity" in citation["reason"]
    assert invalid == {"reference_validity": "invalid"}
    for kind in ("extraction", "evidence"):
        assert restored[kind][0]["verification_origin"] == "restored_archive"
        assert "revalidation" not in restored[kind][0]
    for kind in ("link", "source_link"):
        row = restored[kind][0]
        assert (
            row["mapping_status"],
            row["remote_status"],
            row["last_checked_at"],
            row["requires_rebind"],
        ) == ("unverified", "unverified", None, True)
    job = restored["job"][0]
    assert job["historical_state"] == "running"
    assert job["state"] == "cancelled_local"
    assert job["replay_allowed"] is False and job["restored_history"] is True
    assert job["idempotency_key"] == "restored:" + ids["job_old"]
    assert restored["extraction"][0]["status"] == "failed"
    assert "explicitly re-extract" in restored["extraction"][0]["error"]
    assert restored["version"][0]["status"] == "failed"


@pytest.mark.parametrize("engine", ["independent", "notebooklm", "future"])
def test_remap_scope_hash_uses_new_local_ids_but_not_new_remote_ids(engine):
    data = project()
    scope = {
        "engine": engine,
        "scope_hash": "oldhash",
        "source_version_ids": ["sv_old"],
        "remote_source_ids": ["z", "a"],
        "remote_notebook_id": "notebook:old",
    }
    data["turn"][0].update(scope_hash="oldhash", scope_snapshot=scope)
    restored, ids = service()._remap(data, "bundle")
    turn = restored["turn"][0]
    new_scope = turn["scope_snapshot"]
    assert new_scope["source_version_ids"] == [ids["sv_old"]]
    expected = "oldhash"
    if engine == "independent":
        expected = digest({k: v for k, v in new_scope.items() if k != "scope_hash"})
    elif engine == "notebooklm":
        expected = digest(
            {
                "versions": [ids["sv_old"]],
                "remote": ["a", "z"],
                "notebook": "notebook:old",
            }
        )
    assert new_scope["scope_hash"] == turn["scope_hash"] == expected
    assert turn["archived_scope_hash"] == "oldhash"


def test_remap_completed_extraction_and_version_remain_complete():
    data = project()
    data["extraction"][0]["status"] = "succeeded"
    data["version"][0]["status"] = "ready"
    restored, _ = service()._remap(data, "bundle")
    assert restored["extraction"][0]["status"] == "succeeded"
    assert restored["version"][0]["status"] == "ready"


class MemoryStore:
    def __init__(self):
        self.rows = {}
        self.writes = []
        self.depth = 0

    @asynccontextmanager
    async def project_lock(self, notebook_id):
        assert notebook_id == "notebook:old"
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1

    async def get(self, kind, key):
        assert self.depth == 1
        return copy.deepcopy(self.rows.get((kind, key)))

    async def put(self, kind, key, value, *, create_only=False):
        assert self.depth == 1
        if create_only:
            assert (kind, key) not in self.rows
        self.rows[kind, key] = copy.deepcopy(value)
        self.writes.append((kind, key, copy.deepcopy(value), create_only))


@pytest.fixture
def queue(monkeypatch):
    target = service()
    target.store = MemoryStore()
    target.projects = SimpleNamespace(
        read=AsyncMock(return_value={"id": "notebook:old"})
    )
    submit = AsyncMock(return_value="worker-synthetic")
    monkeypatch.setattr(command_submission, "submit_command", submit)
    return target, submit


def queued(target):
    return next(iter(target.store.rows.values()))


@pytest.mark.asyncio
async def test_request_persists_before_submission_and_reuses_identity(queue):
    target, submit = queue

    async def accept(*args):
        row = queued(target)
        assert row["state"] == "queued" and row["attempts"] == 0
        assert target.store.depth == 0
        assert args == ("open_notebook", "export_portable", {"job_id": row["job_id"]})
        return 17

    submit.side_effect = accept
    first = await target.request_export("notebook:old", " key ")
    expected = "job_" + uuid5(NAMESPACE_URL, "portable:notebook:old: key ").hex
    assert first["job_id"] == expected
    assert first["request_snapshot"] == {"notebook_id": "notebook:old"}
    assert first["request_hash"] == digest({"notebook_id": "notebook:old"})
    assert first["worker_job_id"] == "17"
    assert first["submission_state"] == "confirmed"
    assert target.store.writes[0][3] is True
    assert await target.request_export("notebook:old", " key ") == first
    assert submit.await_count == 1
    assert target.projects.read.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("key", [None, "", "  ", "x" * 201])
async def test_invalid_idempotency_never_reads_or_submits(queue, key):
    target, submit = queue
    with pytest.raises(InvalidInputError):
        await target.request_export("notebook:old", key)
    target.projects.read.assert_not_awaited()
    submit.assert_not_awaited()
    assert target.store.rows == {}


@pytest.mark.asyncio
async def test_missing_project_never_creates_queue_job(queue):
    target, submit = queue
    target.projects.read.side_effect = NotFoundError("missing")
    with pytest.raises(NotFoundError):
        await target.request_export("notebook:old", "key")
    submit.assert_not_awaited()
    assert not target.store.writes


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_ambiguous_submission_preserves_durable_identity_and_cancellation(
    queue, cancel
):
    target, submit = queue
    error = asyncio.CancelledError() if cancel else mod.CommandSubmissionUnknownError()
    submit.side_effect = error
    if cancel:
        with pytest.raises(asyncio.CancelledError):
            await target.request_export("notebook:old", "key")
    else:
        result = await target.request_export("notebook:old", "key")
        assert result == queued(target)
    row = queued(target)
    assert row["state"] == "submission_unknown"
    assert row["submission_state"] == "unknown"
    assert row["error"] == {
        "code": "QUEUE_SUBMISSION_UNKNOWN",
        "message": "Export may be queued; do not automatically retry",
    }
    assert target.store.depth == 0
    assert await target.request_export("notebook:old", "key") == row
    assert submit.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("unknown", [False, True])
async def test_worker_progress_during_submission_is_not_overwritten(queue, unknown):
    target, submit = queue

    async def progressed(*args):
        row = queued(target)
        row.update(state="succeeded", result={"export_id": "already-done"})
        if unknown:
            raise mod.CommandSubmissionUnknownError()
        return "worker"

    submit.side_effect = progressed
    result = await target.request_export("notebook:old", "key")
    assert result["state"] == "succeeded"
    assert result["result"] == {"export_id": "already-done"}
    assert "error" not in result
    if not unknown:
        assert result["worker_job_id"] == "worker"


@pytest.mark.asyncio
@pytest.mark.parametrize("unknown", [False, True])
async def test_disappeared_job_is_not_recreated_after_submission(queue, unknown):
    target, submit = queue

    async def disappeared(*args):
        target.store.rows.clear()
        if unknown:
            raise mod.CommandSubmissionUnknownError()
        return "worker"

    submit.side_effect = disappeared
    expected = mod.CommandSubmissionUnknownError if unknown else NotFoundError
    with pytest.raises(expected):
        await target.request_export("notebook:old", "key")
    assert not target.store.rows
    assert len(target.store.writes) == 1


@pytest.mark.asyncio
async def test_definite_queue_failure_records_sanitized_terminal_failure(queue):
    target, submit = queue
    submit.side_effect = RuntimeError("synthetic-secret")
    with pytest.raises(DatabaseOperationError, match="new idempotency key") as caught:
        await target.request_export("notebook:old", "key")
    assert "synthetic-secret" not in str(caught.value)
    row = queued(target)
    assert row["state"] == "failed"
    assert row["error"] == {
        "code": "QUEUE_UNAVAILABLE",
        "message": "Export could not be queued",
    }
    assert target.store.depth == 0
