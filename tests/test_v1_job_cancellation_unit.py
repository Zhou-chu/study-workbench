"""Direct cancellation SSE state projection against a fixture-backed store."""

import pytest
from v1_notebooklm_helpers import MemoryStore

from api.routers import evidence


@pytest.mark.asyncio
@pytest.mark.parametrize("turn_state", ["running", "succeeded", "failed"])
async def test_events_prioritize_cancelled_wait_over_existing_turn(
    monkeypatch, turn_state
):
    store = MemoryStore()
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    await store.put(
        "job",
        "job",
        {"turn_id": "turn", "state": "cancelled_local", "remote_may_continue": True},
    )
    await store.put("turn", "turn", {"turn_id": "turn", "status": turn_state})
    response = await evidence.turn_events("turn")
    events = response.body_iterator
    first = await anext(events)
    assert '"state": "cancelled_local"' in first
    assert '"remote_may_continue": true' in first
    with pytest.raises(StopAsyncIteration):
        await anext(events)
