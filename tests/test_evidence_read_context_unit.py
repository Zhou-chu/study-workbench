"""Request-local read reuse, with only scalar/bulk persistence boundaries replaced."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import pytest

from api.evidence_reads import EvidenceReadContext


@pytest.mark.asyncio
async def test_first_scalar_read_is_a_snapshot_and_each_result_is_detached() -> None:
    payload = {"nested": {"items": ["first"]}}
    store = SimpleNamespace(get=AsyncMock(return_value=payload), get_many=AsyncMock())
    context = EvidenceReadContext(store)
    first = await context.get("evidence", "one")
    first["nested"]["items"].append("caller edit")
    payload["nested"]["items"].append("store edit")
    second = await context.get("evidence", "one")
    assert second == {"nested": {"items": ["first"]}}
    assert first is not second
    store.get.assert_awaited_once_with("evidence", "one")
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_scalar_read_is_cached_even_if_store_later_has_a_value() -> None:
    store = SimpleNamespace(get=AsyncMock(return_value=None), get_many=AsyncMock())
    context = EvidenceReadContext(store)
    assert await context.get("evidence", "missing") is None
    store.get.return_value = {"value": "later"}
    assert await context.get("evidence", "missing") is None
    await context.prefetch("evidence", ["missing"])
    store.get.assert_awaited_once_with("evidence", "missing")
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_same_identity_in_different_kinds_has_independent_reads() -> None:
    store = SimpleNamespace(
        get=AsyncMock(side_effect=[{"value": "version"}, {"value": "evidence"}])
    )
    context = EvidenceReadContext(store)
    assert await context.get("version", "same") == {"value": "version"}
    assert await context.get("evidence", "same") == {"value": "evidence"}
    assert await context.get("version", "same") == {"value": "version"}
    assert store.get.await_args_list == [
        call("version", "same"),
        call("evidence", "same"),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("identity", [None, [], {}, "", "x" * 513])
async def test_invalid_identity_is_rejected_before_hashing_or_reading(
    identity: object,
) -> None:
    store = SimpleNamespace(get=AsyncMock(), get_many=AsyncMock())
    context = EvidenceReadContext(store)
    with pytest.raises(ValueError, match="Invalid record identity"):
        await context.get("evidence", identity)
    store.get.assert_not_awaited()
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_unknown_kind_is_rejected_before_store_access() -> None:
    store = SimpleNamespace(get=AsyncMock(), get_many=AsyncMock())
    context = EvidenceReadContext(store)
    with pytest.raises(ValueError, match="Unknown personal record kind"):
        await context.get("unknown", "one")
    await context.prefetch("unknown", ["one"])
    store.get.assert_not_awaited()
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
async def test_prefetch_deduplicates_in_order_skips_cache_and_detaches_returns() -> (
    None
):
    store = SimpleNamespace(
        get=AsyncMock(return_value={"value": "first"}),
        get_many=AsyncMock(
            return_value={
                "b": {"payload": {"nested": ["b"]}},
                "c": None,
            }
        ),
    )
    context = EvidenceReadContext(store)
    assert await context.get("evidence", "a") == {"value": "first"}
    await context.prefetch("evidence", ["a", "b", "b", "c", "a"])
    store.get_many.assert_awaited_once_with("evidence", ["b", "c"])
    first = await context.get("evidence", "b")
    first["nested"].append("caller edit")
    assert await context.get("evidence", "b") == {"nested": ["b"]}
    assert await context.get("evidence", "c") is None
    await context.prefetch("evidence", ["c", "b", "a"])
    assert store.get_many.await_count == 1
    store.get.assert_awaited_once_with("evidence", "a")


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [None, [], {}, "", "x" * 513])
async def test_prefetch_only_reads_valid_prefix_and_defers_invalid_error(
    bad: object,
) -> None:
    store = SimpleNamespace(
        get=AsyncMock(),
        get_many=AsyncMock(
            return_value={"missing": None, "ready": {"payload": {"value": 1}}}
        ),
    )
    context = EvidenceReadContext(store)
    await context.prefetch("evidence", ["missing", "ready", "missing", bad, "later"])
    store.get_many.assert_awaited_once_with("evidence", ["missing", "ready"])
    # Consumption in original order observes missing before the malformed ID.
    assert await context.get("evidence", "missing") is None
    assert await context.get("evidence", "ready") == {"value": 1}
    with pytest.raises(ValueError, match="Invalid record identity"):
        await context.get("evidence", bad)
    store.get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("identities", [[], ["", "later"]])
async def test_empty_or_initially_invalid_prefetch_performs_no_io(
    identities: list[str],
) -> None:
    store = SimpleNamespace(get=AsyncMock(), get_many=AsyncMock())
    await EvidenceReadContext(store).prefetch("evidence", identities)
    store.get.assert_not_awaited()
    store.get_many.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_scalar_failure_preserves_exception_and_does_not_cache(
    cancel: bool,
) -> None:
    error = asyncio.CancelledError("cancelled") if cancel else OSError("unavailable")
    store = SimpleNamespace(get=AsyncMock(side_effect=[error, {"value": "retried"}]))
    context = EvidenceReadContext(store)
    with pytest.raises(type(error)) as caught:
        await context.get("evidence", "one")
    assert caught.value is error
    assert await context.get("evidence", "one") == {"value": "retried"}
    assert await context.get("evidence", "one") == {"value": "retried"}
    assert store.get.await_args_list == [
        call("evidence", "one"),
        call("evidence", "one"),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_bulk_failure_does_not_publish_pending_or_replace_prior_cache(
    cancel: bool,
) -> None:
    error = asyncio.CancelledError("cancelled") if cancel else OSError("unavailable")
    store = SimpleNamespace(
        get=AsyncMock(return_value={"value": "prior"}),
        get_many=AsyncMock(
            side_effect=[error, {"new": {"payload": {"value": "retried"}}}]
        ),
    )
    context = EvidenceReadContext(store)
    await context.get("evidence", "prior")
    with pytest.raises(type(error)) as caught:
        await context.prefetch("evidence", ["prior", "new"])
    assert caught.value is error
    await context.prefetch("evidence", ["prior", "new"])
    assert await context.get("evidence", "prior") == {"value": "prior"}
    assert await context.get("evidence", "new") == {"value": "retried"}
    assert store.get_many.await_args_list == [
        call("evidence", ["new"]),
        call("evidence", ["new"]),
    ]
    store.get.assert_awaited_once_with("evidence", "prior")
