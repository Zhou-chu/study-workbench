"""Finish/cache business policy only; no checkpoint, file or provider execution."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.web_discovery_service import WebDiscoveryService, _digest
from open_notebook.exceptions import InvalidInputError


class MemoryStore:
    def __init__(self, events):
        self.rows = {}
        self.events = events
        self.locked = False

    async def get(self, kind, identity):
        self.events.append(("get", kind))
        return deepcopy(self.rows.get((kind, identity)))

    async def put(self, kind, identity, value, create_only=False):
        if create_only:
            assert (kind, identity) not in self.rows
        self.events.append(("put", kind, create_only))
        self.rows[kind, identity] = deepcopy(value)

    @asynccontextmanager
    async def project_lock(self, identity):
        assert not self.locked
        self.locked = True
        self.events.append(("lock", identity))
        try:
            yield
        finally:
            self.locked = False
            self.events.append(("unlock", identity))


@pytest.fixture
def harness():
    events: list[tuple[object, ...]] = []
    store = MemoryStore(events)
    checkpoint = {
        "url": "https://example.invalid/article",
        "title": "Synthetic",
        "snippet": "summary",
        "retrieved_at": "2026-01-01T00:00:00+00:00",
        "content": "资料正文",
    }
    suffix = _digest(["notebook:test", checkpoint["url"]])
    sid, vid, jid = "source:web_" + suffix, "sv_web_" + suffix, "job_web_" + suffix

    async def ensure(*args):
        events.append(("ensure", args))

    async def ingest(*args, **kwargs):
        events.append(("ingest", args, kwargs))
        row = {
            "source_version_id": vid,
            "source_id": sid,
            "notebook_id": "notebook:test",
        }
        store.rows["version", vid] = row
        return deepcopy(row)

    async def submit(*args):
        assert not store.locked
        events.append(("submit", args))
        return "command:synthetic"

    evidence = SimpleNamespace(
        ingest=AsyncMock(side_effect=ingest), resolve_file=AsyncMock(return_value=None)
    )
    service = WebDiscoveryService(
        store=store,
        provider=object(),
        evidence=evidence,
        submit=AsyncMock(side_effect=submit),
        ensure_source=AsyncMock(side_effect=ensure),
        source_available=AsyncMock(return_value=True),
        validate=AsyncMock(),
        data_root="unused-synthetic-root",
    )
    return SimpleNamespace(
        service=service,
        store=store,
        events=events,
        checkpoint=checkpoint,
        sid=sid,
        vid=vid,
        jid=jid,
    )


async def finish(h):
    return await h.service._finish("notebook:test", "url:synthetic", h.checkpoint)


def retained(h, state="queued", worker=None):
    h.store.rows["version", h.vid] = {
        "source_version_id": h.vid,
        "source_id": h.sid,
        "notebook_id": "notebook:test",
    }
    h.store.rows["job", h.jid] = {
        "job_id": h.jid,
        "state": state,
        "worker_job_id": worker,
        "marker": "retain",
    }


@pytest.mark.asyncio
async def test_new_snapshot_provenance_and_durable_job_precede_queue(harness):
    h = harness
    result = await finish(h)
    assert result.state == "queued" and result.source_version_id == h.vid
    assert h.store.rows["job", h.jid]["worker_job_id"] == "command:synthetic"
    args, kwargs = h.service.evidence.ingest.call_args
    assert args[:3] == ("notebook:test", h.sid, "Synthetic")
    assert (
        args[3].decode()
        == "Source URL: https://example.invalid/article\nRetrieved: 2026-01-01T00:00:00+00:00\nProvider: Firecrawl\nFormat: retrieved Markdown snapshot, not original page bytes\n\n---\n\n资料正文"
    )
    assert kwargs["origin"] == "web_snapshot" and kwargs["original_status"] == "missing"
    assert kwargs["preserve_on_error"] is True and kwargs["source_version_id"] == h.vid
    assert kwargs["provenance"]["search_result_snippet"] == "summary"
    labels = [e[0] for e in h.events]
    assert (
        labels.index("ensure")
        < labels.index("ingest")
        < labels.index("put")
        < labels.index("submit")
    )
    h.service.evidence.resolve_file.assert_not_called()
    h.service.submit.assert_awaited_once_with(
        "extract_evidence", {"source_version_id": h.vid, "job_id": h.jid}
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state,worker,expected",
    [
        ("running", None, "queued"),
        ("succeeded", None, "queued"),
        ("cancelled_local", None, "saved"),
        ("queued", "command:existing", "queued"),
    ],
)
async def test_existing_or_started_jobs_are_not_replayed(
    harness, state, worker, expected
):
    h = harness
    retained(h, state, worker)
    before = deepcopy(h.store.rows["job", h.jid])
    response = await finish(h)
    assert response.state == expected
    assert h.store.rows["job", h.jid] == before
    h.service.submit.assert_not_called()
    h.service.evidence.ingest.assert_not_called()
    h.service.evidence.resolve_file.assert_awaited_once_with(h.vid)
    if expected == "saved":
        assert response.warning == "WEB_EXTRACTION_NOT_QUEUED"


@pytest.mark.asyncio
async def test_unavailable_existing_source_does_not_recreate_or_enqueue(harness):
    h = harness
    retained(h)
    h.service.source_available.return_value = False
    with pytest.raises(InvalidInputError, match="WEB_IMPORTED_SOURCE_UNAVAILABLE"):
        await finish(h)
    h.service.ensure_source.assert_not_called()
    h.service.evidence.resolve_file.assert_not_called()
    h.service.submit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["ensure", "ingest", "resolve"])
async def test_prequeue_failure_never_dispatches(harness, boundary):
    h = harness
    error = RuntimeError("synthetic boundary failure")
    if boundary == "resolve":
        retained(h)
    seam = {
        "ensure": h.service.ensure_source,
        "ingest": h.service.evidence.ingest,
        "resolve": h.service.evidence.resolve_file,
    }[boundary]
    seam.side_effect = error
    with pytest.raises(RuntimeError) as caught:
        await finish(h)
    assert caught.value is error
    h.service.submit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["queued", "running", "succeeded", "cancelled_local"])
@pytest.mark.parametrize("lost_ack", [False, True])
async def test_worker_race_result_survives_queue_ack_or_loss(harness, state, lost_ack):
    h = harness

    async def submit(*args):
        assert not h.store.locked
        h.store.rows["job", h.jid].update(state=state, result={"worker": "preserved"})
        if lost_ack:
            raise RuntimeError("synthetic lost ACK")
        return "command:ack"

    h.service.submit.side_effect = submit
    response = await finish(h)
    job = h.store.rows["job", h.jid]
    assert job["result"] == {"worker": "preserved"}
    assert job["state"] == ("failed" if state == "queued" and lost_ack else state)
    assert response.state == (
        "saved" if lost_ack and state in ("queued", "cancelled_local") else "queued"
    )
    if lost_ack:
        assert not job.get("worker_job_id")
        if state == "queued":
            assert job["error"] == {
                "code": "WEB_EXTRACTION_NOT_QUEUED",
                "message": "WEB_EXTRACTION_NOT_QUEUED",
            }
    else:
        assert job["worker_job_id"] == "command:ack"
    assert h.service.submit.await_count == 1 and not h.store.locked


@pytest.mark.asyncio
async def test_cancellation_leaves_durable_job_and_does_not_claim_failure(harness):
    h = harness
    error = asyncio.CancelledError()
    h.service.submit.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await finish(h)
    assert caught.value is error
    job = h.store.rows["job", h.jid]
    assert job["state"] == "queued" and job["error"] is None
    assert h.service.submit.await_count == 1 and not h.store.locked


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["missing", "source", "notebook", "unavailable"])
async def test_cached_response_checks_ownership_before_return(harness, change):
    h = harness
    retained(h)
    result = {
        "state": "queued",
        "source_id": h.sid,
        "source_version_id": h.vid,
        "job_id": h.jid,
        "url": h.checkpoint["url"],
    }
    if change == "missing":
        del h.store.rows["version", h.vid]
    elif change == "source":
        h.store.rows["version", h.vid]["source_id"] = "source:foreign"
    elif change == "notebook":
        h.store.rows["version", h.vid]["notebook_id"] = "notebook:foreign"
    else:
        h.service.source_available.return_value = False
    with pytest.raises(InvalidInputError, match="WEB_IMPORTED_SOURCE_UNAVAILABLE"):
        await h.service._cached_response("notebook:test", result)
    assert h.service.source_available.await_count == (
        1 if change == "unavailable" else 0
    )
    h.service.submit.assert_not_called()


@pytest.mark.asyncio
async def test_cached_response_is_validated_copy_without_any_replay(harness):
    h = harness
    retained(h)
    result = {
        "state": "already_imported",
        "source_id": h.sid,
        "source_version_id": h.vid,
        "job_id": h.jid,
        "url": h.checkpoint["url"],
    }
    before = deepcopy(result)
    response = await h.service._cached_response("notebook:test", result)
    assert response.state == "already_imported" and response.job_id == h.jid
    assert result == before
    h.service.source_available.assert_awaited_once_with("notebook:test", h.sid)
    h.service.ensure_source.assert_not_called()
    h.service.evidence.ingest.assert_not_called()
    h.service.submit.assert_not_called()


@pytest.mark.asyncio
async def test_repeated_finish_reuses_saved_version_and_worker_ack(harness):
    h = harness
    first = await finish(h)
    second = await finish(h)
    assert first.model_dump() == second.model_dump()
    assert h.service.evidence.ingest.await_count == 1
    h.service.evidence.resolve_file.assert_awaited_once_with(h.vid)
    assert h.service.submit.await_count == 1
    assert len([e for e in h.events if e[:2] == ("put", "job") and e[2]]) == 1
