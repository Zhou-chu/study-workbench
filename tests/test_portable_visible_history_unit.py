"""Visible-history adapter policy with filesystem, graph and thread boundaries doubled."""

import asyncio
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import api.portable_service as module
from open_notebook.exceptions import InvalidInputError


@pytest.fixture
def history(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    # Prevent config module initialization (which creates directories), even cold.
    config = ModuleType("open_notebook.config")
    setattr(config, "LANGGRAPH_CHECKPOINT_FILE", "synthetic-never-opened.sqlite")
    monkeypatch.setitem(sys.modules, "open_notebook.config", config)
    exists = Mock(return_value=True)
    path = Mock(return_value=SimpleNamespace(is_file=exists))
    monkeypatch.setattr(module, "Path", path)
    notebook_graph = SimpleNamespace(get_state=Mock())
    source_graph = SimpleNamespace(get_state=Mock())
    for name, attr, graph in (
        ("open_notebook.graphs.chat", "graph", notebook_graph),
        ("open_notebook.graphs.source_chat", "source_chat_graph", source_graph),
    ):
        fake = ModuleType(name)
        setattr(fake, attr, graph)
        monkeypatch.setitem(sys.modules, name, fake)
    state = SimpleNamespace(values={"messages": []})
    thread = AsyncMock(return_value=state)
    monkeypatch.setattr(module.asyncio, "to_thread", thread)
    return SimpleNamespace(
        repository=module.SurrealProjectRepository(object()),
        exists=exists,
        path=path,
        notebook_graph=notebook_graph,
        source_graph=source_graph,
        state=state,
        thread=thread,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("allow_missing", [False, True])
async def test_missing_history_is_only_allowed_for_explicit_restored_fallback(
    history: SimpleNamespace, allow_missing: bool
) -> None:
    history.exists.return_value = False
    if allow_missing:
        assert (
            await history.repository._visible_messages(
                "session:one", allow_missing=True
            )
            == []
        )
    else:
        with pytest.raises(InvalidInputError, match="cannot claim complete history"):
            await history.repository._visible_messages("session:one")
    history.thread.assert_not_awaited()
    history.path.assert_called_once_with("synthetic-never-opened.sqlite")


@pytest.mark.asyncio
@pytest.mark.parametrize("source_chat", [False, True])
async def test_selected_graph_is_bound_to_session_and_only_visible_messages_export(
    history: SimpleNamespace, source_chat: bool
) -> None:
    history.state.values = {
        "messages": [
            SimpleNamespace(id="sys", type="system", content="not visible"),
            SimpleNamespace(id="human", type="human", content="question"),
            SimpleNamespace(id="tool", type="tool", content="not visible"),
            SimpleNamespace(id="ai", type="ai", content="answer"),
        ]
    }
    result = await history.repository._visible_messages(
        "session:one", source_chat=source_chat
    )
    assert result == [
        {"id": "human", "type": "human", "content": "question", "timestamp": None},
        {"id": "ai", "type": "ai", "content": "answer", "timestamp": None},
    ]
    graph = history.source_graph if source_chat else history.notebook_graph
    history.thread.assert_awaited_once_with(
        graph.get_state, config={"configurable": {"thread_id": "session:one"}}
    )
    history.notebook_graph.get_state.assert_not_called()
    history.source_graph.get_state.assert_not_called()


@pytest.mark.asyncio
async def test_state_without_messages_exports_empty_history(
    history: SimpleNamespace,
) -> None:
    history.state.values = {}
    assert await history.repository._visible_messages("session:one") == []


@pytest.mark.asyncio
async def test_graph_failure_is_explicit_and_preserves_cause_without_detail_leak(
    history: SimpleNamespace,
) -> None:
    error = OSError("synthetic internal storage detail")
    history.thread.side_effect = error
    with pytest.raises(
        InvalidInputError, match="history could not be read; export stopped"
    ) as caught:
        await history.repository._visible_messages("session:one")
    assert caught.value.__cause__ is error
    assert "synthetic internal" not in str(caught.value)
    assert history.thread.await_count == 1


@pytest.mark.asyncio
async def test_malformed_visible_message_stops_export(history: SimpleNamespace) -> None:
    history.state.values = {
        "messages": [SimpleNamespace(id="ai", type="ai", content=["invalid"])]
    }
    with pytest.raises(InvalidInputError, match="export stopped") as caught:
        await history.repository._visible_messages("session:one")
    assert caught.value.__cause__ is not None


@pytest.mark.asyncio
async def test_cancellation_is_not_rewritten_as_incomplete_history(
    history: SimpleNamespace,
) -> None:
    error = asyncio.CancelledError("synthetic cancellation")
    history.thread.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await history.repository._visible_messages("session:one")
    assert caught.value is error
    assert history.thread.await_count == 1
