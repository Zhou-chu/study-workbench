"""Revalidation decisions over real canonical reads and exact matching, without I/O."""

import asyncio
import copy
import hashlib
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import evidence_service as mod
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def context(monkeypatch):
    rows: dict[tuple[str, str], dict[str, object]] = {
        ("version", "sv_one"): {
            "source_version_id": "sv_one",
            "notebook_id": "notebook:one",
            "original_status": "available",
            "origin": "upload",
        },
        ("extraction", "ex_old"): {
            "extraction_id": "ex_old",
            "source_version_id": "sv_one",
            "evidence_ids": ["ev_one"],
            "status": "ready",
        },
        ("evidence", "ev_one"): {
            "evidence_id": "ev_one",
            "source_version_id": "sv_one",
            "extraction_id": "ex_old",
            "quote": "hello",
            "quote_hash": hashlib.sha256(b"hello").hexdigest(),
            "locator": {
                "block_id": "b1",
                "page_index": 0,
                "start_offset": 0,
                "end_offset": 5,
            },
        },
    }
    writes = []
    events: list[tuple[str] | tuple[str, str, str]] = []
    locked = False

    async def get(kind, identity):
        events.append(("get", kind, identity))
        return copy.deepcopy(rows.get((kind, identity)))

    async def put(kind, identity, value):
        assert locked
        writes.append((kind, identity, copy.deepcopy(value)))

    @asynccontextmanager
    async def lock(notebook):
        nonlocal locked
        assert notebook == "notebook:one"
        # A concurrent metadata update before the protected reread must survive.
        rows["extraction", "ex_old"]["concurrent_marker"] = "retain"
        events.append(("lock",))
        locked = True
        try:
            yield
        finally:
            locked = False
            events.append(("unlock",))

    store = SimpleNamespace(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        project_lock=lock,
    )
    service = object.__new__(mod.EvidenceService)
    service.store = store
    fresh = {
        "extraction_id": "ex_fresh",
        "source_version_id": "sv_one",
        "status": "ready",
        "verification_origin": "local_extraction",
        "blocks": [{"block_id": "b1", "page_index": 0, "text": "hello world"}],
    }
    monkeypatch.setattr(service, "extract", AsyncMock(return_value=fresh))
    monkeypatch.setattr(mod, "_now", lambda: "2030-01-01T00:00:00Z")
    return SimpleNamespace(
        service=service, rows=rows, writes=writes, events=events, fresh=fresh
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "problem",
    [
        "version-missing",
        "history-missing",
        "history-other-version",
        "original-missing",
        "remote-original",
        "same-id",
        "restored-fresh",
    ],
)
async def test_invalid_revalidation_never_parses_or_writes(context, problem):
    c = context
    fresh_id = "ex_fresh"
    if problem == "version-missing":
        del c.rows["version", "sv_one"]
    elif problem == "history-missing":
        del c.rows["extraction", "ex_old"]
    elif problem == "history-other-version":
        c.rows["extraction", "ex_old"]["source_version_id"] = "sv_other"
    elif problem == "original-missing":
        c.rows["version", "sv_one"]["original_status"] = "missing"
    elif problem == "remote-original":
        c.rows["version", "sv_one"]["origin"] = "remote_text_snapshot"
    elif problem == "same-id":
        fresh_id = "ex_old"
    else:
        c.rows["extraction", "ex_fresh"] = {"verification_origin": "restored_archive"}
    error = NotFoundError if problem == "version-missing" else InvalidInputError
    with pytest.raises(error):
        await c.service.revalidate("sv_one", "ex_old", fresh_id)
    c.service.extract.assert_not_awaited()
    assert c.writes == []
    assert ("lock",) not in c.events


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["failed-result", "exception", "cancel"])
async def test_parse_failure_does_not_publish_revalidation(context, failure):
    c = context
    error = (
        asyncio.CancelledError()
        if failure == "cancel"
        else RuntimeError("synthetic parse boundary")
    )
    if failure == "failed-result":
        c.fresh["status"] = "failed"
    else:
        c.service.extract.side_effect = error
    with pytest.raises(
        InvalidInputError if failure == "failed-result" else type(error)
    ) as caught:
        await c.service.revalidate("sv_one", "ex_old", "ex_fresh")
    if failure != "failed-result":
        assert caught.value is error
    c.service.extract.assert_awaited_once_with("sv_one", extraction_id="ex_fresh")
    assert c.writes == []
    assert ("lock",) not in c.events


@pytest.mark.asyncio
@pytest.mark.parametrize("fresh_status", ["ready", "partial"])
async def test_report_uses_real_exact_matching_and_preserves_locked_latest_record(
    context, fresh_status
):
    c = context
    c.fresh["status"] = fresh_status
    # Reusing this job's locally produced fresh extraction is allowed.
    c.rows["extraction", "ex_fresh"] = {"verification_origin": "local_extraction"}
    other = copy.deepcopy(c.rows["evidence", "ev_one"])
    other.update(
        evidence_id="ev_other",
        quote="mismatch",
        quote_hash=hashlib.sha256(b"mismatch").hexdigest(),
    )
    c.rows["evidence", "ev_other"] = other
    c.rows["extraction", "ex_old"]["evidence_ids"].append("ev_other")
    report = await c.service.revalidate("sv_one", "ex_old", "ex_fresh")
    expected = {
        "source_version_id": "sv_one",
        "extraction_id": "ex_old",
        "fresh_extraction_id": "ex_fresh",
        "checked_count": 2,
        "verified_count": 1,
        "unverified_count": 1,
        "checked_at": "2030-01-01T00:00:00Z",
    }
    assert report == expected
    c.service.extract.assert_awaited_once_with("sv_one", extraction_id="ex_fresh")
    assert len(c.writes) == 1
    kind, identity, saved = c.writes[0]
    assert (kind, identity) == ("extraction", "ex_old")
    assert saved["concurrent_marker"] == "retain"
    assert saved["evidence_ids"] == ["ev_one", "ev_other"]
    assert saved["revalidation"] == {**expected, "evidence_ids": ["ev_one"]}
    assert c.events[-3:] == [("lock",), ("get", "extraction", "ex_old"), ("unlock",)]
    assert "evidence_ids" not in report


@pytest.mark.asyncio
async def test_empty_history_publishes_zero_counts_not_spurious_verified_evidence(
    context,
):
    c = context
    c.rows["extraction", "ex_old"]["evidence_ids"] = []
    report = await c.service.revalidate("sv_one", "ex_old", "ex_fresh")
    assert (
        report["checked_count"],
        report["verified_count"],
        report["unverified_count"],
    ) == (0, 0, 0)
    assert c.writes[0][2]["revalidation"]["evidence_ids"] == []


@pytest.mark.asyncio
async def test_corrupt_canonical_evidence_blocks_report_even_after_fresh_parse(context):
    c = context
    c.rows["evidence", "ev_one"]["extraction_id"] = "ex_other"
    with pytest.raises(InvalidInputError, match="integrity"):
        await c.service.revalidate("sv_one", "ex_old", "ex_fresh")
    c.service.extract.assert_awaited_once()
    assert c.writes == []
    assert ("lock",) not in c.events
