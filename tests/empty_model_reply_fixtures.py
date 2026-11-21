"""Checkpoint fixtures backed by an isolated SQLite graph."""

import sqlite3
from typing import Annotated

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from open_notebook.exceptions import IncompleteGenerationError


class _State(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    source_id: str
    model_override: str
    context_indicators: dict
    context: str
    notebook: object


def _toy_graph(replies: list):
    """A checkpointed graph whose node raises like the real one on an empty
    reply, then answers on the next call."""

    def node(state):
        reply = replies.pop(0)
        if not reply.strip():
            raise IncompleteGenerationError("The model returned an empty response.")
        return {"messages": AIMessage(content=reply)}

    builder = StateGraph(_State)
    builder.add_node("agent", node)
    builder.add_edge(START, "agent")
    builder.add_edge("agent", END)
    saver = SqliteSaver(sqlite3.connect(":memory:", check_same_thread=False))
    return builder.compile(checkpointer=saver)


def _history(graph, thread_id):
    state = graph.get_state(RunnableConfig(configurable={"thread_id": thread_id}))
    return [(m.type, m.content) for m in state.values.get("messages", [])]
