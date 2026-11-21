"""Source-chat scope and history decisions without loading the SQLite graph."""

import asyncio
import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from surrealdb import RecordID

from api.routers import _chat_shared
from open_notebook.domain.notebook import ChatSession, Source
from open_notebook.exceptions import DatabaseOperationError, NotFoundError

pytestmark = pytest.mark.asyncio
SOURCE = "source:page"
SESSION = "chat_session:history"


@dataclass
class Boundaries:
    route: ModuleType
    source: AsyncMock
    session: AsyncMock
    bound: AsyncMock
    list_reads: AsyncMock
    save: AsyncMock
    attach: AsyncMock
    delete: AsyncMock
    count: AsyncMock
    thread: AsyncMock
    stream: Mock
    get_state: Mock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    get_state = Mock(side_effect=AssertionError("Never read a live checkpoint"))
    graph = SimpleNamespace(get_state=get_state)
    graph_module = ModuleType("open_notebook.graphs.source_chat")
    graph_module.__dict__["source_chat_graph"] = graph
    path = Path(__file__).parents[1] / "api" / "routers" / "source_chat.py"
    specification = importlib.util.spec_from_file_location(
        "test_isolated_source_chat_routes", path
    )
    assert specification is not None and specification.loader is not None
    route = importlib.util.module_from_spec(specification)
    with monkeypatch.context() as isolated:
        isolated.setitem(sys.modules, graph_module.__name__, graph_module)
        specification.loader.exec_module(route)

    async def assign_saved_identity(item: ChatSession) -> None:
        if item.id is None:
            item.id = SESSION

    save = AsyncMock(side_effect=assign_saved_identity)

    async def save_boundary(item: ChatSession) -> None:
        await save(item)

    async def empty_stream():
        if False:
            yield b""

    b = Boundaries(
        route=route,
        source=AsyncMock(return_value=Source(id=SOURCE, title="课程资料")),
        session=AsyncMock(
            return_value=ChatSession(
                id=SESSION,
                title="Saved source discussion",
                model_override="model:stored",
            )
        ),
        bound=AsyncMock(return_value=[{"in": SESSION, "out": SOURCE}]),
        list_reads=AsyncMock(side_effect=AssertionError("Unexpected list query")),
        save=save,
        attach=AsyncMock(),
        delete=AsyncMock(),
        count=AsyncMock(return_value=5),
        thread=AsyncMock(return_value=None),
        stream=Mock(side_effect=lambda **kwargs: empty_stream()),
        get_state=get_state,
    )
    for target, name, replacement in (
        (Source, "get", b.source),
        (ChatSession, "get", b.session),
        (ChatSession, "save", save_boundary),
        (ChatSession, "relate", b.attach),
        (ChatSession, "delete", b.delete),
        (_chat_shared, "repo_query", b.bound),
        (route, "repo_query", b.list_reads),
        (route, "get_session_message_count", b.count),
        (route, "stream_source_chat_response", b.stream),
        (
            route,
            "asyncio",
            SimpleNamespace(to_thread=b.thread, get_event_loop=asyncio.get_event_loop),
        ),
    ):
        monkeypatch.setattr(target, name, replacement)
    return b


@pytest.mark.parametrize("source", ["page", SOURCE])
async def test_creation_attaches_to_selected_source_and_returns_matching_context(
    io: Boundaries, source: str
) -> None:
    item = await io.route.create_source_chat_session(
        io.route.CreateSourceChatSessionRequest(
            source_id=source, title="资料提问", model_override="model:selected"
        ),
        source_id=source,
    )
    assert (
        item.id,
        item.source_id,
        item.title,
        item.model_override,
        item.message_count,
    ) == (SESSION, source, "资料提问", "model:selected", 0)
    io.source.assert_awaited_once_with(SOURCE)
    io.save.assert_awaited_once()
    io.attach.assert_awaited_once_with("refers_to", SOURCE)
    io.stream.assert_not_called()


