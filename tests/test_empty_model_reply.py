"""An empty model reply is an error, not an answer (#1392).

Covers the graph nodes (notebook chat, source chat, Ask final answer) and the
router side of a failed turn: the user's question is removed from the thread
checkpoint so a retry doesn't duplicate it.
"""

import json
from unittest.mock import patch

import pytest
from empty_model_reply_fixtures import _history, _toy_graph
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

from open_notebook.exceptions import IncompleteGenerationError

# --- failed turn: no persisted blank answer, no duplicated question ----------


async def _events(gen):
    return [json.loads(chunk[len("data: ") :]) async for chunk in gen]


@pytest.mark.asyncio
async def test_source_chat_failed_turn_is_rolled_back_and_retry_is_clean():
    from api.routers.source_chat import stream_source_chat_response

    graph = _toy_graph(["", "the answer"])
    with patch("api.routers.source_chat.source_chat_graph", graph):
        failed = await _events(
            stream_source_chat_response("chat_session:s", "source:1", "question")
        )
        assert failed[-1] == {
            "type": "error",
            "message": "The model returned an empty response.",
        }
        assert not any(e["type"] == "ai_message" for e in failed)
        assert _history(graph, "chat_session:s") == []

        retried = await _events(
            stream_source_chat_response("chat_session:s", "source:1", "question")
        )

    assert [e["content"] for e in retried if e["type"] == "ai_message"] == [
        "the answer"
    ]
    assert _history(graph, "chat_session:s") == [
        ("human", "question"),
        ("ai", "the answer"),
    ]


def test_discard_unanswered_message_keeps_earlier_turns():
    from open_notebook.utils.graph_utils import discard_unanswered_message

    graph = _toy_graph(["first answer", ""])
    config = RunnableConfig(configurable={"thread_id": "t"})
    graph.invoke({"messages": [HumanMessage(content="q1", id="h1")]}, config)

    pending = HumanMessage(content="q2", id="h2")
    with pytest.raises(IncompleteGenerationError):
        graph.invoke({"messages": [pending]}, config)
    assert _history(graph, "t")[-1] == ("human", "q2")

    discard_unanswered_message(graph, "t", pending)

    assert _history(graph, "t") == [("human", "q1"), ("ai", "first answer")]


def test_discard_unanswered_message_ignores_unknown_ids():
    from open_notebook.utils.graph_utils import discard_unanswered_message

    graph = _toy_graph(["first answer"])
    config = RunnableConfig(configurable={"thread_id": "t"})
    graph.invoke({"messages": [HumanMessage(content="q1", id="h1")]}, config)

    # Never reached the checkpoint (e.g. get_state failed before invoke).
    discard_unanswered_message(graph, "t", HumanMessage(content="x", id="nope"))

    assert _history(graph, "t") == [("human", "q1"), ("ai", "first answer")]
