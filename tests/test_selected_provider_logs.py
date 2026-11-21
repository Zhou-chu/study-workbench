"""Real selected failure paths keep logs narrow without changing their contracts."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger

from api.routers import search, source_chat
from open_notebook.ai.models import Model, ModelManager
from open_notebook.exceptions import (
    CommandSubmissionUnknownError,
    ConfigurationError,
)
from open_notebook.utils.graph_utils import (
    discard_unanswered_message,
    invoke_chat_turn,
)

TOKEN = "synthetic-secret-token"
PATH = "/private/synthetic-document.txt"
DOCUMENT = "synthetic-document-body"
MODEL_ID = "model:synthetic-model-identity"
THREAD_ID = "chat_session:synthetic-thread-identity"
MESSAGE_ID = "synthetic-message-identity"
SOURCE_ID = "source:synthetic-source-identity"
PAYLOAD = f"{TOKEN} {PATH} {DOCUMENT} {MODEL_ID} {THREAD_ID} {MESSAGE_ID}"
FALLBACK_MESSAGE = (
    "The AI service could not complete the request. Please try again later."
)


@pytest.fixture(params=["", "x" * 4096], ids=["short", "long"])
def payload(request):
    return PAYLOAD + request.param


@pytest.fixture
def logs():
    messages: list[str] = []
    sink = logger.add(
        messages.append, level="TRACE", serialize=True, diagnose=True, backtrace=True
    )
    try:
        yield messages
    finally:
        logger.remove(sink)


def _assert_selected_log(logs, operation, exception_type):
    # Inspect the complete serialized sink, not only record["message"]. Traceback
    # rendering can otherwise leak the original error through cause/context/locals.
    output = "".join(logs)
    for forbidden in (
        TOKEN,
        PATH,
        DOCUMENT,
        MODEL_ID,
        THREAD_ID,
        MESSAGE_ID,
        SOURCE_ID,
        "Traceback",
        "During handling of the above exception",
        "The above exception was the direct cause",
    ):
        assert forbidden not in output
    records = [json.loads(message)["record"] for message in logs]
    selected = [record for record in records if record["level"]["name"] == "ERROR"]
    assert len(selected) == 1
    assert selected[0]["message"] == (
        f"Boundary operation failed: operation={operation} "
        f"exception_type={exception_type}"
    )
    assert selected[0]["exception"] is None


def _failure(kind, payload):
    error: Exception
    if kind == "typed":
        error = ConfigurationError(payload)
    elif kind == "receipt":
        error = CommandSubmissionUnknownError(
            source_id=SOURCE_ID, command_id="command:" + MESSAGE_ID
        )
    else:
        error = RuntimeError(payload)
    # Both chains are genuine caught exceptions; Loguru backtrace/diagnose must
    # not render either one, even with sensitive locals in these stack frames.
    try:
        raise ValueError(payload)
    except ValueError as cause:
        try:
            raise LookupError(payload)
        except LookupError:
            try:
                raise error from cause
            except Exception:
                return error


async def _events(generator):
    events = []
    async for chunk in generator:
        assert chunk.startswith("data: ") and chunk.endswith("\n\n")
        events.append(json.loads(chunk[len("data: ") : -2]))
    return events


def _assert_error_unchanged(error, cause, context):
    assert error.__cause__ is cause
    assert error.__context__ is context
    if isinstance(error, CommandSubmissionUnknownError):
        assert error.source_id == SOURCE_ID
        assert error.command_id == "command:" + MESSAGE_ID
        assert error.resource_id == SOURCE_ID
        assert error.resource_type == "source"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["raw", "typed", "receipt"])
@pytest.mark.parametrize("partial", [False, True], ids=["before-output", "partial"])
async def test_ask_failure_logs_only_metadata_and_keeps_terminal_events(
    monkeypatch, logs, payload, kind, partial
):
    error = _failure(kind, payload)
    cause, context = error.__cause__, error.__context__
    calls = []

    async def stream(**kwargs):
        calls.append(kwargs)
        if partial:
            yield {
                "agent": {
                    "strategy": SimpleNamespace(
                        reasoning="public reasoning",
                        searches=[SimpleNamespace(term="public", instructions="find")],
                    )
                }
            }
            yield {"provide_answer": {"answers": ["partial answer"]}}
            yield {"write_final_answer": {"final_answer": "partial final"}}
        raise error

    monkeypatch.setattr(search, "ask_graph", SimpleNamespace(astream=stream))
    model = Model(id=MODEL_ID, name=DOCUMENT, provider="synthetic", type="language")
    events = await _events(
        search.stream_ask_response(payload, model, model, model, [SOURCE_ID])
    )
    expected = (
        [
            {
                "type": "strategy",
                "reasoning": "public reasoning",
                "searches": [{"term": "public", "instructions": "find"}],
            },
            {"type": "answer", "content": "partial answer"},
            {"type": "final_answer", "content": "partial final"},
        ]
        if partial
        else []
    )
    expected.append(
        {"type": "error", "message": FALLBACK_MESSAGE if kind == "raw" else str(error)}
    )
    assert events == expected  # Exactly one error; never a completion after failure.
    assert calls == [
        {
            "input": {"question": payload, "notebook_ids": [SOURCE_ID]},
            "config": {
                "configurable": {
                    "strategy_model": MODEL_ID,
                    "answer_model": MODEL_ID,
                    "final_answer_model": MODEL_ID,
                }
            },
            "stream_mode": "updates",
        }
    ]
    _assert_error_unchanged(error, cause, context)
    _assert_selected_log(logs, "ask_stream", type(error).__name__)


class _FailingChatGraph:
    """Synthetic checkpoint/provider seams; invocation and rollback stay real."""

    def __init__(self, error, *, fail_initial=False, cleanup=None):
        self.error = error
        self.fail_initial = fail_initial
        self.cleanup = cleanup
        self.cleanup_error = OSError(PAYLOAD)
        self.calls = []
        self.messages = [
            HumanMessage(content="earlier question", id="earlier-human"),
            AIMessage(content="earlier answer", id="earlier-ai"),
        ]
        self.invoked = False

    def get_state(self, config):
        self.calls.append("get_state")
        assert config == {"configurable": {"thread_id": THREAD_ID}}
        if self.fail_initial:
            raise self.error
        if self.invoked and self.cleanup == "get_state":
            raise self.cleanup_error
        return SimpleNamespace(values={"messages": list(self.messages)})

    def invoke(self, *, input, config):
        self.calls.append("invoke")
        self.invoked = True
        self.input = input
        self.config = config
        self.messages = list(input["messages"])
        raise self.error

    def update_state(self, config, update):
        self.calls.append("update_state")
        assert config == {"configurable": {"thread_id": THREAD_ID}}
        (remove,) = update["messages"]
        assert isinstance(remove, RemoveMessage)
        assert remove.id == self.messages[-1].id
        if self.cleanup == "update_state":
            raise self.cleanup_error
        self.messages = [
            message for message in self.messages if message.id != remove.id
        ]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["raw", "typed", "receipt"])
@pytest.mark.parametrize("partial", [False, True], ids=["before-output", "partial"])
async def test_source_chat_failure_logs_only_metadata_and_keeps_terminal_events(
    monkeypatch, logs, payload, kind, partial
):
    error = _failure(kind, payload)
    cause, context = error.__cause__, error.__context__
    graph = _FailingChatGraph(error, fail_initial=not partial)
    monkeypatch.setattr(source_chat, "source_chat_graph", graph)
    monkeypatch.setattr(source_chat, "uuid4", lambda: MESSAGE_ID)
    events = await _events(
        source_chat.stream_source_chat_response(THREAD_ID, SOURCE_ID, payload, MODEL_ID)
    )
    expected = (
        [{"type": "user_message", "content": payload, "timestamp": None}]
        if partial
        else []
    )
    expected.append(
        {"type": "error", "message": FALLBACK_MESSAGE if kind == "raw" else str(error)}
    )
    assert events == expected
    assert graph.calls == (
        ["get_state", "invoke", "get_state", "update_state"]
        if partial
        else ["get_state"]
    )
    if partial:
        assert graph.input["source_id"] == SOURCE_ID
        assert graph.input["model_override"] == MODEL_ID
        assert graph.input["messages"][-1] == HumanMessage(
            content=payload, id=MESSAGE_ID
        )
        assert graph.config == {
            "configurable": {"thread_id": THREAD_ID, "model_id": MODEL_ID}
        }
    assert [message.id for message in graph.messages] == ["earlier-human", "earlier-ai"]
    _assert_error_unchanged(error, cause, context)
    _assert_selected_log(logs, "source_chat_stream", type(error).__name__)


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [ValueError, ConfigurationError])
@pytest.mark.parametrize(
    "model_type,field",
    [
        ("chat", "default_chat_model"),
        ("transformation", "default_chat_model"),
        ("tools", "default_chat_model"),
        ("embedding", "default_embedding_model"),
        ("text_to_speech", "default_text_to_speech_model"),
        ("speech_to_text", "default_speech_to_text_model"),
        ("large_context", "default_chat_model"),
    ],
)
async def test_default_model_failure_logs_only_metadata_and_returns_none_once(
    monkeypatch, logs, payload, error_type, model_type, field
):
    manager = ModelManager()
    defaults = SimpleNamespace(
        default_chat_model=MODEL_ID,
        default_transformation_model=None,
        default_tools_model=None,
        default_embedding_model=MODEL_ID + "-embedding",
        default_text_to_speech_model=MODEL_ID + "-tts",
        default_speech_to_text_model=MODEL_ID + "-stt",
        large_context_model=None,
    )
    calls: list[object] = []
    error = error_type(payload)
    cause = ValueError(payload)

    async def get_defaults():
        calls.append("defaults")
        return defaults

    async def get_model(model_id, **kwargs):
        calls.append((model_id, kwargs))
        raise error from cause

    monkeypatch.setattr(manager, "get_defaults", get_defaults)
    monkeypatch.setattr(manager, "get_model", get_model)
    assert await manager.get_default_model(model_type, private_option=payload) is None
    assert calls == [
        "defaults",
        (getattr(defaults, field), {"private_option": payload}),
    ]
    assert error.__cause__ is cause
    _assert_selected_log(logs, "default_model_load", error_type.__name__)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_at", ["defaults", "model"])
@pytest.mark.parametrize("error_type", [OSError, asyncio.CancelledError])
async def test_default_model_does_not_broaden_catches(
    monkeypatch, logs, failure_at, error_type
):
    manager = ModelManager()
    error = error_type(PAYLOAD)
    calls = []

    async def get_defaults():
        calls.append("defaults")
        if failure_at == "defaults":
            raise error
        return SimpleNamespace(default_chat_model=MODEL_ID)

    async def get_model(model_id, **kwargs):
        calls.append("model")
        raise error

    monkeypatch.setattr(manager, "get_defaults", get_defaults)
    monkeypatch.setattr(manager, "get_model", get_model)
    with pytest.raises(error_type) as caught:
        await manager.get_default_model("chat")
    assert caught.value is error
    assert calls == (
        ["defaults"] if failure_at == "defaults" else ["defaults", "model"]
    )
    assert logs == []


@pytest.mark.parametrize("kind", ["raw", "receipt"])
@pytest.mark.parametrize("cleanup", ["get_state", "update_state"])
def test_failed_rollback_logs_only_metadata_and_preserves_original_error(
    logs, payload, kind, cleanup
):
    error = _failure(kind, payload)
    cause, context = error.__cause__, error.__context__
    graph = _FailingChatGraph(error, cleanup=cleanup)
    graph.cleanup_error = OSError(payload)
    message = HumanMessage(content=payload, id=MESSAGE_ID)
    state = {"messages": [*graph.messages, message]}
    config = RunnableConfig(configurable={"thread_id": THREAD_ID, "model_id": MODEL_ID})
    with pytest.raises(type(error)) as caught:
        invoke_chat_turn(graph, state, config, message)
    assert caught.value is error
    _assert_error_unchanged(error, cause, context)
    assert graph.cleanup_error.__context__ is error
    assert graph.calls == (
        ["invoke", "get_state"]
        if cleanup == "get_state"
        else ["invoke", "get_state", "update_state"]
    )
    assert graph.input is state and graph.config is config
    assert graph.messages[-1] is message
    _assert_selected_log(logs, "discard_unanswered_message", "OSError")


@pytest.mark.parametrize("no_op", [None, "no-thread", "no-message-id", "not-stored"])
def test_rollback_keeps_order_prior_turns_and_no_op_behavior(logs, no_op):
    error = _failure("raw", PAYLOAD)
    graph = _FailingChatGraph(error)
    message = HumanMessage(
        content=PAYLOAD, id=None if no_op == "no-message-id" else MESSAGE_ID
    )
    previous = list(graph.messages)
    state = {"messages": [*previous, message] if no_op != "not-stored" else previous}
    config = RunnableConfig(
        configurable={} if no_op == "no-thread" else {"thread_id": THREAD_ID}
    )
    with pytest.raises(RuntimeError) as caught:
        invoke_chat_turn(graph, state, config, message)
    assert caught.value is error
    if no_op in {"no-thread", "no-message-id"}:
        assert graph.calls == ["invoke"]
        assert graph.messages == state["messages"]
    else:
        assert graph.calls == (
            ["invoke", "get_state"]
            if no_op == "not-stored"
            else ["invoke", "get_state", "update_state"]
        )
        assert graph.messages == previous
    assert logs == []


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["ask", "source-before", "source-partial"])
async def test_stream_cancellation_propagates_without_failure_event(
    monkeypatch, logs, operation
):
    error = asyncio.CancelledError(PAYLOAD)
    emitted = []
    if operation == "ask":

        async def stream(**kwargs):
            raise error
            yield  # Make the synthetic external seam an async generator.

        monkeypatch.setattr(search, "ask_graph", SimpleNamespace(astream=stream))
        model = Model(id=MODEL_ID, name=DOCUMENT, provider="synthetic", type="language")
        generator = search.stream_ask_response(PAYLOAD, model, model, model, [])
    else:
        graph = _FailingChatGraph(error, fail_initial=operation == "source-before")
        monkeypatch.setattr(source_chat, "source_chat_graph", graph)
        generator = source_chat.stream_source_chat_response(
            THREAD_ID, SOURCE_ID, PAYLOAD
        )
    with pytest.raises(asyncio.CancelledError) as caught:
        async for chunk in generator:
            emitted.append(json.loads(chunk[len("data: ") :]))
    assert caught.value is error
    assert emitted == (
        [{"type": "user_message", "content": PAYLOAD, "timestamp": None}]
        if operation == "source-partial"
        else []
    )
    if operation != "ask":
        assert graph.calls == (
            ["get_state", "invoke"] if operation == "source-partial" else ["get_state"]
        )
    assert logs == []


def test_cleanup_cancellation_is_not_swallowed(logs):
    error = asyncio.CancelledError(PAYLOAD)
    graph = _FailingChatGraph(error, fail_initial=True)
    with pytest.raises(asyncio.CancelledError) as caught:
        discard_unanswered_message(
            graph, THREAD_ID, HumanMessage(content=PAYLOAD, id=MESSAGE_ID)
        )
    assert caught.value is error
    assert graph.calls == ["get_state"]
    assert logs == []