async def test_relation_list_orders_existing_sessions_and_counts_only_resolved_rows(
    io: Boundaries,
) -> None:
    io.list_reads.side_effect = [
        [
            {"in": RecordID("chat_session", "earlier")},
            {"in": SESSION},
            {"in": "chat_session:gone"},
            {},
        ],
        [{"id": "chat_session:earlier", "title": "Earlier", "created": "2026-06-01"}],
        [
            {
                "id": SESSION,
                "title": None,
                "model_override": "model:stored",
                "created": "2026-06-03",
            }
        ],
        [],
    ]
    io.count.side_effect = [1, 8]
    rows = await io.route.get_source_chat_sessions("page")

    assert [(x.id, x.title, x.message_count, x.source_id) for x in rows] == [
        (SESSION, "Untitled Session", 8, "page"),
        ("chat_session:earlier", "Earlier", 1, "page"),
    ]
    args = io.list_reads.await_args_list
    assert str(args[0].args[1]["source_id"]) == SOURCE
    assert [str(c.args[1]["id"]) for c in args[1:]] == [
        "chat_session:earlier",
        SESSION,
        "chat_session:gone",
    ]
    assert [c.args[1] for c in io.count.await_args_list] == [
        "chat_session:earlier",
        SESSION,
    ]


@pytest.mark.parametrize(
    "indicators",
    [
        None,
        {"sources": [SOURCE]},
        {"sources": [SOURCE], "insights": ["insight:one"], "notes": ["note:one"]},
    ],
)
async def test_history_projects_messages_and_only_the_saved_scope_indicators(
    io: Boundaries,
    indicators: dict[str, list[str]] | None,
) -> None:
    values: dict[str, object] = {
        "messages": [
            HumanMessage(id="q", content="先前问题"),
            AIMessage(id="a", content="先前回答"),
        ]
    }
    if indicators is not None:
        values["context_indicators"] = indicators
    io.thread.return_value = SimpleNamespace(values=values)
    result = await io.route.get_source_chat_session(
        source_id=SOURCE, session_id="history"
    )

    assert (
        result.id == SESSION
        and result.source_id == SOURCE
        and result.message_count == 2
    )
    assert [(m.id, m.type, m.content) for m in result.messages] == [
        ("q", "human", "先前问题"),
        ("a", "ai", "先前回答"),
    ]
    if indicators is None:
        assert result.context_indicators is None
    else:
        assert result.context_indicators.model_dump() == {
            "sources": [],
            "insights": [],
            "notes": [],
            **indicators,
        }
    io.thread.assert_awaited_once_with(
        io.get_state, config={"configurable": {"thread_id": SESSION}}
    )
    io.get_state.assert_not_called()


async def test_linked_session_without_checkpoint_has_empty_history_not_fake_scope(
    io: Boundaries,
) -> None:
    item = await io.route.get_source_chat_session(source_id="page", session_id=SESSION)
    assert (
        item.message_count == 0
        and item.messages == []
        and item.context_indicators is None
    )


@pytest.mark.parametrize("action", ["read", "edit", "delete", "send"])
async def test_source_session_must_be_linked_before_history_or_edits(
    io: Boundaries, action: str
) -> None:
    io.bound.return_value = []
    args = {"source_id": "page", "session_id": "history"}
    with pytest.raises(HTTPException) as caught:
        if action == "read":
            await io.route.get_source_chat_session(**args)
        elif action == "edit":
            await io.route.update_source_chat_session(
                io.route.UpdateSourceChatSessionRequest(title="new"), **args
            )
        elif action == "delete":
            await io.route.delete_source_chat_session(**args)
        else:
            await io.route.send_message_to_source_chat(
                io.route.SendMessageRequest(message="新问题"), **args
            )

    assert (caught.value.status_code, caught.value.detail) == (
        404,
        "Session not found for this source",
    )
    assert io.bound.await_args is not None
    assert {key: str(value) for key, value in io.bound.await_args.args[1].items()} == {
        "source_id": SOURCE,
        "session_id": SESSION,
    }
    io.thread.assert_not_awaited()
    io.save.assert_not_awaited()
    io.delete.assert_not_awaited()
    io.stream.assert_not_called()


