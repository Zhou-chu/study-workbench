"""Stored instructions reach the real graph through the real singleton, offline."""

import asyncio
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage

from api.models import DefaultPromptUpdate
from api.routers.transformations import update_default_prompt
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import DefaultPrompts
from open_notebook.exceptions import DatabaseOperationError
from open_notebook.graphs.transformation import run_transformation


@pytest.fixture
def boundaries():
    DefaultPrompts.clear_instance()
    saved = {"transformation_instructions": "Stored global instruction"}
    messages = []
    reads = AsyncMock(side_effect=lambda *args, **kwargs: [dict(saved)])

    async def save(_table, _id, data):
        saved.update(data)

    writes = AsyncMock(side_effect=save)

    async def answer(payload):
        messages.append(payload)
        return AIMessage(content="<think>Hidden</think>Clean answer")

    chain = AsyncMock()
    chain.ainvoke.side_effect = answer
    provider = AsyncMock(return_value=chain)
    with (
        patch("open_notebook.domain.base.repo_query", reads),
        patch("open_notebook.domain.base.repo_upsert", writes),
        patch(
            "open_notebook.graphs.transformation.provision_langchain_model", provider
        ),
        patch.object(Source, "add_insight", new_callable=AsyncMock) as insight,
    ):
        yield SimpleNamespace(
            saved=saved,
            reads=reads,
            writes=writes,
            messages=messages,
            chain=chain,
            provider=provider,
            insight=insight,
        )
    DefaultPrompts.clear_instance()


async def invoke(
    text="  Exact input\n{{ untouched }}  ", prompt="Exact task", source=False
):
    transformation = SimpleNamespace(title="Summary", prompt=prompt)
    state: dict = {"transformation": transformation}
    if source:
        state["source"] = Source(id="source:synthetic", full_text=text)
    else:
        state["input_text"] = text
    result = await run_transformation(
        state, {"configurable": {"model_id": "model:explicit"}}
    )
    assert transformation.prompt == prompt
    return result


@pytest.mark.asyncio
async def test_cold_singleton_loads_stored_global_instructions_before_dispatch(
    boundaries,
):
    await invoke()
    assert boundaries.reads.await_count == 1
    assert (
        "Stored global instruction\n\nExact task" in boundaries.messages[0][0].content
    )
    assert boundaries.messages[0][1].content == "  Exact input\n{{ untouched }}  "
    boundaries.writes.assert_not_awaited()


@pytest.mark.asyncio
async def test_warm_singleton_survives_repeated_graph_execution_without_write(
    boundaries,
):
    original = cast(DefaultPrompts, await DefaultPrompts.get_instance())
    for _ in range(2):
        await invoke()
        assert original.transformation_instructions == "Stored global instruction"
    assert boundaries.reads.await_count == 1
    boundaries.writes.assert_not_awaited()
    assert all(
        "Stored global instruction\n\nExact task" in p[0].content
        for p in boundaries.messages
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "instructions",
    ["Updated via PUT", "", "{{ 7*7 }} {% if secret %}literal{% endif %}"],
)
async def test_existing_put_to_graph_preserves_literal_data_and_empty_instructions(
    boundaries, instructions
):
    response = await update_default_prompt(
        DefaultPromptUpdate(transformation_instructions=instructions)
    )
    assert response.transformation_instructions == instructions
    writes = boundaries.writes.await_count
    await invoke(prompt="{{ literal task }}")
    assert (
        instructions + ("\n\n" if instructions else "") + "{{ literal task }}"
        in boundaries.messages[0][0].content
    )
    assert boundaries.writes.await_count == writes
    assert (
        cast(
            DefaultPrompts, await DefaultPrompts.get_instance()
        ).transformation_instructions
        == instructions
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, ""])
@pytest.mark.parametrize("source", [False, True])
async def test_empty_or_null_is_not_replaced_and_source_only_writes_clean_insight(
    boundaries, value, source
):
    boundaries.saved["transformation_instructions"] = value
    assert await invoke(source=source) == {"output": "Clean answer"}
    assert "Exact task" in boundaries.messages[0][0].content
    assert "Stored global instruction" not in boundaries.messages[0][0].content
    boundaries.writes.assert_not_awaited()
    if source:
        boundaries.insight.assert_awaited_once_with("Summary", "Clean answer")
    else:
        boundaries.insight.assert_not_awaited()


@pytest.mark.asyncio
async def test_held_model_await_keeps_original_snapshot_during_put(boundaries):
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(payload):
        boundaries.messages.append(payload)
        entered.set()
        await release.wait()
        return AIMessage(content="Original answer")

    boundaries.chain.ainvoke.side_effect = held
    pending = asyncio.create_task(invoke())
    await entered.wait()
    await update_default_prompt(
        DefaultPromptUpdate(transformation_instructions="New global")
    )
    release.set()
    await pending
    assert (
        "Stored global instruction\n\nExact task" in boundaries.messages[0][0].content
    )
    assert "New global" not in boundaries.messages[0][0].content
    await invoke()
    assert "New global\n\nExact task" in boundaries.messages[1][0].content
    assert boundaries.writes.await_count == 1


@pytest.mark.asyncio
async def test_load_failure_does_not_dispatch_or_write(boundaries):
    boundaries.reads.side_effect = DatabaseOperationError("Synthetic unavailable")
    with pytest.raises(DatabaseOperationError):
        await invoke()
    boundaries.provider.assert_not_awaited()
    boundaries.chain.ainvoke.assert_not_awaited()
    boundaries.writes.assert_not_awaited()
