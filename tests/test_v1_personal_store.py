import asyncio

import pytest


@pytest.mark.asyncio
async def test_project_lock_serializes_same_project(tmp_path):
    from api.personal_store import project_lock

    order = []

    async def one():
        async with project_lock("nb", tmp_path):
            order.append("one-start")
            await asyncio.sleep(0.03)
            order.append("one-end")

    async def two():
        await asyncio.sleep(0.01)
        async with project_lock("nb", tmp_path):
            order.append("two")

    await asyncio.gather(one(), two())
    assert order == ["one-start", "one-end", "two"]


@pytest.mark.asyncio
async def test_store_rejects_unknown_kind_before_database():
    from api.personal_store import PersonalStore

    with pytest.raises(ValueError):
        await PersonalStore().get("credential", "x")


def test_record_identity_stable_and_kind_separated():
    from api.personal_store import record_key

    assert record_key("version", "x") == record_key("version", "x")
    assert record_key("version", "x") != record_key("evidence", "x")
