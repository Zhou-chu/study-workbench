"""Import decisions with memory receipts/checkpoints, no disk, threads or provider I/O."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import web_discovery_service as mod
from api.web_discovery_contracts import WebIdempotencyConflict, WebImportRequest
from open_notebook.exceptions import (
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    RateLimitError,
)

NB = "notebook:synthetic"
URL = "https://example.com/article"


def request(key="one", **changes):
    return WebImportRequest(
        **(
            dict(url=URL, title="合成资料", snippet="概要", idempotency_key=key)
            | changes
        )
    )


@pytest.fixture
def h(monkeypatch):
    rows: dict[tuple[str, str], dict[str, object]] = {}
    checkpoints: dict[str, dict[str, object]] = {}
    events: list[tuple[object, ...]] = []
    state = SimpleNamespace(lock=None, fail_complete=False, race_result=None)
    service = object.__new__(mod.WebDiscoveryService)

    async def get(kind, identity):
        events.append(("get", kind, identity))
        return deepcopy(rows.get((kind, identity)))

    async def put(kind, identity, value, create_only=False):
        events.append(("put", kind, identity, deepcopy(value), create_only))
        if state.fail_complete and kind == "import_report" and value.get("result"):
            raise RuntimeError("synthetic lost ACK")
        if create_only:
            assert (kind, identity) not in rows
        rows[kind, identity] = deepcopy(value)

    @asynccontextmanager
    async def lock(identity):
        previous = state.lock
        assert identity != previous
        state.lock = identity
        events.append(("lock", identity))
        if identity.startswith("web-finish:") and state.race_result:
            rid = "web-request:" + mod._digest([NB, "one"])
            rows["import_report", rid]["result"] = state.race_result
        try:
            yield
        finally:
            events.append(("unlock", identity))
            state.lock = previous

    async def scrape(url):
        assert state.lock is None
        events.append(("scrape", url))
        assert len([r for (k, _), r in rows.items() if k == "import_report"]) == 2
        return "正文"

    def read(identity, url):
        events.append(("checkpoint-read", identity, url))
        return deepcopy(checkpoints.get(identity))

    def write(identity, value):
        events.append(("checkpoint-write", identity))
        checkpoints[identity] = deepcopy(value)

    async def inline(function, *args):
        assert function in (read, write)
        return function(*args)

    async def ingest(notebook_id, source_id, title, content, **options):
        events.append(("ingest", content))
        value = dict(
            source_version_id=options["source_version_id"],
            source_id=source_id,
            notebook_id=notebook_id,
        )
        rows["version", options["source_version_id"]] = value
        return value

    service.store = SimpleNamespace(get=get, put=put, project_lock=lock)
    service.provider = SimpleNamespace(scrape=AsyncMock(side_effect=scrape))
    service.validate = AsyncMock()
    service.ensure_source = AsyncMock()
    service.source_available = AsyncMock(return_value=True)
    service.evidence = SimpleNamespace(
        ingest=AsyncMock(side_effect=ingest), resolve_file=AsyncMock()
    )
    service.submit = AsyncMock(return_value="worker:synthetic")
    monkeypatch.setattr(service, "_read_checkpoint", read)
    monkeypatch.setattr(service, "_write_checkpoint", write)
    monkeypatch.setattr(mod.asyncio, "to_thread", inline)
    return SimpleNamespace(
        service=service, rows=rows, checkpoints=checkpoints, events=events, state=state
    )


def ids(key="one"):
    return "web-request:" + mod._digest([NB, key]), "web-url:" + mod._digest([NB, URL])


def seed_pending(h, key="one", state="fetching", created="2000-01-01T00:00:00+00:00"):
    rid, uid = ids(key)
    h.rows["import_report", uid] = dict(
        import_report_id=uid,
        notebook_id=NB,
        request_id=rid,
        state=state,
        url=URL,
        title="合成资料",
        snippet="概要",
        created_at=created,
    )
    return rid, uid


@pytest.mark.asyncio
async def test_success_orders_receipts_provider_checkpoint_and_completion(h):
    response = await h.service.import_source(NB, request())
    rid, uid = ids()
    assert response.state == "queued"
    assert response.url == URL
    assert h.rows["import_report", rid]["result"] == response.model_dump()
    assert h.rows["import_report", uid]["result"] == response.model_dump()
    assert h.checkpoints[uid]["content"] == "正文"
    assert h.checkpoints[uid]["sha256"] == mod._digest("正文")
    names = [e[0] for e in h.events]
    assert (
        names.index("put")
        < names.index("scrape")
        < names.index("checkpoint-write")
        < names.index("ingest")
    )
    assert h.state.lock is None
    h.service.validate.assert_awaited_once_with(URL, "web-import")
    h.service.submit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        {"url": "https://example.com/other"},
        {"title": "changed"},
        {"snippet": "changed"},
    ],
)
async def test_same_key_changed_request_conflicts_without_second_dispatch(h, change):
    await h.service.import_source(NB, request())
    before = deepcopy(h.rows)
    with pytest.raises(WebIdempotencyConflict):
        await h.service.import_source(NB, request(**change))
    assert h.rows == before
    assert h.service.provider.scrape.await_count == 1
    assert h.service.submit.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("new_key", [False, True])
async def test_completed_replay_returns_copy_without_checkpoint_or_provider(h, new_key):
    first = await h.service.import_source(NB, request())
    h.events.clear()
    second = await h.service.import_source(NB, request("two" if new_key else "one"))
    assert second is not first
    assert second.source_version_id == first.source_version_id
    assert second.state == ("already_imported" if new_key else "queued")
    assert not any(e[0].startswith("checkpoint") for e in h.events)
    assert h.service.provider.scrape.await_count == h.service.submit.await_count == 1
    if new_key:
        assert h.rows["import_report", ids("two")[0]]["result"] == second.model_dump()


@pytest.mark.asyncio
async def test_validation_rejection_precedes_receipts_and_provider(h):
    h.service.validate.side_effect = ValueError("bad selection")
    with pytest.raises(InvalidInputError, match="WEB_INVALID_URL"):
        await h.service.import_source(NB, request())
    assert h.rows == {} and h.events == []
    h.service.provider.scrape.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_type,known",
    [
        (ConfigurationError, True),
        (RateLimitError, True),
        (NetworkError, False),
        (InvalidInputError, False),
        (ExternalServiceError, False),
    ],
)
async def test_provider_outcome_records_replay_policy_and_preserves_known_error(
    h, error_type, known
):
    error = error_type("synthetic rejection")
    h.service.provider.scrape.side_effect = error
    with pytest.raises(error_type if known else ExternalServiceError) as caught:
        await h.service.import_source(NB, request())
    if known:
        assert caught.value is error
    else:
        assert str(caught.value) == "WEB_IMPORT_OUTCOME_UNKNOWN"
    for identity in ids():
        row = h.rows["import_report", identity]
        assert row["state"] == ("failed" if known else "outcome_unknown")
        assert row["error_type"] == error_type.__name__
    assert h.checkpoints == {}
    h.service.submit.assert_not_awaited()
    with pytest.raises(error_type if known else InvalidInputError):
        await h.service.import_source(NB, request())
    assert h.service.provider.scrape.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error", [asyncio.CancelledError(), RuntimeError("unknown transport")]
)
async def test_unclassified_failure_leaves_dispatch_receipt_and_never_finishes(
    h, error
):
    h.service.provider.scrape.side_effect = error
    with pytest.raises(type(error)) as caught:
        await h.service.import_source(NB, request())
    assert caught.value is error
    assert all(
        h.rows["import_report", identity]["state"] == "fetching" for identity in ids()
    )
    assert h.state.lock is None
    assert h.checkpoints == {}
    h.service.evidence.ingest.assert_not_awaited()
    h.service.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state,created,code",
    [
        ("fetching", "2999-01-01T00:00:00+00:00", "WEB_IMPORT_IN_PROGRESS"),
        ("fetching", "2000-01-01T00:00:00+00:00", "WEB_IMPORT_OUTCOME_UNKNOWN"),
        ("outcome_unknown", "2999-01-01T00:00:00+00:00", "WEB_IMPORT_OUTCOME_UNKNOWN"),
    ],
)
async def test_same_key_without_checkpoint_does_not_refetch(h, state, created, code):
    seed_pending(h, state=state, created=created)
    with pytest.raises(InvalidInputError, match=code):
        await h.service.import_source(NB, request())
    h.service.provider.scrape.assert_not_awaited()
    h.service.submit.assert_not_awaited()
    assert h.state.lock is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state,code",
    [
        ("fetching", "WEB_IMPORT_IN_PROGRESS"),
        ("outcome_unknown", "WEB_IMPORT_OUTCOME_UNKNOWN"),
    ],
)
async def test_new_key_without_checkpoint_rejects_before_claim(h, state, code):
    seed_pending(h, key="old", state=state)
    before = deepcopy(h.rows)
    with pytest.raises(InvalidInputError, match=code):
        await h.service.import_source(NB, request())
    assert h.rows == before
    h.service.provider.scrape.assert_not_awaited()


@pytest.mark.asyncio
async def test_new_key_recovers_checkpoint_without_provider_replay(h):
    _, uid = seed_pending(h, key="old", state="outcome_unknown")
    h.checkpoints[uid] = dict(
        url=URL,
        content="saved text",
        title="Original",
        snippet="saved",
        retrieved_at="2026-01-01T00:00:00+00:00",
    )
    result = await h.service.import_source(NB, request())
    assert result.state == "queued"
    h.service.provider.scrape.assert_not_awaited()
    assert b"saved text" in h.service.evidence.ingest.await_args.args[3]
    assert h.service.evidence.ingest.await_args.args[2] == "Original"
    h.service.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_finish_receipt_failure_retries_from_checkpoint_without_requeue(h):
    h.state.fail_complete = True
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        await h.service.import_source(NB, request())
    assert len(h.checkpoints) == 1
    h.state.fail_complete = False
    result = await h.service.import_source(NB, request())
    assert result.state == "queued"
    assert h.service.provider.scrape.await_count == 1
    assert h.service.evidence.ingest.await_count == 1
    assert h.service.submit.await_count == 1
    h.service.evidence.resolve_file.assert_awaited_once_with(result.source_version_id)


@pytest.mark.asyncio
async def test_saved_receipt_retries_only_local_queue(h):
    h.service.submit.side_effect = RuntimeError("queue unavailable")
    first = await h.service.import_source(NB, request())
    assert first.state == "saved" and first.warning == "WEB_EXTRACTION_NOT_QUEUED"
    h.service.submit.side_effect = None
    second = await h.service.import_source(NB, request("two"))
    assert second.state == "queued"
    assert second.source_version_id == first.source_version_id
    assert (
        h.service.provider.scrape.await_count
        == h.service.evidence.ingest.await_count
        == 1
    )
    assert h.service.submit.await_count == 2


@pytest.mark.asyncio
async def test_finish_race_rechecks_completed_receipt_without_repeating_local_work(h):
    first = await h.service.import_source(NB, request())
    rid, _ = ids()
    h.rows["import_report", rid].pop("result")
    h.rows["import_report", ids()[1]].pop("result")
    h.rows["import_report", ids()[1]]["state"] = "outcome_unknown"
    h.state.race_result = first.model_dump()
    before = h.service.ensure_source.await_count
    second = await h.service.import_source(NB, request())
    assert second == first
    assert h.service.ensure_source.await_count == before
    assert h.service.provider.scrape.await_count == h.service.submit.await_count == 1
    assert h.state.lock is None


@pytest.mark.asyncio
async def test_finish_domain_failure_preserves_identity_and_checkpoint(h):
    error = InvalidInputError("synthetic source refusal")
    h.service.ensure_source.side_effect = error
    with pytest.raises(InvalidInputError) as caught:
        await h.service.import_source(NB, request())
    assert caught.value is error
    assert len(h.checkpoints) == 1
    assert all(
        h.rows["import_report", identity]["state"] == "fetching" for identity in ids()
    )
    h.service.evidence.ingest.assert_not_awaited()
    h.service.submit.assert_not_awaited()
    assert h.state.lock is None


@pytest.mark.asyncio
async def test_dispatch_receipt_write_failure_prevents_provider(h, monkeypatch):
    error = RuntimeError("dispatch unavailable")
    original = h.service.store.put

    async def fail_url(kind, identity, value, **options):
        if identity == ids()[1]:
            raise error
        return await original(kind, identity, value, **options)

    monkeypatch.setattr(h.service.store, "put", fail_url)
    with pytest.raises(RuntimeError) as caught:
        await h.service.import_source(NB, request())
    assert caught.value is error
    assert ("import_report", ids()[0]) in h.rows
    assert ("import_report", ids()[1]) not in h.rows
    assert h.state.lock is None
    h.service.provider.scrape.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,error_type",
    [
        ("ConfigurationError", ConfigurationError),
        ("RateLimitError", RateLimitError),
        ("NetworkError", NetworkError),
        ("InvalidInputError", InvalidInputError),
        ("OtherError", ExternalServiceError),
    ],
)
async def test_failed_request_receipt_uses_recorded_error_without_dispatch(
    h, kind, error_type
):
    req = request()
    rid, _ = ids()
    h.rows["import_report", rid] = dict(
        request_hash=mod._digest(
            req.model_dump(exclude={"idempotency_key"}) | {"url": URL}
        ),
        state="failed",
        error="recorded failure",
        error_type=kind,
    )
    with pytest.raises(error_type, match="recorded failure"):
        await h.service.import_source(NB, req)
    h.service.provider.scrape.assert_not_awaited()
    h.service.submit.assert_not_awaited()
    assert h.state.lock is None
    assert len(h.rows) == 1
