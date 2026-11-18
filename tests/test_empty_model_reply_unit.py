"""Empty provider responses through direct graph nodes with synthetic model boundaries."""

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from open_notebook.exceptions import IncompleteGenerationError

EMPTY_REPLIES = ["", "   \n\t", "<think>only reasoning</think>", None]


def _sync_model_returning(content: str) -> MagicMock:
    model = MagicMock()
    # AIMessage won't accept content=None; some providers still return it.
    reply = MagicMock(content=None) if content is None else AIMessage(content=content)
    model.invoke = MagicMock(return_value=reply)
    return model


@pytest.mark.parametrize("reply", EMPTY_REPLIES)
def test_notebook_chat_node_rejects_empty_reply(reply):
    from open_notebook.graphs.chat import call_model_with_messages

    state = {"messages": [HumanMessage(content="hi")], "notebook": None}
    with patch(
        "open_notebook.graphs.chat.provision_langchain_model",
        new=AsyncMock(return_value=_sync_model_returning(reply)),
    ):
        with pytest.raises(IncompleteGenerationError, match="empty response"):
            call_model_with_messages(state, {"configurable": {}})  # type: ignore[arg-type]


def test_notebook_chat_node_keeps_nonempty_reply():
    from open_notebook.graphs.chat import call_model_with_messages

    state = {"messages": [HumanMessage(content="hi")], "notebook": None}
    with patch(
        "open_notebook.graphs.chat.provision_langchain_model",
        new=AsyncMock(return_value=_sync_model_returning("<think>x</think>hello")),
    ):
        result = call_model_with_messages(state, {"configurable": {}})  # type: ignore[arg-type]
    assert result["messages"].content == "hello"


@pytest.mark.parametrize("reply", EMPTY_REPLIES)
def test_source_chat_node_rejects_empty_reply(reply):
    from open_notebook.graphs.source_chat import call_model_with_source_context

    state = {"source_id": "source:1", "messages": [HumanMessage(content="hi")]}
    with (
        patch(
            "open_notebook.graphs.source_chat.build_source_context",
            new=AsyncMock(return_value={"sources": [], "insights": []}),
        ),
        patch(
            "open_notebook.graphs.source_chat.provision_langchain_model",
            new=AsyncMock(return_value=_sync_model_returning(reply)),
        ),
    ):
        with pytest.raises(IncompleteGenerationError, match="empty response"):
            call_model_with_source_context(state, {"configurable": {}})  # type: ignore[arg-type]


@pytest.mark.asyncio
@pytest.mark.parametrize("reply", EMPTY_REPLIES)
async def test_ask_final_answer_rejects_empty_reply(reply):
    from open_notebook.graphs.ask import ThreadState, write_final_answer

    model = MagicMock()
    model.ainvoke = AsyncMock(return_value=MagicMock(content=reply))
    with patch(
        "open_notebook.graphs.ask.provision_langchain_model",
        new=AsyncMock(return_value=model),
    ):
        with pytest.raises(IncompleteGenerationError, match="empty response"):
            await write_final_answer(
                cast(ThreadState, {"question": "q", "answers": ["a"]}),
                cast(RunnableConfig, {"configurable": {}}),
            )
