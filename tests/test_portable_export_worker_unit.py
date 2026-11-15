"""Export worker decisions with storage, archive and filesystem boundaries doubled."""

import asyncio
import copy
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import NAMESPACE_URL, uuid5

import pytest

from api import portable_service as mod
from open_notebook.exceptions import InvalidInputError, NotFoundError


def job(**changes):
    return {
        "job_id": "job_one",
        "notebook_id": "notebook:one",
        "operation": "portable_export",
        "state": "queued",
        "attempts": 2,
        "submission_state": "unknown",
        **changes,
    }


class Store:
    def __init__(self, reads):
        self.reads = list(reads)
        self.writes = []
        self.events = []
        self.depth = 0
        self.fail_export = False

    async def get(self, kind, identity):
        self.events.append(("get", kind, identity))
        return copy.deepcopy(self.reads.pop(0))

    async def put(self, kind, identity, value):
        assert self.depth == 1
        self.events.append(("put", kind, value.get("state")))
        if kind == "export" and self.fail_export:
            raise OSError("synthetic storage detail")
        self.writes.append((kind, identity, copy.deepcopy(value)))

    @asynccontextmanager
    async def project_lock(self, identity):
        self.events.append(("project-enter", identity))
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1
            self.events.append(("project-exit", identity))


@pytest.fixture
def setup(monkeypatch):
    service = object.__new__(mod.PortableService)
    service.root = Path("/synthetic-root")
    store = Store([job(), job()])
    service.store = store
    path = Mock(spec=Path)
    path.relative_to.return_value = Path("exports/synthetic.zip")
    path.stat.return_value = SimpleNamespace(st_size=17)
    monkeypatch.setattr(
        service,
        "export_project",
        AsyncMock(return_value={"path": path, "manifest": {"version": 1}}),
    )
    digest = Mock(return_value="a" * 64)
    monkeypatch.setattr(mod, "_file_hash", digest)
    monkeypatch.setattr(mod, "_now", lambda: "2030-01-01T00:00:00Z")

    async def inline(function, *args):
        return function(*args)

    monkeypatch.setattr(mod.asyncio, "to_thread", inline)

    @asynccontextmanager
    async def export_lock(root, identity):
        assert root == service.root
        store.events.append(("export-enter", identity))
        try:
            yield
        finally:
            store.events.append(("export-exit", identity))

    monkeypatch.setattr(mod, "_export_job_lock", export_lock)
    return service, store, path, digest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "initial,error",
    [
        (None, NotFoundError),
        (job(operation="other"), NotFoundError),
        (job(replay_allowed=False), InvalidInputError),
    ],
)
async def test_initial_rejection_does_not_lock_write_or_export(setup, initial, error):
    service, store, _, _ = setup
    store.reads = [initial]
    with pytest.raises(error):
        await service.run_export("job_one")
    assert store.events == [("get", "job", "job_one")]
    assert store.writes == []
    service.export_project.assert_not_awaited()


@pytest.mark.asyncio
async def test_completed_job_returns_without_export_lock(setup):
    service, store, _, _ = setup
    saved = job(state="succeeded", result={"export_id": "already"})
    store.reads = [saved]
    assert await service.run_export("job_one") == saved
    assert store.events == [("get", "job", "job_one")]
    service.export_project.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "latest,error",
    [(None, NotFoundError), (job(replay_allowed=False), InvalidInputError)],
)
async def test_locked_recheck_rejects_missing_or_historical_job(setup, latest, error):
    service, store, _, _ = setup
    store.reads = [job(), latest]
    with pytest.raises(error):
        await service.run_export("job_one")
    assert store.events[-2:] == [
        ("project-exit", "notebook:one"),
        ("export-exit", "job_one"),
    ]
    assert store.writes == []
    service.export_project.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["succeeded", "cancelled_local"])
async def test_locked_terminal_state_wins_without_replay(setup, state):
    service, store, _, _ = setup
    latest = job(state=state)
    store.reads = [job(), latest]
    assert await service.run_export("job_one") == latest
    service.export_project.assert_not_awaited()
    assert store.writes == []