@pytest.mark.parametrize(
    ("update", "title", "model"),
    [
        ({}, "Saved source discussion", "model:stored"),
        ({"title": "", "model_override": "model:new"}, "Untitled Session", "model:new"),
        ({"title": "重命名"}, "重命名", "model:stored"),
    ],
)
async def test_edit_returns_saved_source_scope_with_message_count(
    io: Boundaries,
    update: dict[str, str],
    title: str,
    model: str,
) -> None:
    result = await io.route.update_source_chat_session(
        io.route.UpdateSourceChatSessionRequest(**update),
        source_id="page",
        session_id="history",
    )
    assert (
        result.id,
        result.source_id,
        result.title,
        result.model_override,
        result.message_count,
    ) == (
        SESSION,
        "page",
        title,
        model,
        5,
    )
    io.save.assert_awaited_once()
    assert io.count.await_args is not None and io.count.await_args.args[1] == SESSION


@pytest.mark.parametrize("selection", [None, "", "model:request"])
async def test_send_passes_exact_source_and_model_to_stream_without_running_graph(
    io: Boundaries,
    selection: str | None,
) -> None:
    def stream(**kwargs):
        io.save.assert_awaited_once()

        async def fixture():
            yield b"data: synthetic\n\n"

        return fixture()

    io.stream.side_effect = stream
    result = await io.route.send_message_to_source_chat(
        io.route.SendMessageRequest(message="只问这份资料", model_override=selection),
        source_id="page",
        session_id="history",
    )
    assert isinstance(result, StreamingResponse)
    assert result.media_type == "text/event-stream"
    assert result.headers["cache-control"] == "no-cache"
    assert [chunk async for chunk in result.body_iterator] == [b"data: synthetic\n\n"]
    io.stream.assert_called_once_with(
        source_id=SOURCE,
        session_id=SESSION,
        message="只问这份资料",
        model_override=selection or "model:stored",
    )
    io.thread.assert_not_awaited()
    io.get_state.assert_not_called()


async def test_empty_message_never_saves_session_or_constructs_stream(
    io: Boundaries,
) -> None:
    with pytest.raises(HTTPException) as caught:
        await io.route.send_message_to_source_chat(
            io.route.SendMessageRequest(message=""),
            source_id="page",
            session_id="history",
        )
    assert (caught.value.status_code, caught.value.detail) == (
        400,
        "Message content is required",
    )
    io.save.assert_not_awaited()
    io.stream.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [DatabaseOperationError("Synthetic save failure"), asyncio.CancelledError()],
)
async def test_failed_timestamp_write_does_not_report_stream_success(
    io: Boundaries, error: BaseException
) -> None:
    io.save.side_effect = error
    with pytest.raises(type(error)) as caught:
        await io.route.send_message_to_source_chat(
            io.route.SendMessageRequest(message="Question"),
            source_id="page",
            session_id="history",
        )
    assert caught.value is error
    io.stream.assert_not_called()


@pytest.mark.parametrize("action", ["create", "list", "detail", "edit", "delete"])
async def test_missing_source_does_not_read_or_mutate_sessions(
    io: Boundaries, action: str
) -> None:
    io.source.side_effect = NotFoundError("Missing")
    args = {"source_id": "page", "session_id": "history"}
    with pytest.raises(HTTPException) as caught:
        if action == "create":
            await io.route.create_source_chat_session(
                io.route.CreateSourceChatSessionRequest(source_id="page"),
                source_id="page",
            )
        elif action == "list":
            await io.route.get_source_chat_sessions("page")
        elif action == "detail":
            await io.route.get_source_chat_session(**args)
        elif action == "edit":
            await io.route.update_source_chat_session(
                io.route.UpdateSourceChatSessionRequest(), **args
            )
        else:
            await io.route.delete_source_chat_session(**args)
    assert caught.value.status_code == 404
    io.session.assert_not_awaited()
    io.bound.assert_not_awaited()
    io.list_reads.assert_not_awaited()
    io.save.assert_not_awaited()
    io.delete.assert_not_awaited()


async def test_delete_confirms_only_the_linked_session(io: Boundaries) -> None:
    outcome = await io.route.delete_source_chat_session(
        source_id="page", session_id=SESSION
    )
    assert outcome.model_dump() == {
        "success": True,
        "message": "Source chat session deleted successfully",
    }
    io.delete.assert_awaited_once()
    io.thread.assert_not_awaited()
