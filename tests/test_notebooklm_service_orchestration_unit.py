"""NotebookLM service units with memory-only I/O stubs, never PersonalStore/SDK."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from api import notebooklm_service as m
from open_notebook.exceptions import NotFoundError
from open_notebook.integrations.notebooklm.contracts import BridgeError

pytestmark = pytest.mark.asyncio


@pytest.fixture
def service(monkeypatch):
    rows = {}
    locks = []

    @asynccontextmanager
    async def lock(key):
        locks.append(key)
        yield

    async def get(kind, key):
        return deepcopy(rows.get((kind, key)))

    async def put(kind, key, value, **kwargs):
        rows[kind, key] = deepcopy(value)

    store = NS(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        list=AsyncMock(return_value=[]),
        project_lock=lock,
    )
    bridge = NS(
        list_sources=AsyncMock(),
        verify_connection=AsyncMock(return_value=NS(state="connected")),
        capabilities=AsyncMock(),
    )
    monkeypatch.setattr(m, "now", lambda: "2026-01-01T00:00:00+00:00")
    return NS(
        s=m.NotebookLMService(
            store=store, bridge=bridge, enqueue=None, evidence=object()
        ),
        store=store,
        bridge=bridge,
        rows=rows,
        locks=locks,
    )


def page(ids=(), cursor=None, complete=True):
    return NS(
        items=[NS(id=x) for x in ids], next_cursor=cursor, listing_complete=complete
    )


async def test_source_pages_accumulate_and_record_only_completed_listing(service):
    f = service
    f.bridge.list_sources.side_effect = [page(["a"], "next", False), page(["b"])]
    result = await f.s.all_sources("remote")
    assert [r.id for r in result] == ["a", "b"]
    assert [c.args for c in f.bridge.list_sources.await_args_list] == [
        ("remote", None),
        ("remote", "next"),
    ]
    assert f.rows["connection", "capability_list_sources"] == {
        "connection_type": "capability",
        "name": "list_sources",
        "last_verified_at": m.now(),
    }
    assert f.locks == [
        "notebooklm:account-call",
        "notebooklm:account-call",
        "notebooklm:connection",
    ]


@pytest.mark.parametrize(
    "pages,code",
    [
        ([page(["a"], complete=False)], "INCOMPLETE_LISTING"),
        ([page(["a"], "same"), page(["b"], "same")], "REMOTE_SCHEMA_CHANGED"),
        ([page(["a"], "next"), page(["a"])], "REMOTE_SCHEMA_CHANGED"),
        ([page([], str(i)) for i in range(1001)], "REMOTE_SCHEMA_CHANGED"),
    ],
)
async def test_invalid_listing_never_records_capability(service, pages, code):
    service.bridge.list_sources.side_effect = pages
    with pytest.raises(BridgeError) as caught:
        await service.s.all_sources("remote")
    assert caught.value.code == code
    service.store.put.assert_not_awaited()


async def test_empty_complete_listing_records_success(service):
    service.bridge.list_sources.return_value = page()
    assert await service.s.all_sources("remote") == []
    assert ("connection", "capability_list_sources") in service.rows


@pytest.mark.parametrize(
    "failure", [asyncio.CancelledError, TimeoutError, RuntimeError]
)
async def test_read_failure_and_cancellation_propagate(service, failure):
    operation = AsyncMock(side_effect=failure("synthetic"))
    with pytest.raises(failure):
        await service.s.remote_read(operation)
    service.store.put.assert_not_awaited()


async def test_disconnected_gate_prevents_remote_call(service):
    service.rows["connection", "notebooklm"] = {"disabled": True}
    operation = AsyncMock()
    for call in [
        lambda: service.s.remote_read(operation),
        service.s._ensure_connection,
    ]:
        with pytest.raises(BridgeError) as caught:
            await call()
        assert caught.value.code == "NEEDS_REAUTH"
    operation.assert_not_awaited()
    service.bridge.verify_connection.assert_not_awaited()


@pytest.mark.parametrize(
    "state,code",
    [
        ("connected", None),
        ("disconnected", "NEEDS_REAUTH"),
        ("needs_reauth", "NEEDS_REAUTH"),
        ("unknown", "REMOTE_UNAVAILABLE"),
    ],
)
async def test_verified_connection_contract(service, state, code):
    status = NS(state=state)
    service.bridge.verify_connection.return_value = status
    if code:
        with pytest.raises(BridgeError) as caught:
            await service.s._ensure_connection()
        assert caught.value.code == code
    else:
        assert await service.s._ensure_connection() is status


@pytest.mark.parametrize("submission", ["not_submitted", "unknown", "confirmed"])
async def test_cancel_preserves_remote_truth_and_late_response(service, submission):
    job = {
        "job_id": "j",
        "provider": "notebooklm",
        "notebook_id": "n",
        "state": "running",
        "submission_state": submission,
    }
    service.rows["job", "j"] = job
    result = await service.s.cancel_job("j")
    assert result["state"] == "cancelled_local" and result["cancel_requested"] is True
    assert result["remote_may_continue"] == (submission != "not_submitted")
    assert result["next_poll_at"] is None
    stale = dict(job)
    late = await service.s._save(
        stale, state="succeeded", result={"synthetic": "answer"}
    )
    assert late["state"] == "cancelled_local" and late["result"] == {
        "synthetic": "answer"
    }
    assert stale == late


async def test_completed_job_not_cancelled(service):
    job = {"job_id": "j", "provider": "notebooklm", "state": "succeeded"}
    service.rows["job", "j"] = job
    assert await service.s.cancel_job("j") == job
    service.store.put.assert_not_awaited()


@pytest.mark.parametrize("job", [None, {"provider": "other"}])
async def test_missing_or_foreign_job_rejected(service, job):
    service.rows["job", "j"] = job
    with pytest.raises(NotFoundError):
        await service.s.job("j")


@pytest.mark.parametrize(
    "support",
    [None, "unsupported", "temporarily_unavailable", "available", "unverified"],
)
async def test_capability_admission_and_strict_ask(service, support):
    operations = [] if support is None else [NS(name="ask", support=support)]
    service.bridge.capabilities.return_value = NS(operations=operations)
    if support in {None, "unsupported", "temporarily_unavailable"}:
        with pytest.raises(BridgeError) as caught:
            await service.s.require_capability("ask")
        assert caught.value.code == "CAPABILITY_UNAVAILABLE"
    else:
        assert await service.s.require_capability("ask") is None
    if support != "available":
        with pytest.raises(BridgeError) as caught:
            await service.s._require_strict_ask_capability()
        assert caught.value.code == "SCOPE_ISOLATION_UNAVAILABLE"
    else:
        assert await service.s._require_strict_ask_capability() is None


async def test_observations_do_not_override_explicit_unavailability(service):
    ops = [
        NS(name=name, support=support, last_verified_at=None)
        for name, support in [
            ("a", "unverified"),
            ("b", "unsupported"),
            ("c", "temporarily_unavailable"),
            ("d", "unverified"),
        ]
    ]
    service.bridge.capabilities.return_value = NS(operations=ops)
    service.store.list.return_value = [
        {"name": n, "last_verified_at": "observed"} for n in ["a", "b", "c"]
    ]
    result = await service.s.capabilities()
    assert [(o.support, o.last_verified_at) for o in result.operations] == [
        ("available", "observed"),
        ("unsupported", None),
        ("temporarily_unavailable", None),
        ("unverified", None),
    ]


@pytest.mark.parametrize(
    "operation,payload,key,code",
    [
        ("sync", {}, "", "INVALID_REQUEST"),
        ("sync", {}, "x" * 201, "INVALID_REQUEST"),
        ("bogus", {}, "key", "INVALID_REQUEST"),
        ("sync", {}, "key", "EMPTY_SCOPE"),
        ("ask", {}, "key", "EMPTY_SCOPE"),
        ("audio", {}, "key", "EMPTY_SCOPE"),
        ("import", {}, "key", "EMPTY_SCOPE"),
    ],
)
async def test_job_validation_before_store(service, operation, payload, key, code):
    with pytest.raises(BridgeError) as caught:
        await service.s.create_job("n", operation, payload, key)
    assert caught.value.code == code
    service.store.get.assert_not_awaited()
    service.store.put.assert_not_awaited()


@pytest.mark.parametrize(
    "state,submission,poll,expected",
    [
        ("succeeded", "confirmed", False, False),
        ("waiting_remote", "confirmed", False, False),
        ("queued", "not_submitted", True, False),
        ("queued", "not_submitted", False, True),
        ("waiting_remote", "confirmed", True, True),
        ("running", "unknown", False, False),
        ("running", "confirmed", True, True),
    ],
)
async def test_claim_replay_and_poll_state_machine(
    service, state, submission, poll, expected
):
    service.rows["job", "j"] = {
        "job_id": "j",
        "notebook_id": "n",
        "provider": "notebooklm",
        "state": state,
        "submission_state": submission,
        "attempts": 0,
        "poll_attempts": 0,
    }
    job, claimed = await service.s._claim("j", poll=poll)
    assert claimed is expected
    if expected:
        assert job["state"] == "running"
        assert job["poll_attempts" if poll else "attempts"] == 1
    elif state == "running":
        assert job["state"] == "submission_unknown"


@pytest.mark.parametrize("blocked", ["lease", "replay"])
async def test_claim_does_not_replay_live_or_forbidden_job(service, blocked):
    service.rows["job", "j"] = {
        "job_id": "j",
        "notebook_id": "n",
        "provider": "notebooklm",
        "state": "running",
        "submission_state": "unknown",
        "lease_until": "2999" if blocked == "lease" else "",
        "replay_allowed": blocked != "replay",
    }
    _, claimed = await service.s._claim("j")
    assert claimed is False
    service.store.put.assert_not_awaited()


async def test_refresh_mapping_missing_changed_and_stable_revision(service):
    remote = NS(
        id="r",
        revision_id="new",
        status="ready",
        model_dump=lambda: {"id": "r", "revision_id": "new"},
    )
    service.bridge.list_sources.return_value = NS(
        items=[remote], next_cursor=None, listing_complete=True
    )
    links = [
        {
            "source_link_id": name,
            "notebook_id": "n",
            "remote_source_id": rid,
            "mapping_status": "verified",
            "remote_metadata": metadata,
        }
        for name, rid, metadata in [
            ("missing", "gone", {}),
            ("changed", "r", {"revision_id": "old"}),
            ("stable", "r", {"revision_id": "new"}),
            ("unknown", "r", {}),
        ]
    ]
    service.store.list.return_value = links
    assert await service.s.refresh_source_links("remote") == [remote]
    saved = {
        name: service.rows["source_link", name]
        for name in ["missing", "changed", "stable", "unknown"]
    }
    assert saved["missing"]["mapping_status"] == "missing"
    assert saved["missing"]["remote_status"] == "missing"
    assert saved["changed"]["mapping_status"] == "stale"
    for name in ["stable", "unknown"]:
        assert saved[name]["mapping_status"] == "verified"
        assert saved[name]["remote_metadata"] == {"id": "r", "revision_id": "new"}
    assert all(v["last_checked_at"] == m.now() for v in saved.values())


@pytest.mark.parametrize("origin", ["local", "remote"])
async def test_scope_deduplicates_and_hashes_verified_mappings(service, origin):
    link = {
        "source_link_id": "link",
        "remote_source_id": "r",
        "source_version_id": "v",
        "mapping_status": "verified",
        "remote_status": "ready",
        "mapping_method": "exact",
        "last_checked_at": "t",
    }
    service.store.list.return_value = [link]
    service.s.evidence = NS(version=AsyncMock(return_value={"notebook_id": "n"}))
    req = {
        "notebook_id": "n",
        "remote_notebook_id": "remote",
        "selection_origin": origin,
        "source_version_ids": ["v", "v"],
        "remote_source_ids": ["r", "r"],
    }
    result = await service.s.resolve_scope(req)
    assert result["source_version_ids"] == ["v"] and result["remote_source_ids"] == [
        "r"
    ]
    assert result["scope_snapshot"]["scope_hash"] == m.digest(
        {"versions": ["v"], "remote": ["r"], "notebook": "remote"}
    )
    assert req["source_version_ids"] == ["v", "v"]
    assert result["scope_snapshot"]["mappings"][0]["source_link_id"] == "link"


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"remote_notebook_id": None}, "INVALID_REQUEST"),
        ({"selection_origin": "bogus"}, "INVALID_REQUEST"),
        ({"selection_origin": "local", "source_version_ids": []}, "EMPTY_SCOPE"),
        ({"selection_origin": "remote", "remote_source_ids": []}, "EMPTY_SCOPE"),
        ({"selection_origin": "local", "source_version_ids": ["v"]}, "UNMAPPED_SOURCE"),
    ],
)
async def test_scope_rejects_missing_or_unmapped_selection(service, changes, code):
    service.s.evidence = NS(version=AsyncMock(return_value={"notebook_id": "n"}))
    req = {"notebook_id": "n", "remote_notebook_id": "remote", **changes}
    with pytest.raises(BridgeError) as caught:
        await service.s.resolve_scope(req)
    assert caught.value.code == code
    service.store.put.assert_not_awaited()


async def test_scope_rejects_foreign_original_and_ambiguous_mapping(service):
    request = {
        "notebook_id": "n",
        "remote_notebook_id": "remote",
        "selection_origin": "local",
        "source_version_ids": ["v"],
    }
    service.s.evidence = NS(version=AsyncMock(return_value={"notebook_id": "foreign"}))
    with pytest.raises(BridgeError) as caught:
        await service.s.resolve_scope(request)
    assert caught.value.code == "INVALID_REQUEST"
    service.s.evidence.version.return_value = {"notebook_id": "n"}
    service.store.list.return_value = [
        {
            "source_version_id": "v",
            "remote_source_id": str(i),
            "mapping_status": "verified",
            "remote_status": "ready",
        }
        for i in range(2)
    ]
    with pytest.raises(BridgeError) as ambiguous:
        await service.s.resolve_scope(request)
    assert ambiguous.value.code == "UNMAPPED_SOURCE"
