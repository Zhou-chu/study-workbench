"""Real extraction publication logic with only persistence/parser/file I/O replaced."""

import asyncio
import hashlib
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from api import evidence_service as mod
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def extraction(monkeypatch):
    rows = {
        ("version", "sv_one"): {
            "source_version_id": "sv_one",
            "source_id": "source:one",
            "notebook_id": "notebook:one",
            "source_title": "合成资料",
            "mime_type": "text/plain",
            "origin": "upload",
            "status": "pending",
        }
    }
    events, writes = [], []

    @asynccontextmanager
    async def lock(notebook):
        assert notebook == "notebook:one"
        events.append("lock")
        try:
            yield
        finally:
            events.append("unlock")

    async def get(kind, identity):
        return deepcopy(rows.get((kind, identity)))

    async def put(kind, identity, value, **options):
        events.append("put:" + kind)
        writes.append((kind, identity, deepcopy(value), options))
        if options.get("create_only"):
            assert (kind, identity) not in rows
        rows[kind, identity] = deepcopy(value)

    async def invalidate(*args):
        events.append("invalidate")

    store = SimpleNamespace(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        project_lock=lock,
        invalidate_evidence_scope=AsyncMock(side_effect=invalidate),
    )
    service = object.__new__(mod.EvidenceService)
    service.store = store
    service.resolve_file = AsyncMock(return_value="synthetic-path-token")
    parsed = {
        "status": "ready",
        "page_count": 1,
        "warnings": [],
        "blocks": [
            {"block_id": "block_one", "page_index": 0, "text": "甲乙。\n\n丙丁。"}
        ],
    }
    parser = Mock(side_effect=lambda *args: deepcopy(parsed))

    @asynccontextmanager
    async def slots():
        events.append("slot")
        yield
        events.append("slot-release")

    async def inline(function, *args, **kwargs):
        assert function is parser
        events.append("parse")
        return function(*args, **kwargs)

    monkeypatch.setattr(mod, "_bounded_parse", parser)
    monkeypatch.setattr(mod, "_parse_slots", slots)
    monkeypatch.setattr(mod.asyncio, "to_thread", inline)
    monkeypatch.setattr(mod.importlib.metadata, "version", lambda name: "synthetic-pdf")
    return SimpleNamespace(
        service=service,
        store=store,
        rows=rows,
        writes=writes,
        events=events,
        parsed=parsed,
        parser=parser,
    )


def old_ready(s):
    s.rows["version", "sv_one"].update(current_extraction_id="ex_old", status="ready")
    s.rows["extraction", "ex_old"] = {
        "extraction_id": "ex_old",
        "source_version_id": "sv_one",
        "notebook_id": "notebook:one",
        "status": "ready",
        "evidence_ids": ["ev_old"],
    }


@pytest.mark.asyncio
async def test_success_publishes_real_paragraph_records_before_ready_metadata(
    extraction,
):
    s = extraction
    result = await s.service._extract("sv_one", "ex_new", False)
    assert result["status"] == "ready" and result["parser_name"] == "utf8"
    assert len(result["evidence_ids"]) == 2
    records = [s.rows["evidence", i] for i in result["evidence_ids"]]
    assert [r["quote"] for r in records] == ["甲乙。", "丙丁。"]
    assert [r["locator"]["start_offset"] for r in records] == [0, 5]
    assert [r["locator"]["end_offset"] for r in records] == [3, 8]
    for record in records:
        assert (
            record["quote_hash"] == hashlib.sha256(record["quote"].encode()).hexdigest()
        )
        assert (
            record["extraction_id"] == "ex_new"
            and record["source_version_id"] == "sv_one"
        )
        assert record["notebook_id"] == "notebook:one"
    assert [kind for kind, *_ in s.writes] == [
        "extraction",
        "version",
        "evidence",
        "evidence",
        "extraction",
        "version",
    ]
    assert all(
        options == {"create_only": True}
        for kind, _, _, options in s.writes
        if kind == "evidence"
    )
    assert s.writes[0][2]["status"] == "running"
    assert s.writes[1][2]["status"] == "extracting"
    assert s.rows["version", "sv_one"]["current_extraction_id"] == "ex_new"
    assert s.rows["version", "sv_one"]["status"] == "ready"
    s.service.resolve_file.assert_awaited_once_with("sv_one")
    assert s.events.index("unlock") < s.events.index("parse")
    assert s.events.index("slot-release") < s.events.index("put:evidence")


@pytest.mark.asyncio
async def test_terminal_extraction_reused_without_parse_or_writes(extraction):
    s = extraction
    old_ready(s)
    prior = deepcopy(s.rows["extraction", "ex_old"])
    assert await s.service._extract("sv_one", None, False) == prior
    assert not s.writes
    s.parser.assert_not_called()
    s.service.resolve_file.assert_not_awaited()


