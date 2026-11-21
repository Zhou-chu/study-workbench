"""Direct owner-finalization policy with graph and persistence boundaries replaced."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from commands import source_commands as commands
from open_notebook.domain.notebook import Source


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
