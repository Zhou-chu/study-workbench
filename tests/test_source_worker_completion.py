"""Multiple SDK workers share command status, but never source execution ownership."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from commands import source_commands as commands
from open_notebook.domain.notebook import Source


@pytest.mark.asyncio
async def test_actual_sdk_duplicate_failure_does_not_finalize_live_owner(monkeypatch):
    from surreal_commands.core.service import CommandService

    command_service = CommandService()

    entered = asyncio.Event()
    release = asyncio.Event()
    owner = None
    phases = []
    statuses = []

    async def start(source_id, token, command_id, owner_id=None):
        nonlocal owner
        if owner is not None:
            raise ValueError("Stale or duplicate source worker refused")
        owner = owner_id or "old-implementation"
        return {
            "processing_attempt": {"token": token, "owner": owner, "phase": "running"}
        }

    async def graph(*args, **kwargs):
        entered.set()
        await release.wait()
        raise ValueError("winner's ordinary processing failure")

    async def finish(source_id, token, owner_id, succeeded):
        assert owner_id == owner
        phases.append("succeeded" if succeeded else "failed")

    async def status(command_id, value, *args, **kwargs):
        statuses.append(value)

    monkeypatch.setattr(
        Source, "get", AsyncMock(return_value=Source(id="source:fixture"))
    )
    monkeypatch.setattr(commands, "start_worker", start)
    monkeypatch.setattr(commands, "finish_worker", finish, raising=False)
    monkeypatch.setattr(commands.source_graph, "ainvoke", graph)
    monkeypatch.setattr(command_service, "update_command_result", status)
    args = dict(
        source_id="source:fixture",
        submission_token="attempt",
        content_state={},
        notebook_ids=[],
        transformations=[],
        embed=False,
    )
    winner = asyncio.create_task(
        command_service.execute_command(
            "command:same", "open_notebook.process_source", dict(args)
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), 5)
        await command_service.execute_command(
            "command:same", "open_notebook.process_source", dict(args)
        )
        assert statuses[-1] == "failed"  # Actual installed SDK corrupts shared status.
        assert not winner.done()
        assert phases == []  # A rejected duplicate cannot release the winner.
    finally:
        release.set()
        await winner
    assert phases == ["failed"]  # Only the positively terminated owner releases.


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome", ["ordinary", "unknown", "cancelled", "success", "success_acklost"]
)
async def test_only_acknowledged_positive_pipeline_termination_finalizes(
    monkeypatch, outcome
):
    from open_notebook.exceptions import CommandSubmissionUnknownError

    source = Source(id="source:fixture")
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_insights", AsyncMock(return_value=[]))

    async def start(source_id, token, command_id, owner_id):
        return {
            "processing_attempt": {
                "token": "attempt",
                "owner": owner_id,
                "phase": "running",
            }
        }

    monkeypatch.setattr(commands, "start_worker", start)
    finish = AsyncMock(
        side_effect=CommandSubmissionUnknownError()
        if outcome == "success_acklost"
        else None
    )
    monkeypatch.setattr(commands, "finish_worker", finish)
    failures = {
        "ordinary": ValueError("ordinary failure"),
        "unknown": CommandSubmissionUnknownError(),
        "cancelled": asyncio.CancelledError(),
    }
    graph = AsyncMock(
        return_value={"source": source}, side_effect=failures.get(outcome)
    )
    monkeypatch.setattr(commands.source_graph, "ainvoke", graph)
    args = commands.SourceProcessingInput(
        source_id="source:fixture",
        content_state={},
        notebook_ids=[],
        transformations=[],
        embed=False,
    )
    if outcome == "success_acklost":
        with pytest.raises(CommandSubmissionUnknownError):
            await commands.process_source_command(args)
    elif outcome in failures:
        with pytest.raises(type(failures[outcome])):
            await commands.process_source_command(args)
    else:
        assert (await commands.process_source_command(args)).success
    if outcome in {"unknown", "cancelled"}:
        finish.assert_not_called()
    else:
        finish.assert_awaited_once()
        assert finish.await_args is not None
        assert graph.await_args is not None
        assert finish.await_args.args[3] is (outcome in {"success", "success_acklost"})
        assert finish.await_args.args[2] == graph.await_args.args[0]["execution_owner"]


@pytest.mark.asyncio
async def test_lost_claim_receipt_cannot_finalize_even_if_it_committed(monkeypatch):
    from open_notebook.exceptions import CommandSubmissionUnknownError

    monkeypatch.setattr(
        Source, "get", AsyncMock(return_value=Source(id="source:fixture"))
    )
    monkeypatch.setattr(
        commands, "start_worker", AsyncMock(side_effect=CommandSubmissionUnknownError())
    )
    finish = AsyncMock()
    graph = AsyncMock()
    monkeypatch.setattr(commands, "finish_worker", finish)
    monkeypatch.setattr(commands.source_graph, "ainvoke", graph)
    with pytest.raises(CommandSubmissionUnknownError):
        await commands.process_source_command(
            commands.SourceProcessingInput(
                source_id="source:fixture",
                content_state={},
                notebook_ids=[],
                transformations=[],
                embed=False,
            )
        )
    finish.assert_not_called()
    graph.assert_not_called()


@pytest.mark.asyncio
async def test_owner_failure_waits_for_actual_langgraph_sibling_cleanup(monkeypatch):
    from langgraph.graph import END, START, StateGraph
    from typing_extensions import TypedDict

    class State(TypedDict):
        source_id: str

    entered = asyncio.Event()
    cancelling = asyncio.Event()
    release = asyncio.Event()
    drained = asyncio.Event()

    async def slow(state):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelling.set()
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    # LangGraph may cancel a sibling twice during shutdown.
                    # Keep cleanup live to prove the owner waits for termination.
                    continue
            drained.set()

    async def fail(state):
        await entered.wait()
        raise ValueError("one graph branch failed")

    graph = StateGraph(State)
    graph.add_node("slow", slow)
    graph.add_node("fail", fail)
    graph.add_edge(START, "slow")
    graph.add_edge(START, "fail")
    graph.add_edge("slow", END)
    graph.add_edge("fail", END)
    monkeypatch.setattr(commands, "source_graph", graph.compile())
    monkeypatch.setattr(
        Source, "get", AsyncMock(return_value=Source(id="source:fixture"))
    )
    monkeypatch.setattr(
        commands,
        "start_worker",
        AsyncMock(return_value={"processing_attempt": {"token": "owner"}}),
    )

    async def finish(*args):
        assert drained.is_set()

    finalize = AsyncMock(side_effect=finish)
    monkeypatch.setattr(commands, "finish_worker", finalize)
    task = asyncio.create_task(
        commands.process_source_command(
            commands.SourceProcessingInput(
                source_id="source:fixture",
                content_state={},
                notebook_ids=[],
                transformations=[],
                embed=False,
            )
        )
    )
    try:
        await asyncio.wait_for(cancelling.wait(), 5)
        finalize.assert_not_called()
        assert not task.done()
    finally:
        release.set()
        with pytest.raises(ValueError, match="graph branch failed"):
            await task
    finalize.assert_awaited_once()


@pytest.mark.asyncio
async def test_actual_langgraph_hidden_sibling_unknown_never_releases_owner(
    monkeypatch,
):
    from langgraph.graph import END, START, StateGraph
    from typing_extensions import TypedDict

    from open_notebook.domain.transformation import Transformation
    from open_notebook.exceptions import CommandSubmissionUnknownError
    from open_notebook.graphs import source as source_graph

    class State(TypedDict):
        source_id: str

    accepted = asyncio.Event()
    unknown = asyncio.Event()
    source = Source(id="source:fixture", full_text="input")

    async def submit(*args):
        accepted.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            unknown.set()
            raise CommandSubmissionUnknownError() from None

    async def sibling(state):
        await source_graph.transform_content(
            {
                "source": source,
                "transformation": Transformation(
                    name="test",
                    title="test",
                    description="test",
                    prompt="test",
                    apply_default=False,
                    model_id=None,
                ),
            }
        )

    async def fail(state):
        await accepted.wait()
        raise ValueError("ordinary sibling wins exception selection")

    graph = StateGraph(State)
    graph.add_node("unknown_effect", sibling)
    graph.add_node("ordinary", fail)
    graph.add_edge(START, "unknown_effect")
    graph.add_edge(START, "ordinary")
    graph.add_edge("unknown_effect", END)
    graph.add_edge("ordinary", END)
    monkeypatch.setattr(commands, "source_graph", graph.compile())
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "add_insight", submit)
    monkeypatch.setattr(
        source_graph.transform_graph,
        "ainvoke",
        AsyncMock(return_value={"output": "text"}),
    )
    monkeypatch.setattr(
        commands,
        "start_worker",
        AsyncMock(return_value={"processing_attempt": {"token": "attempt"}}),
    )
    finish = AsyncMock()
    monkeypatch.setattr(commands, "finish_worker", finish)
    with pytest.raises(ValueError, match="exception selection"):
        await commands.process_source_command(
            commands.SourceProcessingInput(
                source_id="source:fixture",
                content_state={},
                notebook_ids=[],
                transformations=[],
                embed=False,
            )
        )
    assert unknown.is_set()
    finish.assert_not_called()
