"""Notebook collection decisions, isolated at the persistence boundary."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.models import NotebookUpdate
from api.routers import notebooks
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

pytestmark = pytest.mark.asyncio


@pytest.fixture
def query(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    query = AsyncMock(return_value=[])
    monkeypatch.setattr(notebooks, "repo_query", query)
    return query


async def test_unarchived_listing_keeps_records_with_unset_archive_flag(
    query: AsyncMock,
) -> None:
    query.return_value = [
        {"id": "notebook:legacy", "name": "Unset archive flag"},
        {"id": "notebook:active", "name": "Active", "archived": False},
        {"id": "notebook:archived", "name": "Archived", "archived": True},
    ]

    result = await notebooks.get_notebooks(archived=False, order_by="updated desc")

    assert [(item.id, item.archived) for item in result] == [
        ("notebook:legacy", False),
        ("notebook:active", False),
    ]


@pytest.mark.parametrize(
    ("archived", "ids"),
    [
        (None, ["notebook:legacy", "notebook:archived"]),
        (True, ["notebook:archived"]),
    ],
)
async def test_collection_archive_filter_preserves_database_order(
    query: AsyncMock, archived: bool | None, ids: list[str]
) -> None:
    query.return_value = [
        {"id": "notebook:legacy", "name": "First"},
        {"id": "notebook:archived", "name": "Second", "archived": True},
    ]

    result = await notebooks.get_notebooks(archived=archived, order_by="name")

    assert [item.id for item in result] == ids


async def test_collection_preserves_name_description_and_counts(
    query: AsyncMock,
) -> None:
    query.return_value = [
        {
            "id": "notebook:sample",
            "name": "体系结构",
            "description": "Reading group",
            "created": "2026-05-20T11:00:00Z",
            "updated": "2026-05-22T12:00:00Z",
            "source_count": 3,
            "note_count": 5,
        }
    ]

    (item,) = await notebooks.get_notebooks(archived=None, order_by="  Updated  DESC ")

    assert item.model_dump() == {
        "id": "notebook:sample",
        "name": "体系结构",
        "description": "Reading group",
        "archived": False,
        "created": "2026-05-20T11:00:00Z",
        "updated": "2026-05-22T12:00:00Z",
        "source_count": 3,
        "note_count": 5,
    }
    assert query.await_args is not None
    assert query.await_args.args[0].strip().endswith("ORDER BY updated desc")


@pytest.mark.parametrize(
    "order", ["", "name sideways", "description asc", "name, created"]
)
async def test_collection_rejects_sort_outside_collection_contract(
    query: AsyncMock, order: str
) -> None:
    with pytest.raises(InvalidInputError, match="Allowed fields"):
        await notebooks.get_notebooks(archived=None, order_by=order)

    query.assert_not_awaited()


async def test_recent_history_uses_fallback_titles_and_globally_caps_results(
    query: AsyncMock,
) -> None:
    query.side_effect = [
        [
            {
                "id": "notebook:title",
                "title": "Selected title",
                "name": "Old name",
                "last_viewed_at": "2026-05-20T09:00:00Z",
            },
            {
                "id": "notebook:name",
                "title": "",
                "name": "Fallback name",
                "last_viewed_at": "2026-05-20T07:00:00Z",
            },
            {"id": "notebook:untitled", "last_viewed_at": "2026-05-20T06:00:00Z"},
        ],
        [
            {
                "id": "source:untitled",
                "title": "",
                "last_viewed_at": "2026-05-20T10:00:00Z",
            },
            {
                "id": "source:old",
                "title": "Later removed",
                "last_viewed_at": "2026-05-20T05:00:00Z",
            },
        ],
    ]

    result = await notebooks.get_recently_viewed(limit=4)

    assert [(item.type, item.id, item.title) for item in result] == [
        ("source", "source:untitled", "Untitled source"),
        ("notebook", "notebook:title", "Selected title"),
        ("notebook", "notebook:name", "Fallback name"),
        ("notebook", "notebook:untitled", "Untitled notebook"),
    ]
    assert [call.args[1] for call in query.await_args_list] == [
        {"limit": 4},
        {"limit": 4},
    ]


async def test_recent_history_empty_when_both_collections_are_empty(
    query: AsyncMock,
) -> None:
    query.side_effect = [[], []]

    assert await notebooks.get_recently_viewed(limit=3) == []


@pytest.mark.parametrize("operation", ["collection", "recent", "detail"])
@pytest.mark.parametrize("kind", ["typed", "cancelled"])
async def test_collection_reads_preserve_typed_errors_and_cancellation(
    query: AsyncMock, operation: str, kind: str
) -> None:
    error = (
        DatabaseOperationError("Persistence unavailable")
        if kind == "typed"
        else asyncio.CancelledError()
    )
    query.side_effect = error

    with pytest.raises(type(error)) as caught:
        if operation == "collection":
            await notebooks.get_notebooks(archived=None, order_by="name asc")
        elif operation == "recent":
            await notebooks.get_recently_viewed(limit=4)
        else:
            await notebooks.get_notebook("notebook:sample")

    assert caught.value is error


async def test_recent_history_does_not_return_partial_items_when_source_read_fails(
    query: AsyncMock,
) -> None:
    query.side_effect = [
        [{"id": "notebook:sample", "name": "Notebook"}],
        RuntimeError("Synthetic storage internals"),
    ]

    with pytest.raises(HTTPException) as caught:
        await notebooks.get_recently_viewed(limit=4)

    assert caught.value.status_code == 500
    assert caught.value.detail == "Error fetching recently viewed items"
    assert query.await_count == 2


@pytest.mark.parametrize("stamp_failed", [False, True])
async def test_notebook_detail_succeeds_even_if_best_effort_stamp_fails(
    query: AsyncMock, stamp_failed: bool
) -> None:
    query.side_effect = [
        [{"id": "notebook:sample", "name": "Notebook", "source_count": 4}],
        RuntimeError("Synthetic write unavailable") if stamp_failed else [],
    ]

    result = await notebooks.get_notebook("notebook:sample")

    assert (result.id, result.source_count, result.note_count) == (
        "notebook:sample",
        4,
        0,
    )
    read, write = query.await_args_list
    assert str(read.args[1]["notebook_id"]) == "notebook:sample"
    assert str(write.args[1]["notebook_id"]) == "notebook:sample"
    assert "SET last_viewed_at = time::now()" in write.args[0]


async def test_missing_notebook_does_not_stamp_recent_history(query: AsyncMock) -> None:
    with pytest.raises(HTTPException) as caught:
        await notebooks.get_notebook("notebook:missing")

    assert caught.value.status_code == 404
    assert query.await_count == 1


async def test_cancelled_history_stamp_interrupts_detail_instead_of_reporting_success(
    query: AsyncMock,
) -> None:
    cancelled = asyncio.CancelledError()
    query.side_effect = [[{"id": "notebook:sample", "name": "Notebook"}], cancelled]

    with pytest.raises(asyncio.CancelledError) as caught:
        await notebooks.get_notebook("notebook:sample")

    assert caught.value is cancelled
    assert query.await_count == 2


@pytest.fixture
def editable_notebook(monkeypatch: pytest.MonkeyPatch) -> tuple[Notebook, AsyncMock]:
    notebook = Notebook(
        id="notebook:sample",
        name="Previous name",
        description="Previous description",
        archived=True,
    )
    save = AsyncMock()
    monkeypatch.setattr(Notebook, "get", AsyncMock(return_value=notebook))
    monkeypatch.setattr(Notebook, "save", save)
    return notebook, save


@pytest.mark.parametrize(
    ("update", "description"),
    [
        (NotebookUpdate(name="Edited"), "Previous description"),
        (NotebookUpdate(name="Edited", description=""), ""),
        (NotebookUpdate(name="Edited", description=None), ""),
        (NotebookUpdate(name="Edited", description="New notes"), "New notes"),
    ],
)
async def test_notebook_patch_distinguishes_omitted_and_explicit_description(
    query: AsyncMock,
    editable_notebook: tuple[Notebook, AsyncMock],
    update: NotebookUpdate,
    description: str,
) -> None:
    notebook, save = editable_notebook

    result = await notebooks.update_notebook("notebook:sample", update)

    assert notebook.description == result.description == description
    assert result.name == "Edited"
    assert result.archived is True
    assert (result.source_count, result.note_count) == (0, 0)
    save.assert_awaited_once()


async def test_notebook_unarchive_returns_refreshed_counts(
    query: AsyncMock, editable_notebook: tuple[Notebook, AsyncMock]
) -> None:
    notebook, save = editable_notebook
    query.return_value = [
        {
            "id": "notebook:sample",
            "name": "Previous name",
            "description": "Previous description",
            "archived": False,
            "source_count": 8,
            "note_count": 2,
        }
    ]

    result = await notebooks.update_notebook(
        "notebook:sample", NotebookUpdate(archived=False)
    )

    assert notebook.archived is False
    assert (result.archived, result.source_count, result.note_count) == (False, 8, 2)
    save.assert_awaited_once()
