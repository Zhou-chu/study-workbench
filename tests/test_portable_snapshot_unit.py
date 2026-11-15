"""Snapshot coordinator unit: in-memory reads and staging boundary, real validation."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import NotRequired, TypedDict

import pytest

from api import portable_service as target
from open_notebook.exceptions import InvalidInputError


class SnapshotProject(TypedDict):
    notebook: dict[str, object]
    sources: list[dict[str, object]]
    notes: list[dict[str, object]]
    chat_sessions: list[dict[str, object]]
    source_insights: list[dict[str, object]]
    note_snapshot: NotRequired[list[dict[str, object]]]
    legacy_chat: NotRequired[list[dict[str, object]]]


@pytest.fixture
def harness(monkeypatch):
    events = []
    state = SimpleNamespace(locked=False, reads=0, fail=None, changed=False)
    project: SnapshotProject = {
        "notebook": {"id": "notebook:synthetic", "name": "Synthetic"},
        "sources": [],
        "notes": [],
        "chat_sessions": [],
        "source_insights": [],
    }
    personal: dict[str, list[dict[str, object]]] = {
        kind: [] for kind in target.PERSONAL_KINDS
    }

    @asynccontextmanager
    async def lock(identity):
        assert identity == "notebook:synthetic" and not state.locked
        state.locked = True
        events.append("lock")
        try:
            yield
        finally:
            state.locked = False
            events.append("unlock")

    async def read(identity):
        assert state.locked and identity == "notebook:synthetic"
        state.reads += 1
        events.append("read")
        if state.fail == "read":
            raise RuntimeError("read failed")
        result = deepcopy(project)
        if state.changed and state.reads == 2:
            result["notebook"]["name"] = "changed"
        return result

    async def listing(kind, notebook_id):
        assert state.locked and notebook_id == "notebook:synthetic"
        events.append("list:" + kind)
        if state.fail == "list":
            raise RuntimeError("list failed")
        return deepcopy(personal[kind])

    service = target.PortableService(
        store=SimpleNamespace(project_lock=lock, list=listing),
        project_repository=SimpleNamespace(read=read),
        data_root="synthetic-unused",
    )
    stage = object()

    def stage_files(value, destination):
        assert state.locked and destination is stage
        events.append("stage")
        if state.fail == "stage":
            raise RuntimeError("stage failed")
        if state.fail == "cancel":
            raise asyncio.CancelledError()
        state.staged = deepcopy(value)
        return {}, [{"reason": "synthetic unavailable original"}]

    monkeypatch.setattr(service, "_stage_files", stage_files)
    return SimpleNamespace(
        service=service,
        state=state,
        project=project,
        personal=personal,
        events=events,
        stage=stage,
    )


async def snapshot(h):
    return await h.service._snapshot("notebook:synthetic", h.stage)


@pytest.mark.asyncio
async def test_staging_and_second_read_share_barrier_return_detached_snapshot(harness):
    h = harness
    result, files, missing = await snapshot(h)
    assert set(result) == set(target.FILES)
    assert files == {} and missing == [{"reason": "synthetic unavailable original"}]
    assert h.events[0:2] == ["lock", "read"]
    assert h.events[-3:] == ["stage", "read", "unlock"]
    assert h.state.reads == 2 and not h.state.locked
    h.project["notebook"]["name"] = "later live edit"
    assert result["notebook"]["name"] == "Synthetic"
    assert result["legacy_chat"] == []
    assert "list:legacy_chat" not in h.events


@pytest.mark.asyncio
@pytest.mark.parametrize("owned_snapshots", [False, True])
async def test_note_snapshot_and_legacy_chat_ownership_is_preserved(
    harness, owned_snapshots
):
    h = harness
    h.project["notes"] = [{"id": "note:one", "content": "saved", "revision": 3}]
    row = {"note_id": "note:one", "revision": 3, "citations": []}
    if owned_snapshots:
        h.project["note_snapshot"] = [row]
        h.personal["note_snapshot"] = [{"note_id": "note:untrusted"}]
    else:
        h.personal["note_snapshot"] = [row]
    h.project["chat_sessions"] = [{"id": "chat:one"}]
    h.project["legacy_chat"] = [{"chat_session_id": "chat:one", "messages": []}]
    h.personal["legacy_chat"] = [{"chat_session_id": "chat:wrong"}]
    result, _, _ = await snapshot(h)
    assert result["note_snapshot"] == [row]
    assert result["legacy_chat"] == h.project["legacy_chat"]
    assert ("list:note_snapshot" in h.events) is (not owned_snapshots)
    assert "list:legacy_chat" not in h.events


@pytest.mark.asyncio
async def test_cleaning_filters_export_jobs_and_marks_historical_web_data(harness):
    h = harness
    h.project["notebook"]["api_key"] = "synthetic-private-value"
    h.personal["job"] = [
        {"job_id": "job:export", "operation": "portable_export", "state": "running"},
        {
            "job_id": "job:extract",
            "operation": "extract_evidence",
            "state": "queued",
            "worker_job_id": "worker:private",
        },
    ]
    h.personal["import_report"] = [
        {
            "import_report_id": "report:one",
            "provenance": {
                "kind": "web",
                "source_url": "https://example.invalid",
                "cookie": "synthetic-cookie",
            },
        }
    ]
    before = deepcopy((h.project, h.personal))
    result, _, _ = await snapshot(h)
    assert result["job"] == [
        {"job_id": "job:extract", "operation": "extract_evidence", "state": "queued"}
    ]
    assert "api_key" not in result["notebook"]
    assert result["import_report"][0]["provenance"] == {
        "kind": "web",
        "historical_url_omitted": True,
    }
    assert (
        "historical_url_omitted" not in h.state.staged["import_report"][0]["provenance"]
    )
    assert (h.project, h.personal) == before


@pytest.mark.asyncio
async def test_live_project_change_rejects_after_staging_without_return(harness):
    h = harness
    h.state.changed = True
    with pytest.raises(
        InvalidInputError, match="Project changed during legacy snapshot"
    ):
        await snapshot(h)
    assert h.events[-3:] == ["stage", "read", "unlock"]
    assert not h.state.locked


@pytest.mark.asyncio
async def test_actual_project_validation_rejects_dangling_reference(harness):
    h = harness
    h.personal["selection"] = [
        {"notebook_id": "notebook:synthetic", "source_version_ids": ["sv:missing"]}
    ]
    with pytest.raises(InvalidInputError, match="Dangling source_version_ids"):
        await snapshot(h)
    assert h.state.reads == 2 and not h.state.locked


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["read", "list", "stage", "cancel"])
async def test_error_and_cancel_propagate_without_leaking_barrier(harness, phase):
    h = harness
    h.state.fail = phase
    error = asyncio.CancelledError if phase == "cancel" else RuntimeError
    with pytest.raises(error):
        await snapshot(h)
    assert not h.state.locked and h.events[-1] == "unlock"
    assert h.state.reads == 1
    if phase in ("read", "list"):
        assert "stage" not in h.events
