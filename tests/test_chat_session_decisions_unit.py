"""Direct notebook chat routes with checkpoint bootstrap, storage and graph I/O isolated."""

import asyncio
import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage

from open_notebook.domain.notebook import ChatSession, Notebook
from open_notebook.exceptions import (
    DatabaseOperationError,
    IncompleteGenerationError,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio
CHAT_ID = "chat_session:sample"
NOTEBOOK_ID = "notebook:sample"
USER_MESSAGE_ID = "00000000-0000-0000-0000-000000000001"


@dataclass
class Boundaries:
    route: ModuleType
    notebook_get: AsyncMock
    session_list: AsyncMock
    session_get: AsyncMock
    save: AsyncMock
    relate: AsyncMock
    delete: AsyncMock
    relation: AsyncMock
    count: AsyncMock
    thread: AsyncMock
    context: AsyncMock
    tokens: Mock
    graph_state: Mock


@pytest.fixture
def io(monkeypatch: pytest.MonkeyPatch) -> Boundaries:
    # The real graph creates a SQLite connection on cold import. Load the real
    # route definitions under a private module name with a replacement import;
    # never replace the application's live router or graph module permanently.
    graph_state = Mock(side_effect=AssertionError("no live checkpoint reads"))
    graph = SimpleNamespace(get_state=graph_state)
    fake_graph = ModuleType("open_notebook.graphs.chat")
    fake_graph.__dict__["graph"] = graph
    path = Path(__file__).parents[1] / "api" / "routers" / "chat.py"
    spec = importlib.util.spec_from_file_location(
        "test_isolated_notebook_chat_routes", path
    )
    assert spec is not None and spec.loader is not None
    route = importlib.util.module_from_spec(spec)
    with monkeypatch.context() as imports:
        imports.setitem(sys.modules, fake_graph.__name__, fake_graph)
        spec.loader.exec_module(route)

    session = ChatSession(
        id=CHAT_ID, title="Saved session", model_override="model:prior"
    )
    notebook = Notebook(id=NOTEBOOK_ID, name="Sample", description="")
    count_state = SimpleNamespace(
        values={
            "messages": [
                HumanMessage(id="question", content="问题"),
                AIMessage(id="answer", content="答案"),
            ]
        }
    )

    async def save_id(record: ChatSession) -> None:
        if record.id is None:
            record.id = CHAT_ID

    save = AsyncMock(side_effect=save_id)

    async def save_boundary(record: ChatSession) -> None:
        await save(record)

    b = Boundaries(
        route=route,
        notebook_get=AsyncMock(return_value=notebook),
        session_list=AsyncMock(return_value=[session]),
        session_get=AsyncMock(return_value=session),
        save=save,
        relate=AsyncMock(),
        delete=AsyncMock(),
        relation=AsyncMock(return_value=[{"out": NOTEBOOK_ID}]),
        count=AsyncMock(return_value=2),
        thread=AsyncMock(return_value=count_state),
        context=AsyncMock(return_value=({"notes": []}, "合成文字")),
        tokens=Mock(return_value=3),
        graph_state=graph_state,
    )
    for obj, name, value in (
        (Notebook, "get", b.notebook_get),
        (Notebook, "get_chat_sessions", b.session_list),
        (ChatSession, "get", b.session_get),
        (ChatSession, "save", save_boundary),
        (ChatSession, "relate_to_notebook", b.relate),
        (ChatSession, "delete", b.delete),
        (route, "repo_query", b.relation),
        (route, "get_session_message_count", b.count),
        (route, "build_notebook_context", b.context),
        (route, "token_count", b.tokens),
        (route, "uuid4", lambda: UUID(USER_MESSAGE_ID)),
        (
            route,
            "asyncio",
            SimpleNamespace(to_thread=b.thread, get_event_loop=asyncio.get_event_loop),
        ),
    ):
        monkeypatch.setattr(obj, name, value)
    return b


async def test_notebook_list_projects_each_session_count_and_fallback_title(
    io: Boundaries,
) -> None:
    other = ChatSession(id="chat_session:other", title=None)
    io.session_list.return_value.append(other)
    io.count.side_effect = [2, 0]

    results = await io.route.get_sessions(NOTEBOOK_ID)

    assert [
        (x.id, x.title, x.notebook_id, x.message_count, x.model_override)
        for x in results
    ] == [
        (CHAT_ID, "Saved session", NOTEBOOK_ID, 2, "model:prior"),
        ("chat_session:other", "Untitled Session", NOTEBOOK_ID, 0, None),
    ]
    assert [c.args[1] for c in io.count.await_args_list] == [CHAT_ID, other.id]
    io.thread.assert_not_awaited()


@pytest.mark.parametrize("title", ["新的问答", None])
async def test_created_session_returns_new_identity_notebook_and_empty_count(
    io: Boundaries, title: str | None
) -> None:
    result = await io.route.create_session(
        io.route.CreateSessionRequest(
            notebook_id=NOTEBOOK_ID, title=title, model_override="model:selected"
        )
    )
    assert (
        result.id,
        result.notebook_id,
        result.message_count,
        result.model_override,
    ) == (CHAT_ID, NOTEBOOK_ID, 0, "model:selected")
    assert result.title == title if title else result.title.startswith("Chat Session ")
    io.save.assert_awaited_once()
    io.relate.assert_awaited_once_with(NOTEBOOK_ID)


@pytest.mark.parametrize("attached", [True, False])
async def test_detail_restores_messages_and_handles_older_unlinked_session(
    io: Boundaries, attached: bool
) -> None:
    if not attached:
        io.relation.return_value = []
    result = await io.route.get_session("sample")
    assert result.id == CHAT_ID
    assert result.notebook_id == (NOTEBOOK_ID if attached else None)
    assert result.message_count == 2
    assert [(m.id, m.type, m.content) for m in result.messages] == [
        ("question", "human", "问题"),
        ("answer", "ai", "答案"),
    ]
    io.session_get.assert_awaited_once_with(CHAT_ID)
    io.thread.assert_awaited_once_with(
        io.graph_state, config={"configurable": {"thread_id": CHAT_ID}}
    )
    io.graph_state.assert_not_called()


async def test_missing_checkpoint_is_empty_not_an_error(io: Boundaries) -> None:
    io.thread.return_value = None
    result = await io.route.get_session(CHAT_ID)
    assert result.id == CHAT_ID and result.message_count == 0 and result.messages == []


@pytest.mark.parametrize(
    ("patch", "title", "override"),
    [
        ({}, "Saved session", "model:prior"),
        ({"title": "重命名"}, "重命名", "model:prior"),
        ({"title": None, "model_override": None}, "", None),
    ],
)
async def test_session_edit_distinguishes_omission_and_clear(
    io: Boundaries, patch: dict[str, str | None], title: str, override: str | None
) -> None:
    result = await io.route.update_session(
        "sample", io.route.UpdateSessionRequest(**patch)
    )
    assert (
        result.id,
        result.title,
        result.model_override,
        result.notebook_id,
        result.message_count,
    ) == (CHAT_ID, title, override, NOTEBOOK_ID, 2)
    io.save.assert_awaited_once()
    io.thread.assert_not_awaited()


@pytest.mark.parametrize("entry", ["get", "update", "delete", "execute"])
async def test_missing_session_stops_before_history_or_save(
    io: Boundaries, entry: str
) -> None:
    io.session_get.side_effect = NotFoundError("Missing")
    with pytest.raises(HTTPException) as caught:
        if entry == "get":
            await io.route.get_session("sample")
        elif entry == "update":
            await io.route.update_session("sample", io.route.UpdateSessionRequest())
        elif entry == "delete":
            await io.route.delete_session("sample")
        else:
            await io.route.execute_chat(
                io.route.ExecuteChatRequest(
                    session_id="sample", message="Question", context={}
                )
            )
    assert (caught.value.status_code, caught.value.detail) == (404, "Session not found")
    io.thread.assert_not_awaited()
    io.relation.assert_not_awaited()
    io.save.assert_not_awaited()


@pytest.mark.parametrize("entry", ["list", "create", "context"])
async def test_missing_notebook_stops_before_loading_sessions_or_building_scope(
    io: Boundaries, entry: str
) -> None:
    io.notebook_get.return_value = None
    with pytest.raises(HTTPException) as caught:
        if entry == "list":
            await io.route.get_sessions(NOTEBOOK_ID)
        elif entry == "create":
            await io.route.create_session(
                io.route.CreateSessionRequest(notebook_id=NOTEBOOK_ID)
            )
        else:
            await io.route.build_context(
                io.route.BuildContextRequest(notebook_id=NOTEBOOK_ID, context_config={})
            )
    assert (caught.value.status_code, caught.value.detail) == (
        404,
        "Notebook not found",
    )
    io.session_list.assert_not_awaited()
    io.context.assert_not_awaited()
    io.save.assert_not_awaited()


@pytest.mark.parametrize("selection", [None, "model:override"])
@pytest.mark.parametrize("attached", [False, True])
async def test_chat_turn_forwards_scope_and_model_and_projects_saved_messages(
    io: Boundaries, selection: str | None, attached: bool
) -> None:
    if not attached:
        io.relation.return_value = []
    answer = AIMessage(id="a-new", content="根据选择资料的回答")
    expected_model = selection if selection is not None else "model:prior"
    scope = {"sources": [{"id": "source:included"}], "notes": []}
    history = HumanMessage(id="q-old", content="上次的问题")

    async def dispatch(fn, *args, **kwargs):
        if fn is io.graph_state:
            assert kwargs == {"config": {"configurable": {"thread_id": CHAT_ID}}}
            return SimpleNamespace(values={"messages": [history]}) if attached else None
        assert fn is io.route.invoke_chat_turn
        _, state, config, question = args
        assert config == {
            "configurable": {"thread_id": CHAT_ID, "model_id": expected_model}
        }
        assert state["notebook"] is (io.notebook_get.return_value if attached else None)
        assert state["context"] == scope and state["model_override"] == expected_model
        assert question.id == USER_MESSAGE_ID and question.content == "本次问题"
        assert state["messages"] == ([history, question] if attached else [question])
        io.save.assert_not_awaited()
        return {"messages": [*state["messages"], answer]}

    io.thread.side_effect = dispatch
    result = await io.route.execute_chat(
        io.route.ExecuteChatRequest(
            session_id="sample",
            context=scope,
            model_override=selection,
            message="本次问题",
        )
    )

    assert result.session_id == "sample"
    assert [m.id for m in result.messages] == (["q-old"] if attached else []) + [
        USER_MESSAGE_ID,
        "a-new",
    ]
    assert result.messages[-1].content == "根据选择资料的回答"
    assert io.notebook_get.await_count == int(attached)
    assert io.thread.await_count == 2
    io.save.assert_awaited_once()


@pytest.mark.parametrize(
    "error", [IncompleteGenerationError("Empty reply"), asyncio.CancelledError()]
)
async def test_turn_failure_preserves_identity_without_touching_session_timestamp(
    io: Boundaries, error: BaseException
) -> None:
    io.thread.side_effect = [None, error]
    with pytest.raises(type(error)) as caught:
        await io.route.execute_chat(
            io.route.ExecuteChatRequest(
                session_id="sample", context={}, message="Question"
            )
        )
    assert caught.value is error
    assert io.thread.await_count == 2
    io.save.assert_not_awaited()


@pytest.mark.parametrize("content", ["", "合成文字"])
async def test_context_estimates_only_nonempty_supplied_content(
    io: Boundaries, content: str
) -> None:
    selection = {"sources": {"source:included": "full content"}}
    read = {"sources": [{"id": "source:included"}]}
    io.context.return_value = read, content
    result = await io.route.build_context(
        io.route.BuildContextRequest(notebook_id=NOTEBOOK_ID, context_config=selection)
    )
    assert (result.context, result.char_count, result.token_count) == (
        read,
        len(content),
        3 if content else 0,
    )
    io.context.assert_awaited_once_with(io.notebook_get.return_value, selection)
    assert io.tokens.call_count == int(bool(content))


async def test_delete_returns_confirmation_only_on_success(io: Boundaries) -> None:
    result = await io.route.delete_session("sample")
    assert result.model_dump() == {
        "success": True,
        "message": "Session deleted successfully",
    }
    io.delete.assert_awaited_once()
    io.thread.assert_not_awaited()


async def test_delete_keeps_typed_storage_error(io: Boundaries) -> None:
    error = DatabaseOperationError("Synthetic deletion failure")
    io.delete.side_effect = error
    with pytest.raises(DatabaseOperationError) as caught:
        await io.route.delete_session("sample")
    assert caught.value is error
