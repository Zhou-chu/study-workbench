"""Direct source stream behavior with a synthetic graph, without HTTP."""

from unittest.mock import MagicMock, patch

import pytest


def _graph_state(values):
    state = MagicMock()
    state.values = values
    return state


class _Msg:
    """A LangChain-like message with id/type/content."""

    def __init__(self, id, type, content):
        self.id = id
        self.type = type
        self.content = content


async def _collect_events(gen):
    import json

    events = []
    async for chunk in gen:
        assert chunk.startswith("data: ")
        events.append(json.loads(chunk[len("data: ") :]))
    return events


@pytest.mark.asyncio
@patch("api.routers.source_chat.source_chat_graph")
async def test_stream_emits_only_the_new_ai_message(mock_graph):
    """The graph result carries the whole checkpointed history; the stream must
    send only this turn's answer, not every previous AI message (#1393)."""
    from api.routers.source_chat import stream_source_chat_response

    mock_graph.get_state.return_value = _graph_state(
        {
            "messages": [
                _Msg("m1", "human", "first question"),
                _Msg("m2", "ai", "first answer"),
            ]
        }
    )
    mock_graph.invoke.return_value = {
        "messages": [
            _Msg("m1", "human", "first question"),
            _Msg("m2", "ai", "first answer"),
            _Msg("m3", "human", "second question"),
            _Msg("m4", "ai", "second answer"),
        ],
        "context_indicators": {"sources": ["source:xyz"], "insights": [], "notes": []},
    }

    events = await _collect_events(
        stream_source_chat_response("chat_session:abc", "source:xyz", "second question")
    )

    ai_events = [e for e in events if e["type"] == "ai_message"]
    assert [e["content"] for e in ai_events] == ["second answer"]
    assert [e["type"] for e in events] == [
        "user_message",
        "ai_message",
        "context_indicators",
        "complete",
    ]
