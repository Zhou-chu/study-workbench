"""Navigation and editing decisions with persistence replaced, no ASGI or DB."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.models import NotebookCreate, NotebookUpdate
from api.routers import notebooks as target
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
def query(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    stub = AsyncMock(side_effect=AssertionError("Unexpected repository operation"))
    monkeypatch.setattr(target, "repo_query", stub)
    return stub


async def test_create_projects_real_domain_after_persistence_ack(
    monkeypatch: pytest.MonkeyPatch, query: AsyncMock
) -> None:
    saved: list[Notebook] = []
    stamp = datetime(2026, 11, 15, tzinfo=timezone.utc)

    async def save(item: Notebook) -> None:
        assert item.id is None
        assert (item.name, item.description, item.archived) == (
            "计算机系统",
            "课程资料",
            False,
        )
        saved.append(item)
        item.id = "notebook:created"
        item.created = stamp
        item.updated = stamp

    monkeypatch.setattr(Notebook, "save", save)
    request = NotebookCreate(name="计算机系统", description="课程资料")
    result = await target.create_notebook(request)
    assert len(saved) == 1
    assert result.model_dump() == {
        "id": "notebook:created",
        "name": "计算机系统",
        "description": "课程资料",
        "archived": False,
        "created": str(stamp),
        "updated": str(stamp),
        "source_count": 0,
        "note_count": 0,
    }
    assert request.model_dump() == {"name": "计算机系统", "description": "课程资料"}
    query.assert_not_awaited()


@pytest.mark.parametrize("name", ["", " \t\n"])
async def test_create_domain_rejects_blank_name_before_save(
    monkeypatch: pytest.MonkeyPatch, query: AsyncMock, name: str
) -> None:
    save = AsyncMock()
    monkeypatch.setattr(Notebook, "save", save)
    with pytest.raises(HTTPException) as caught:
        await target.create_notebook(NotebookCreate(name=name))
    assert caught.value.status_code == 400
    save.assert_not_awaited()
    query.assert_not_awaited()


@pytest.mark.parametrize("operation", ["create", "update"])
@pytest.mark.parametrize("kind", ["invalid", "http", "domain", "unknown", "cancel"])
async def test_save_failure_never_refreshes_or_reports_success(
    monkeypatch: pytest.MonkeyPatch, query: AsyncMock, operation: str, kind: str
) -> None:
    errors: dict[str, BaseException] = {
        "invalid": InvalidInputError("Invalid synthetic edit"),
        "http": HTTPException(status_code=409, detail="Synthetic conflict"),
        "domain": DatabaseOperationError("Synthetic storage failure"),
        "unknown": RuntimeError("Synthetic internal failure"),
        "cancel": asyncio.CancelledError(),
    }
    error = errors[kind]
    save = AsyncMock(side_effect=error)
    monkeypatch.setattr(Notebook, "save", save)
    get = AsyncMock(
        return_value=Notebook(id="notebook:one", name="Before", description="Keep")
    )
    monkeypatch.setattr(Notebook, "get", get)
    expected = type(error) if kind in {"domain", "cancel"} else HTTPException
    with pytest.raises(expected) as caught:
        if operation == "create":
            await target.create_notebook(NotebookCreate(name="New"))
        else:
            await target.update_notebook("notebook:one", NotebookUpdate(archived=True))
    if kind in {"http", "domain", "cancel"}:
        assert caught.value is error
    else:
        assert isinstance(caught.value, HTTPException)
        assert caught.value.status_code == (400 if kind == "invalid" else 500)
    save.assert_awaited_once()
    query.assert_not_awaited()
    if operation == "create":
        get.assert_not_awaited()
    else:
        get.assert_awaited_once_with("notebook:one")


@pytest.mark.parametrize("kind", ["missing", "cancel"])
async def test_update_lookup_failure_never_saves(
    monkeypatch: pytest.MonkeyPatch, query: AsyncMock, kind: str
) -> None:
    error = NotFoundError("Missing") if kind == "missing" else asyncio.CancelledError()
    get = AsyncMock(side_effect=error)
    save = AsyncMock()
    monkeypatch.setattr(Notebook, "get", get)
    monkeypatch.setattr(Notebook, "save", save)
    with pytest.raises(
        HTTPException if kind == "missing" else asyncio.CancelledError
    ) as caught:
        await target.update_notebook("notebook:missing", NotebookUpdate(name="New"))
    if kind == "missing":
        assert isinstance(caught.value, HTTPException)
        assert caught.value.status_code == 404
    else:
        assert caught.value is error
    save.assert_not_awaited()
    query.assert_not_awaited()


async def test_archive_ack_precedes_refresh_and_response_uses_persisted_projection(
    monkeypatch: pytest.MonkeyPatch, query: AsyncMock
) -> None:
    item = Notebook(id="notebook:one", name="Unchanged", description="Keep")
    monkeypatch.setattr(Notebook, "get", AsyncMock(return_value=item))
    events: list[str] = []

    async def save(current: Notebook) -> None:
        assert current is item
        assert current.archived is True
        assert (current.name, current.description) == ("Unchanged", "Keep")
        events.append("saved")

    async def read(sql: str, params: dict[str, object]) -> list[dict[str, object]]:
        assert events == ["saved"]
        assert str(params["notebook_id"]) == "notebook:one"
        assert "FROM $notebook_id" in sql
        return [
            {
                "id": "notebook:one",
                "name": "Persisted title",
                "archived": True,
                "source_count": 9,
                "note_count": 4,
            }
        ]

    monkeypatch.setattr(Notebook, "save", save)
    query.side_effect = read
    result = await target.update_notebook("notebook:one", NotebookUpdate(archived=True))
    assert (result.name, result.archived, result.source_count, result.note_count) == (
        "Persisted title",
        True,
        9,
        4,
    )
    query.assert_awaited_once()


@pytest.mark.parametrize("operation", ["list", "detail", "recent"])
@pytest.mark.parametrize("kind", ["http", "unknown"])
async def test_navigation_query_failure_preserves_http_or_returns_server_failure(
    query: AsyncMock, operation: str, kind: str
) -> None:
    error = (
        HTTPException(status_code=503, detail="Synthetic unavailable")
        if kind == "http"
        else RuntimeError("Synthetic private failure")
    )
    query.side_effect = error
    with pytest.raises(HTTPException) as caught:
        if operation == "list":
            await target.get_notebooks(archived=None, order_by="name asc")
        elif operation == "detail":
            await target.get_notebook("notebook:one")
        else:
            await target.get_recently_viewed(limit=3)
    if kind == "http":
        assert caught.value is error
    else:
        assert caught.value.status_code == 500
        if operation == "recent":
            assert "Synthetic private failure" not in caught.value.detail
    query.assert_awaited_once()
