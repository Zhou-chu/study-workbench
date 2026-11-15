"""Physical-ID read integrity and per-phase cache policy; storage boundary only."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import pytest

from api.evidence_retrieval import _CanonicalReads
from api.personal_store import READ_BATCH_SIZE, record_key
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError


def raw(identity, value):
    return {"id": record_key("evidence", identity), "payload": value}


@pytest.mark.asyncio
async def test_batch_dedup_order_and_copy_isolation():
    ids = [f"ev_{i}" for i in range(READ_BATCH_SIZE + 1)]
    rows = {i: raw(i, {"nested": [i]}) for i in ids}

    async def fetch(kind, batch):
        assert kind == "evidence"
        return {i: rows[i] for i in batch}

    store = SimpleNamespace(get_many=AsyncMock(side_effect=fetch))
    reads = _CanonicalReads(store)
    await reads.prefetch("evidence", ids + [ids[0], ids[-1]])
    assert store.get_many.await_args_list == [
        call("evidence", ids[:READ_BATCH_SIZE]),
        call("evidence", ids[READ_BATCH_SIZE:]),
    ]
    rows[ids[0]]["payload"]["nested"].append("backend mutation")
    first = await reads.get("evidence", ids[0])
    assert first == {"nested": [ids[0]]}
    first["nested"].append("caller mutation")
    assert await reads.get("evidence", ids[0]) == {"nested": [ids[0]]}
    assert store.get_many.await_count == 2


@pytest.mark.asyncio
async def test_missing_row_is_cached_but_new_phase_reads_fresh():
    store = SimpleNamespace(get_many=AsyncMock(return_value={"ev_one": None}))
    phase = _CanonicalReads(store)
    assert await phase.get("evidence", "ev_one") is None
    store.get_many.return_value = {"ev_one": raw("ev_one", {"quote": "new"})}
    assert await phase.get("evidence", "ev_one") is None
    assert await _CanonicalReads(store).get("evidence", "ev_one") == {"quote": "new"}
    assert store.get_many.await_count == 2


@pytest.mark.asyncio
async def test_empty_prefetch_never_calls_storage():
    store = SimpleNamespace(get_many=AsyncMock())
    await _CanonicalReads(store).prefetch("evidence", [])
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,identity",
    [
        ("unknown", "one"),
        ("evidence", ""),
        ("evidence", None),
        ("evidence", 7),
        ("evidence", "x" * 513),
    ],
)
async def test_all_ids_are_validated_before_any_batch_io(kind, identity):
    store = SimpleNamespace(get_many=AsyncMock())
    with pytest.raises(InvalidInputError, match="^INDEX_INTEGRITY$"):
        await _CanonicalReads(store).prefetch(kind, ["valid", identity])
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        None,
        [],
        {},
        {"wrong": None},
        {"ev_one": None, "extra": None},
        {"ev_one": []},
        {"ev_one": {}},
        {"ev_one": {"id": "wrong", "payload": {}}},
        {"ev_one": {"id": record_key("evidence", "ev_one"), "payload": []}},
    ],
)
async def test_malformed_or_wrong_identity_response_is_not_absence(response):
    store = SimpleNamespace(get_many=AsyncMock(return_value=deepcopy(response)))
    with pytest.raises(InvalidInputError, match="^INDEX_INTEGRITY$"):
        await _CanonicalReads(store).get("evidence", "ev_one")
    store.get_many.assert_awaited_once_with("evidence", ["ev_one"])


@pytest.mark.asyncio
async def test_storage_error_loses_sensitive_chain_without_retry():
    failure = RuntimeError("synthetic-private-backend")
    store = SimpleNamespace(get_many=AsyncMock(side_effect=failure))
    with pytest.raises(DatabaseOperationError) as caught:
        await _CanonicalReads(store).get("evidence", "ev_one")
    assert str(caught.value) == "INDEX_READ_UNAVAILABLE"
    assert caught.value.__cause__ is None and caught.value.__context__ is None
    store.get_many.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancellation_is_not_relabelled_as_database_failure():
    failure = asyncio.CancelledError()
    store = SimpleNamespace(get_many=AsyncMock(side_effect=failure))
    with pytest.raises(asyncio.CancelledError) as caught:
        await _CanonicalReads(store).get("evidence", "ev_one")
    assert caught.value is failure
    store.get_many.assert_awaited_once()


@pytest.mark.asyncio
async def test_cache_key_separates_kinds_even_with_same_logical_identity():
    async def fetch(kind, ids):
        return {i: {"id": record_key(kind, i), "payload": {"kind": kind}} for i in ids}

    store = SimpleNamespace(get_many=AsyncMock(side_effect=fetch))
    reads = _CanonicalReads(store)
    assert await reads.get("evidence", "same") == {"kind": "evidence"}
    assert await reads.get("version", "same") == {"kind": "version"}
    assert await reads.get("evidence", "same") == {"kind": "evidence"}
    assert store.get_many.await_args_list == [
        call("evidence", ["same"]),
        call("version", ["same"]),
    ]


@pytest.mark.asyncio
async def test_failed_later_batch_does_not_invent_missing_records_or_retry():
    ids = [f"ev_{i}" for i in range(READ_BATCH_SIZE + 1)]
    store = SimpleNamespace(
        get_many=AsyncMock(
            side_effect=[
                {i: raw(i, {"id": i}) for i in ids[:READ_BATCH_SIZE]},
                OSError("synthetic unavailable"),
            ]
        )
    )
    reads = _CanonicalReads(store)
    with pytest.raises(DatabaseOperationError, match="^INDEX_READ_UNAVAILABLE$"):
        await reads.prefetch("evidence", ids)
    assert store.get_many.await_count == 2
    assert await reads.get("evidence", ids[0]) == {"id": ids[0]}
    assert store.get_many.await_count == 2
    assert ("evidence", ids[-1]) not in reads.rows
