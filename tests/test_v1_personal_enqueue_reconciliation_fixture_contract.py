"""Contract for the test-side MemoryStore used by the enqueue fixtures."""

import pytest
from personal_enqueue_fixtures import MemoryStore


@pytest.mark.asyncio
async def test_store_snapshots_and_create_only_are_independent():
    store = MemoryStore()
    initial = {"nested": {"values": ["original"]}}
    returned = await store.put("job", "job:synthetic", initial, create_only=True)
    initial["nested"]["values"].append("caller mutation")
    returned["nested"]["values"].append("return mutation")
    read = await store.get("job", "job:synthetic")
    read["nested"]["values"].append("reader mutation")
    with pytest.raises(ValueError, match="Record already exists"):
        await store.put("job", "job:synthetic", {"replacement": True}, create_only=True)
    assert await store.get("job", "job:synthetic") == {
        "nested": {"values": ["original"]}
    }
    assert len(store.writes) == 1