@pytest.mark.asyncio
async def test_foreign_extraction_identity_rejected_before_io(extraction):
    s = extraction
    s.rows["extraction", "ex_bad"] = {"source_version_id": "sv_foreign"}
    with pytest.raises(InvalidInputError, match="another source version"):
        await s.service._extract("sv_one", "ex_bad", False)
    assert not s.writes
    s.service.resolve_file.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("capability", [True, False])
async def test_successful_reparse_invalidates_before_new_state_and_retains_history(
    extraction, capability
):
    s = extraction
    old_ready(s)
    if not capability:
        del s.store.invalidate_evidence_scope
    prior = deepcopy(s.rows["extraction", "ex_old"])
    result = await s.service._extract("sv_one", "ex_new", True)
    assert result["status"] == "ready"
    assert s.rows["extraction", "ex_old"] == prior
    assert s.rows["version", "sv_one"]["current_extraction_id"] == "ex_new"
    if capability:
        s.store.invalidate_evidence_scope.assert_awaited_once_with(
            "notebook:one", ["sv_one"], "reparse"
        )
        assert s.events.index("invalidate") < s.events.index("put:extraction")


@pytest.mark.asyncio
@pytest.mark.parametrize("prior", [False, True])
async def test_parser_failure_sanitizes_durable_error_and_restores_previous_readability(
    extraction, prior
):
    s = extraction
    if prior:
        old_ready(s)
    failure = RuntimeError("synthetic-secret-path")
    s.parser.side_effect = failure
    with pytest.raises(RuntimeError) as caught:
        await s.service._extract("sv_one", "ex_new", True)
    assert caught.value is failure
    row = s.rows["extraction", "ex_new"]
    assert row["status"] == "failed"
    assert row["error"] == "Source extraction could not be completed."
    assert "synthetic-secret" not in str(s.rows)
    version = s.rows["version", "sv_one"]
    assert version["status"] == ("ready" if prior else "failed")
    assert version["current_extraction_id"] == ("ex_old" if prior else "ex_new")
    assert not any(kind == "evidence" for kind, *_ in s.writes)


@pytest.mark.asyncio
async def test_original_file_failure_records_failure_without_parser(extraction):
    s = extraction
    s.service.resolve_file.side_effect = NotFoundError("missing")
    with pytest.raises(NotFoundError):
        await s.service._extract("sv_one", "ex_new", False)
    s.parser.assert_not_called()
    assert s.rows["version", "sv_one"]["status"] == "failed"


@pytest.mark.asyncio
async def test_cancelled_parse_does_not_claim_terminal_failure_or_publication(
    extraction,
):
    s = extraction
    s.parser.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await s.service._extract("sv_one", "ex_new", False)
    assert s.rows["extraction", "ex_new"]["status"] == "running"
    assert s.rows["version", "sv_one"]["status"] == "extracting"
    assert [kind for kind, *_ in s.writes] == ["extraction", "version"]


@pytest.mark.asyncio
async def test_pdf_parser_metadata_and_partial_result_are_preserved(extraction):
    s = extraction
    s.rows["version", "sv_one"]["mime_type"] = "application/pdf"
    s.parsed.update(status="partial", warnings=["synthetic-page-warning"])
    result = await s.service._extract("sv_one", "ex_new", False)
    assert (
        result["parser_name"] == "pypdf" and result["parser_version"] == "synthetic-pdf"
    )
    assert result["status"] == "partial" and result["warnings"] == [
        "synthetic-page-warning"
    ]
    assert s.rows["version", "sv_one"]["status"] == "partial"
    assert all(
        s.rows["evidence", i]["evidence_kind"] == "pdf_text"
        for i in result["evidence_ids"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", [False, True])
async def test_resumed_attempt_reuses_identical_evidence_but_rejects_mutation(
    extraction, conflict
):
    s = extraction
    first = await s.service._extract("sv_one", "ex_new", False)
    identity = first["evidence_ids"][0]
    s.rows["extraction", "ex_new"]["status"] = "running"
    if conflict:
        s.rows["evidence", identity]["quote"] = "tampered"
    before = deepcopy(s.rows["evidence", identity])
    s.writes.clear()
    if conflict:
        with pytest.raises(InvalidInputError, match="Immutable evidence conflict"):
            await s.service._extract("sv_one", "ex_new", False)
        assert s.rows["version", "sv_one"]["status"] == "failed"
    else:
        result = await s.service._extract("sv_one", "ex_new", False)
        assert result["evidence_ids"] == first["evidence_ids"]
        assert result["status"] == "ready"
    assert s.rows["evidence", identity] == before
    assert not any(kind == "evidence" for kind, *_ in s.writes)
