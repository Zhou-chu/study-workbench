"""Real domain reads/links/status projections; query, relation and command I/O doubled."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import surreal_commands

from open_notebook.domain import notebook as mod
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def query(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    boundary = AsyncMock()
    monkeypatch.setattr(mod, "repo_query", boundary)
    return boundary


@pytest.mark.parametrize(
    "rows,count", [([], 0), ([{"chunks": 0}], 0), ([{"chunks": 37}], 37)]
)
async def test_embedded_count_uses_bound_source_identity(query: AsyncMock, rows, count):
    source = mod.Source(id="source:chosen")
    query.return_value = rows
    assert await source.get_embedded_chunks() == count
    query.assert_awaited_once()
    args = query.await_args
    assert args is not None
    assert "source=$id" in args.args[0]
    assert str(args.args[1]["id"]) == "source:chosen"


@pytest.mark.parametrize("rows", [[{}], None])
async def test_unusable_count_response_does_not_invent_zero(query: AsyncMock, rows):
    query.return_value = rows
    with pytest.raises(DatabaseOperationError):
        await mod.Source(id="source:chosen").get_embedded_chunks()


async def test_embedding_lookup_returns_real_detached_source(query: AsyncMock):
    row = {"id": "source:chosen", "title": "Recovered source", "full_text": "正文"}
    query.return_value = [{"source": row}]
    result = await mod.SourceEmbedding(
        id="source_embedding:one", content="chunk"
    ).get_source()
    assert isinstance(result, mod.Source)
    assert (result.id, result.title, result.full_text) == (
        "source:chosen",
        "Recovered source",
        "正文",
    )
    result.title = "caller edit"
    assert row["title"] == "Recovered source"
    args = query.await_args
    assert args is not None and str(args.args[1]["id"]) == "source_embedding:one"


@pytest.mark.parametrize("rows", [[], [{}]])
async def test_missing_embedding_relation_is_not_an_empty_source(
    query: AsyncMock, rows
):
    query.return_value = rows
    with pytest.raises(DatabaseOperationError):
        await mod.SourceEmbedding(
            id="source_embedding:one", content="chunk"
        ).get_source()


@pytest.mark.parametrize("operation", ["chunks", "embedding", "insights"])
async def test_cancelled_record_read_preserves_identity(
    query: AsyncMock, operation: str
):
    error = asyncio.CancelledError("cancelled read")
    query.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        if operation == "chunks":
            await mod.Source(id="source:one").get_embedded_chunks()
        elif operation == "embedding":
            await mod.SourceEmbedding(
                id="source_embedding:one", content="chunk"
            ).get_source()
        else:
            await mod.Source(id="source:one").get_insights()
    assert caught.value is error
    query.assert_awaited_once()


async def test_insight_read_failure_has_fixed_domain_message_and_cause(
    query: AsyncMock,
):
    error = OSError("synthetic storage detail")
    query.side_effect = error
    with pytest.raises(DatabaseOperationError) as caught:
        await mod.Source(id="source:one").get_insights()
    assert str(caught.value) == "Failed to fetch insights for source"
    assert caught.value.__cause__ is error


@pytest.mark.parametrize("size", ["short", "long"])
async def test_source_context_reads_real_insight_models_and_selected_text(
    query: AsyncMock, size
):
    row = dict(
        id="source_insight:one",
        source="source:one",
        insight_type="summary",
        content="关键概念",
    )
    query.return_value = [row]
    source = mod.Source(id="source:one", title="课程", full_text="开头\n完整末尾")
    result = await source.get_context(context_size=size)
    assert result["id"] == "source:one" and result["title"] == "课程"
    assert result["insights"][0]["content"] == "关键概念"
    assert result["insights"][0]["id"] == "source_insight:one"
    assert ("full_text" in result) is (size == "long")
    if size == "long":
        assert result["full_text"] == "开头\n完整末尾"
    query.assert_awaited_once()


@pytest.mark.parametrize("entry", ["source", "chat-notebook", "chat-source"])
async def test_relation_requires_nonempty_target_before_io(
    monkeypatch: pytest.MonkeyPatch, entry: str
):
    relation = AsyncMock()
    lookup = AsyncMock()
    monkeypatch.setattr(mod.Source, "relate", relation)
    monkeypatch.setattr(mod.ChatSession, "relate", relation)
    monkeypatch.setattr(mod.Notebook, "get", lookup)
    with pytest.raises(InvalidInputError, match="ID must be provided"):
        if entry == "source":
            await mod.Source(id="source:one").add_to_notebook("")
        elif entry == "chat-notebook":
            await mod.ChatSession(id="chat_session:one").relate_to_notebook("")
        else:
            await mod.ChatSession(id="chat_session:one").relate_to_source("")
    relation.assert_not_awaited()
    lookup.assert_not_awaited()


async def test_source_relation_checks_notebook_then_returns_relation_receipt(
    monkeypatch: pytest.MonkeyPatch,
):
    events: list[str] = []
    receipt = {"id": "reference:synthetic"}

    async def lookup(identity):
        assert identity == "notebook:chosen"
        events.append("lookup")
        return mod.Notebook(id=identity, name="Chosen", description="")

    async def relate(relation, identity):
        assert events == ["lookup"]
        assert (relation, identity) == ("reference", "notebook:chosen")
        events.append("relate")
        return receipt

    monkeypatch.setattr(mod.Notebook, "get", AsyncMock(side_effect=lookup))
    monkeypatch.setattr(mod.Source, "relate", AsyncMock(side_effect=relate))
    assert (
        await mod.Source(id="source:one").add_to_notebook("notebook:chosen") is receipt
    )
    assert events == ["lookup", "relate"]


async def test_missing_notebook_prevents_source_relation(
    monkeypatch: pytest.MonkeyPatch,
):
    error = NotFoundError("missing")
    relation = AsyncMock()
    monkeypatch.setattr(mod.Notebook, "get", AsyncMock(side_effect=error))
    monkeypatch.setattr(mod.Source, "relate", relation)
    with pytest.raises(NotFoundError) as caught:
        await mod.Source(id="source:one").add_to_notebook("notebook:missing")
    assert caught.value is error
    relation.assert_not_awaited()


@pytest.mark.parametrize(
    "entry,identity", [("notebook", "notebook:chosen"), ("source", "source:chosen")]
)
async def test_chat_relation_preserves_target_and_receipt(
    monkeypatch: pytest.MonkeyPatch, entry: str, identity: str
):
    receipt = object()
    relation = AsyncMock(return_value=receipt)
    monkeypatch.setattr(mod.ChatSession, "relate", relation)
    session = mod.ChatSession(id="chat_session:one")
    result = await (
        session.relate_to_notebook(identity)
        if entry == "notebook"
        else session.relate_to_source(identity)
    )
    assert result is receipt
    relation.assert_awaited_once_with("refers_to", identity)


@pytest.fixture
def command(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    status = AsyncMock()
    monkeypatch.setattr(surreal_commands, "get_command_status", status)
    return status


async def test_source_without_command_does_not_read_command_backend(command: AsyncMock):
    source = mod.Source(id="source:one")
    assert await source.get_status() is None
    assert await source.get_processing_progress() is None
    command.assert_not_awaited()


@pytest.mark.parametrize("state", ["queued", "running", "completed"])
async def test_command_status_does_not_override_unconfirmed_terminal_ownership(
    command: AsyncMock, state: str
):
    command.return_value = SimpleNamespace(status=state)
    source = mod.Source(id="source:one", command="command:one")
    assert await source.get_status() == ("unknown" if state == "completed" else state)
    command.assert_awaited_once_with("command:one")


@pytest.mark.parametrize(
    "result",
    [
        None,
        "legacy",
        {"execution_metadata": {"started_at": "start", "completed_at": "end"}},
    ],
)
async def test_running_progress_projects_available_metadata(command: AsyncMock, result):
    command.return_value = SimpleNamespace(
        status="running", result=result, error_message=None
    )
    source = mod.Source(id="source:one", command="command:one")
    projection = await source.get_processing_progress()
    assert projection == {
        "status": "running",
        "started_at": "start" if isinstance(result, dict) else None,
        "completed_at": "end" if isinstance(result, dict) else None,
        "error": None,
        "result": result,
    }
    command.assert_awaited_once_with("command:one")


@pytest.mark.parametrize("outcome", ["missing", "failure", "stale-terminal"])
async def test_unknown_command_progress_excludes_unowned_result(
    command: AsyncMock, outcome: str
):
    if outcome == "missing":
        command.return_value = None
    elif outcome == "failure":
        command.side_effect = RuntimeError("backend unavailable")
    else:
        command.return_value = SimpleNamespace(
            status="completed", result={"answer": "unowned"}, error_message="unowned"
        )
    source = mod.Source(id="source:one", command="command:one")
    assert await source.get_processing_progress() == {
        "status": "unknown",
        "owner_phase": None,
        "submission_unknown": True,
    }


async def test_command_cancellation_preserves_caller_control(command: AsyncMock):
    error = asyncio.CancelledError()
    command.side_effect = error
    source = mod.Source(id="source:one", command="command:one")
    with pytest.raises(asyncio.CancelledError) as caught:
        await source.get_processing_progress()
    assert caught.value is error
