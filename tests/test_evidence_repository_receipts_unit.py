"""Repository receipt and invalidation policy; fake RPC/locks, not SQL isolation."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy

import pytest

from open_notebook.database import evidence_embedding_repository as target
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError


class Wire:
    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.calls = []
        self.closed = 0

    async def query_raw(self, sql, params):
        self.calls.append((sql, deepcopy(params)))
        if self.error is not None:
            raise self.error
        if self.reply is not None:
            return self.reply(params["receipt"])
        return {
            "result": [{"status": "OK", "result": params["receipt"]} for _ in range(2)]
        }

    @asynccontextmanager
    async def connection(self):
        try:
            yield self
        finally:
            self.closed += 1


@pytest.fixture
def wire(monkeypatch):
    wire = Wire()
    monkeypatch.setattr(target, "db_connection", wire.connection)
    return wire


@pytest.mark.asyncio
async def test_success_requires_bound_receipts_and_unique_operation_identity(wire):
    params = {"value": "synthetic", "receipt": {"token": "caller-forged"}}
    before = deepcopy(params)
    assert await target._transaction("body", params, operation="publish") == {
        "ack": True
    }
    assert await target._transaction("body", params, operation="publish") == {
        "ack": True
    }
    receipts = [p["receipt"] for _, p in wire.calls]
    assert receipts[0] != receipts[1]
    assert all(r["operation"] == "publish" and len(r["token"]) == 32 for r in receipts)
    assert params == before and wire.closed == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        None,
        [],
        {},
        {"error": "private body"},
        {"result": []},
        {"result": {}},
        {"result": [None]},
        {"result": [{"status": "UNKNOWN", "result": 1}]},
        {"result": [{"status": "OK"}]},
    ],
)
async def test_malformed_envelopes_are_unknown_without_diagnostic_body(wire, response):
    wire.reply = lambda _: response
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN") as caught:
        await target._transaction("body", {})
    assert "private body" not in str(caught.value)
    assert wire.closed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "one",
        "three",
        "wrong_token",
        "wrong_operation",
        "mixed_abort",
        "missing_suffix",
        "nonstring_abort",
    ],
)
async def test_ambiguous_receipts_cannot_claim_success_or_definitive_abort(
    wire, change
):
    def reply(receipt):
        ok = {"status": "OK", "result": receipt}
        if change == "one":
            rows = [ok]
        elif change == "three":
            rows = [ok, ok, ok]
        elif change == "wrong_token":
            rows = [ok, {"status": "OK", "result": {**receipt, "token": "other"}}]
        elif change == "wrong_operation":
            rows = [ok, {"status": "OK", "result": {**receipt, "operation": "other"}}]
        elif change == "mixed_abort":
            rows = [ok, {"status": "ERR", "result": "SCOPE_CHANGED"}, ok]
        elif change == "missing_suffix":
            rows = [{"status": "ERR", "result": "SCOPE_CHANGED"}]
        else:
            rows = [{"status": "ERR", "result": {}}, ok]
        return {"result": rows}

    wire.reply = reply
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await target._transaction("body", {})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code",
    [
        "SCOPE_CHANGED",
        "ATTEMPT_CANCELLED",
        "ATTEMPT_NOT_REGISTERED",
        "INDEX_INTEGRITY",
        "OTHER",
    ],
)
async def test_supported_abort_classification_drops_server_body(wire, code):
    wire.reply = lambda r: {
        "result": [
            {"status": "ERR", "result": code + " private server body"},
            {"status": "OK", "result": r},
        ]
    }
    expected = DatabaseOperationError if code == "OTHER" else InvalidInputError
    with pytest.raises(
        expected, match="INDEX_COMMIT_REJECTED" if code == "OTHER" else code
    ) as caught:
        await target._transaction("body", {})
    assert "private server body" not in str(caught.value)


@pytest.mark.asyncio
async def test_transport_failure_unknown_but_cancellation_preserves_identity(wire):
    wire.error = RuntimeError("private response")
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN") as caught:
        await target._transaction("body", {})
    assert caught.value.__context__ is None
    cancellation = asyncio.CancelledError()
    wire.error = cancellation
    with pytest.raises(asyncio.CancelledError) as cancelled:
        await target._transaction("body", {})
    assert cancelled.value is cancellation and wire.closed == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code", ["SCOPE_CHANGED", "INDEX_NOT_READY", "INDEX_INTEGRITY", "ATTEMPT_CANCELLED"]
)
@pytest.mark.parametrize("kind", [InvalidInputError, DatabaseOperationError])
async def test_read_safe_errors_rebuilt_without_adapter_context(code, kind):
    message = code + ": evidence index prerequisites changed or are unavailable"
    original = kind(message)

    async def query(*args):
        try:
            raise RuntimeError("private chain")
        except RuntimeError as cause:
            raise original from cause

    repo = target.EvidenceEmbeddingRepository(query=query)
    with pytest.raises(kind) as caught:
        await repo.query("read")
    assert caught.value is not original and str(caught.value) == message
    assert caught.value.__cause__ is caught.value.__context__ is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind", [RuntimeError, InvalidInputError, DatabaseOperationError]
)
async def test_unrecognized_read_errors_are_not_trusted(kind):
    async def query(*args):
        raise kind("SCOPE_CHANGED private diagnostic")

    with pytest.raises(DatabaseOperationError) as caught:
        await target.EvidenceEmbeddingRepository(query=query).query("read")
    assert str(caught.value) == "INDEX_READ_UNAVAILABLE: evidence metadata query failed"
    assert caught.value.__context__ is None


@pytest.mark.asyncio
@pytest.mark.parametrize("cleanup_failure", [False, True])
async def test_invalidation_ack_precedes_cleanup_and_deduplicates_scope(
    wire, cleanup_failure
):
    events = []

    async def query(sql, params):
        assert wire.closed == 1  # transaction context already exited
        events.append(deepcopy(params))
        if cleanup_failure:
            raise RuntimeError("cleanup private diagnostic")
        return []

    repo = target.EvidenceEmbeddingRepository(query=query)
    await repo._invalidate_scopes(
        [("notebook:b", "v2"), ("notebook:a", "v1"), ("notebook:a", "v1")]
    )
    params = wire.calls[0][1]
    assert params["receipt"]["operation"] == "invalidate"
    assert [(s["notebook_id"], s["version_id"]) for s in params["scopes"]] == [
        ("notebook:a", "v1"),
        ("notebook:b", "v2"),
    ]
    assert [p["version_id"] for p in events] == ["v1", "v2"]


@pytest.mark.asyncio
async def test_unknown_invalidation_never_starts_cleanup(wire):
    wire.reply = lambda _: None
    calls = []

    async def query(*args):
        calls.append(args)

    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await target.EvidenceEmbeddingRepository(query=query)._invalidate_scopes(
            [("notebook:a", "v")]
        )
    assert calls == []


@pytest.mark.asyncio
async def test_empty_invalidation_does_not_touch_database(wire):
    await target.EvidenceEmbeddingRepository()._invalidate_scopes([])
    assert wire.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("grow", [False, True])
async def test_deletion_barrier_rechecks_projects_before_yield_and_releases_locks(
    monkeypatch, wire, grow
):
    events = []

    @asynccontextmanager
    async def lock(project):
        events.append(("enter", project))
        try:
            yield
        finally:
            events.append(("exit", project))

    monkeypatch.setattr(target, "project_lock", lock)
    reads = 0

    async def query(sql, params):
        nonlocal reads
        if "invalidate-versions" in sql:
            reads += 1
            rows = [
                {"notebook_id": "notebook:b", "version_id": "b"},
                {"notebook_id": "notebook:a", "version_id": "a"},
            ]
            if reads == 2 and grow:
                rows.append({"notebook_id": "notebook:c", "version_id": "c"})
            return rows
        assert "delete-vectors" in sql
        return []

    repo = target.EvidenceEmbeddingRepository(query=query)
    if grow:
        with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
            async with repo.source_deletion_barrier("source:one"):
                pytest.fail("changed project set must not yield")
        assert wire.calls == []
    else:
        async with repo.source_deletion_barrier("source:one"):
            assert events == [("enter", "notebook:a"), ("enter", "notebook:b")]
            assert len(wire.calls) == 1
    assert events[-2:] == [("exit", "notebook:b"), ("exit", "notebook:a")]
    assert reads == 2
