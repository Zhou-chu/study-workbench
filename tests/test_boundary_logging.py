"""Synthetic payloads must not escape the explicitly selected shared boundaries."""

import json
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from loguru import logger
from pydantic import ValidationError

from open_notebook.ai.models import Model
from open_notebook.database import repository
from open_notebook.domain import base, notebook
from open_notebook.exceptions import DatabaseOperationError

PAYLOAD = (
    "host=synthetic.private token=secret-token /private/document.txt document-body"
)
PRIVATE_ID = "private-identity-sentinel"


@pytest.fixture
def logs():
    messages: list[str] = []
    # Real Loguru output, including exception rendering and every existing level.
    sink = logger.add(
        messages.append, level="TRACE", serialize=True, diagnose=True, backtrace=True
    )
    try:
        yield messages
    finally:
        logger.remove(sink)


def assert_metadata_only(logs, operation, exception_type, level):
    output = "".join(logs)
    for forbidden in (
        PAYLOAD,
        PRIVATE_ID,
        "synthetic.private",
        "secret-token",
        "/private/document.txt",
        "document-body",
        "Traceback",
        "input_value",
    ):
        assert forbidden not in output
    records = [json.loads(message)["record"] for message in logs]
    assert records
    assert all(record["exception"] is None for record in records)
    assert any(
        record["message"]
        == f"Boundary operation failed: operation={operation} exception_type={exception_type}"
        and record["level"]["name"] == level
        for record in records
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation,error,level",
    [
        ("query", RuntimeError(PAYLOAD), "DEBUG"),
        ("query", OSError(PAYLOAD), "ERROR"),
        ("query", PAYLOAD, "DEBUG"),
        ("create", RuntimeError(PAYLOAD), "ERROR"),
        ("create", OSError(PAYLOAD), "ERROR"),
        ("delete", OSError(PAYLOAD), "ERROR"),
        ("insert", RuntimeError("transaction conflict " + PAYLOAD), "DEBUG"),
        ("insert", RuntimeError(PAYLOAD), "ERROR"),
        ("insert", OSError(PAYLOAD), "ERROR"),
    ],
)
async def test_repository_boundary_logs_exclude_exception_payload(
    monkeypatch, logs, operation, error, level
):
    class Connection:
        closed = False

        async def signin(self, credentials):
            pass

        async def use(self, namespace, database):
            pass

        async def close(self):
            self.closed = True

        async def fail(self, *args):
            if isinstance(error, str):
                return error
            raise error from ValueError(PAYLOAD)

        query = insert = delete = fail

    connection = Connection()
    monkeypatch.setattr(repository, "AsyncSurreal", lambda _: connection)
    actions = {
        "query": lambda: repository.repo_query("SELECT " + PAYLOAD, {"value": PAYLOAD}),
        "create": lambda: repository.repo_create("source", {"content": PAYLOAD}),
        "delete": lambda: repository.repo_delete("source:" + PRIVATE_ID),
        "insert": lambda: repository.repo_insert("source", [{"content": PAYLOAD}]),
    }
    with pytest.raises((RuntimeError, OSError)) as caught:
        await actions[operation]()

    assert connection.closed
    if not isinstance(error, str):
        if operation == "delete" or (
            operation in {"create", "insert"} and not isinstance(error, RuntimeError)
        ):
            assert type(caught.value) is RuntimeError
            assert caught.value.__cause__ is error
        else:
            assert caught.value is error
    assert_metadata_only(
        logs,
        "repo_" + operation,
        "RuntimeError" if isinstance(error, str) else type(error).__name__,
        level,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["get", "get_all", "save", "delete", "relate"])
async def test_domain_boundary_logs_exclude_exception_payload(
    monkeypatch, logs, operation
):
    error = OSError(PAYLOAD)

    async def fail(*args, **kwargs):
        raise error from ValueError(PAYLOAD)

    for method in ("repo_query", "repo_update", "repo_delete", "repo_relate"):
        monkeypatch.setattr(base, method, fail)
    identity = "model:" + PRIVATE_ID
    item = Model(id=identity, name=PAYLOAD, provider="synthetic", type="language")
    actions: dict[str, Callable[[], Awaitable[Any]]] = {
        "get": lambda: Model.get(identity),
        "get_all": Model.get_all,
        "save": item.save,
        "delete": item.delete,
        "relate": lambda: item.relate("reference", "notebook:" + PRIVATE_ID),
    }
    with pytest.raises(DatabaseOperationError) as caught:
        await actions[operation]()

    assert caught.value.__cause__ is error
    assert_metadata_only(logs, "object_" + operation, "OSError", "ERROR")


