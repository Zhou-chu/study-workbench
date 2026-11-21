"""Direct PersonalService with deterministic uncertain queue and storage doubles."""

import pytest
from personal_dispatch_receipt_fixtures import FIXTURE
from personal_enqueue_fixtures import MemoryStore as SnapshotStore

from api.personal_service import PersonalService


@pytest.mark.asyncio
@pytest.mark.parametrize("write_committed", [False, True])
async def test_receipt_persistence_error_is_not_a_durable_dispatch_receipt(
    monkeypatch,
    write_committed,
):
    store = SnapshotStore()
    queue_failure = TimeoutError("SYNTHETIC_QUEUE_ACK_UNKNOWN")
    storage_failure = RuntimeError("SYNTHETIC_STORAGE_ACK_UNKNOWN")
    put = store.put

    async def uncertain_put(kind, identity, value, create_only=False):
        if create_only:
            return await put(kind, identity, value, create_only=True)
        if write_committed:
            await put(kind, identity, value)
        raise storage_failure

    monkeypatch.setattr(store, "put", uncertain_put)

    async def submit(*_):
        raise queue_failure

    with pytest.raises(RuntimeError) as caught:
        await PersonalService(store=store, submit=submit).submit_turn(
            "chat:synthetic", FIXTURE["request"]
        )
    assert caught.value is storage_failure
    assert caught.value.__context__ is queue_failure
    initial = store.writes[0][1]
    persisted = await store.get("job", initial["job_id"])
    if write_committed:
        assert persisted["dispatch_receipt"] == FIXTURE["body"]["dispatch_receipt"]
    else:
        assert persisted == initial
        assert "dispatch_receipt" not in persisted