@pytest.mark.asyncio
async def test_success_preserves_worker_identity_and_publishes_after_digest(setup):
    service, store, path, digest = setup
    store.reads = [job(), job(error={"code": "QUEUE_SUBMISSION_UNKNOWN"})]

    async def archive(notebook_id, export_id):
        assert store.depth == 0
        assert store.writes[0][2]["state"] == "running"
        assert store.writes[0][2]["attempts"] == 3
        assert "error" not in store.writes[0][2]
        return {"path": path, "manifest": {"version": 1}}

    service.export_project.side_effect = archive
    result = await service.run_export("job_one")
    export_id = "export_" + uuid5(NAMESPACE_URL, "job_one").hex
    service.export_project.assert_awaited_once_with("notebook:one", export_id=export_id)
    digest.assert_called_once_with(path)
    path.relative_to.assert_called_once_with(service.root)
    assert [r[0] for r in store.writes] == ["job", "export", "job"]
    assert store.writes[1] == (
        "export",
        export_id,
        {
            "export_id": export_id,
            "notebook_id": "notebook:one",
            "job_id": "job_one",
            "file_path": "exports/synthetic.zip",
            "sha256": "a" * 64,
            "byte_size": 17,
            "created_at": "2030-01-01T00:00:00Z",
            "manifest": {"version": 1},
        },
    )
    assert result["state"] == "succeeded"
    assert result["submission_state"] == "confirmed"
    assert result["result"] == {
        "export_id": export_id,
        "download_url": f"/api/personal/exports/{export_id}/download",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", ["archive-invalid", "archive-internal", "digest", "stat", "store"]
)
async def test_export_failure_removes_result_without_claiming_success(setup, failure):
    service, store, path, digest = setup
    store.reads = [job(), job(result={"export_id": "stale"})]
    error = (
        InvalidInputError("inconsistent snapshot")
        if failure == "archive-invalid"
        else OSError("synthetic storage detail")
    )
    if failure.startswith("archive"):
        service.export_project.side_effect = error
    elif failure == "digest":
        digest.side_effect = error
    elif failure == "stat":
        path.stat.side_effect = error
    else:
        store.fail_export = True
    with pytest.raises(type(error)):
        await service.run_export("job_one")
    final = store.writes[-1][2]
    assert final["state"] == "failed"
    assert "result" not in final
    assert final["error"]["code"] == "EXPORT_FAILED"
    assert final["error"]["message"] == (
        "inconsistent snapshot"
        if failure == "archive-invalid"
        else "Export failed consistency, integrity or storage checks; no download was published"
    )
    assert not any(row[2].get("state") == "succeeded" for row in store.writes)
    assert not any(row[0] == "export" for row in store.writes)


@pytest.mark.asyncio
async def test_cancellation_is_not_reclassified_or_published(setup):
    service, store, _, _ = setup
    cancellation = asyncio.CancelledError()
    service.export_project.side_effect = cancellation
    with pytest.raises(asyncio.CancelledError) as caught:
        await service.run_export("job_one")
    assert caught.value is cancellation
    assert [row[2]["state"] for row in store.writes] == ["running"]
    assert store.events[-1] == ("export-exit", "job_one")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "size,digest_value,accepted",
    [(17, "a" * 64, True), (18, "a" * 64, False), (17, "b" * 64, False)],
)
async def test_download_requires_both_stored_size_and_digest(
    setup, monkeypatch, size, digest_value, accepted
):
    service, store, path, digest = setup
    store.reads = [
        {"file_path": "exports/synthetic.zip", "byte_size": 17, "sha256": "a" * 64}
    ]
    path.stat.return_value = SimpleNamespace(st_size=size)
    digest.return_value = digest_value
    confined = Mock(return_value=path)
    monkeypatch.setattr(mod, "_confined_file", confined)
    if accepted:
        assert await service.download("export_one") is path
    else:
        with pytest.raises(InvalidInputError, match="integrity"):
            await service.download("export_one")
    confined.assert_called_once_with(service.root, "exports/synthetic.zip")
    digest.assert_called_once_with(path)
    assert store.writes == []


@pytest.mark.asyncio
async def test_missing_download_never_resolves_a_path(setup, monkeypatch):
    service, store, _, digest = setup
    store.reads = [None]
    confined = Mock()
    monkeypatch.setattr(mod, "_confined_file", confined)
    with pytest.raises(NotFoundError):
        await service.download("absent")
    confined.assert_not_called()
    digest.assert_not_called()