@pytest.mark.asyncio
async def test_domain_validation_logs_do_not_render_model_input(monkeypatch, logs):
    async def invalid_rows(*args, **kwargs):
        return [{"id": "source:" + PRIVATE_ID, "topics": PAYLOAD}]

    monkeypatch.setattr(base, "repo_query", invalid_rows)
    assert await notebook.Source.get_all() == []
    assert_metadata_only(
        logs, "object_get_all_validation", "ValidationError", "CRITICAL"
    )


@pytest.mark.asyncio
async def test_save_validation_logs_do_not_render_model_input(logs):
    # Deliberately incomplete persisted model; save must still validate it.
    item = Model.model_construct(  # type: ignore[call-arg]
        id="model:" + PRIVATE_ID, name=PAYLOAD, type="language"
    )
    with pytest.raises(ValidationError):
        await item.save()
    assert_metadata_only(logs, "object_save_validation", "ValidationError", "ERROR")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    ["sources", "notes", "insights", "source_insights", "status", "progress"],
)
async def test_notebook_boundary_logs_exclude_exception_payload(
    monkeypatch, logs, operation
):
    error = OSError(PAYLOAD)

    async def fail(*args, **kwargs):
        raise error from ValueError(PAYLOAD)

    monkeypatch.setattr(notebook, "repo_query", fail)
    monkeypatch.setattr("surreal_commands.get_command_status", fail)
    workspace = notebook.Notebook(
        id="notebook:" + PRIVATE_ID, name=PAYLOAD, description=""
    )
    source_id = "source:" + PRIVATE_ID
    source = notebook.Source(id=source_id, command="command:" + PRIVATE_ID)
    actions: dict[str, Callable[[], Awaitable[Any]]] = {
        "sources": workspace.get_sources,
        "notes": workspace.get_notes,
        "insights": lambda: notebook.SourceInsight.get_for_sources([source_id]),
        "source_insights": source.get_insights,
        "status": source.get_status,
        "progress": source.get_processing_progress,
    }
    if operation == "status":
        assert await actions[operation]() == "unknown"
    elif operation == "progress":
        assert await actions[operation]() == {
            "status": "unknown",
            "owner_phase": None,
            "submission_unknown": True,
        }
    else:
        with pytest.raises(DatabaseOperationError) as caught:
            await actions[operation]()
        assert caught.value.__cause__ is error
    assert_metadata_only(
        logs,
        "notebook_" + operation,
        "OSError",
        "WARNING" if operation in {"status", "progress"} else "ERROR",
    )


@pytest.mark.parametrize(
    "operation,level",
    [(PAYLOAD, "ERROR"), ("repo_query", PAYLOAD), ([], "ERROR"), ("repo_query", {})],
)
def test_boundary_helper_rejects_untrusted_metadata(logs, operation, level):
    from open_notebook.utils.boundary_logging import log_boundary_failure

    log_boundary_failure(operation, ValueError(PAYLOAD), level=level)
    assert_metadata_only(
        logs,
        "repo_query" if operation == "repo_query" else "unknown",
        "ValueError",
        "ERROR",
    )


@pytest.mark.parametrize("name", ["Error\n" + PAYLOAD, "éError", "E" * 81])
def test_boundary_helper_bounds_exception_type_name(logs, name):
    from open_notebook.utils.boundary_logging import log_boundary_failure

    error_class = type(name, (Exception,), {})
    log_boundary_failure("repo_query", error_class(PAYLOAD))
    assert_metadata_only(logs, "repo_query", "UnknownError", "ERROR")


def test_boundary_helper_does_not_call_exception_renderers(logs):
    from open_notebook.utils.boundary_logging import log_boundary_failure

    class UnprintableError(Exception):
        def __str__(self):
            raise AssertionError("Exception text must not be inspected")

        def __repr__(self):
            raise AssertionError("Exception repr must not be inspected")

    try:
        raise UnprintableError(PAYLOAD) from ValueError(PAYLOAD)
    except UnprintableError as error:
        log_boundary_failure("repo_query", error)
    assert_metadata_only(logs, "repo_query", "UnprintableError", "ERROR")


@pytest.mark.asyncio
async def test_save_keeps_transaction_runtime_error_identity(monkeypatch, logs):
    error = RuntimeError("transaction conflict " + PAYLOAD)

    async def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(base, "repo_update", fail)
    item = Model(
        id="model:" + PRIVATE_ID, name=PAYLOAD, provider="synthetic", type="language"
    )
    with pytest.raises(RuntimeError) as caught:
        await item.save()
    assert caught.value is error
    assert PRIVATE_ID not in "".join(logs)
    assert PAYLOAD not in "".join(logs)
    assert [json.loads(message)["record"]["level"]["name"] for message in logs] == [
        "DEBUG"
    ]
