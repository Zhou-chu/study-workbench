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

    # Golden SHA256("x") protocol vector: a constant or altered encoding fails.
    digest = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
    assert record_key("version", "x") == f"v1_version:{digest}"
    assert record_key("evidence", "x") == f"v1_evidence:{digest}"
    assert record_key("version", "y") != f"v1_version:{digest}"


@pytest.mark.asyncio
async def test_cross_instance_lock_cancellation_releases_waiter_and_holder(tmp_path):
    from open_notebook.database.project_locks import note_mutation_lock, project_lock

    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder():
        async with note_mutation_lock(tmp_path):
            async with project_lock("same", tmp_path):
                entered.set()
                await release.wait()

    async def waiter():
        await entered.wait()
        async with project_lock("same", tmp_path):
            raise AssertionError("holder has not released")

    first = asyncio.create_task(holder())
    await entered.wait()
    second = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    second.cancel()
    with pytest.raises(asyncio.CancelledError):
        await second
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first

    async def reacquire():
        async with note_mutation_lock(tmp_path):
            async with project_lock("same", tmp_path):
                return True

    assert await asyncio.wait_for(reacquire(), 1)
