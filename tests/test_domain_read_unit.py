"""Domain read projection and batching with only repository I/O replaced."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from open_notebook.domain import notebook as target
from open_notebook.exceptions import DatabaseOperationError


def notebook():
    return target.Notebook(id="notebook:synthetic", name="Synthetic", description="")


@pytest.mark.asyncio
@pytest.mark.parametrize("include", [False, True])
@pytest.mark.parametrize("kind", ["sources", "notes"])
async def test_full_content_is_explicit_and_query_identity_is_bound(
    monkeypatch, include, kind
):
    key = "source" if kind == "sources" else "note"
    query = AsyncMock(return_value=[{key: {"id": key + ":one", "title": "标题"}}])
    monkeypatch.setattr(target, "repo_query", query)
    getter = getattr(notebook(), "get_" + kind)
    result = await getter(include)
    assert len(result) == 1 and result[0].id == key + ":one"
    assert result[0].title == "标题"
    awaited = query.await_args
    assert awaited is not None
    sql, params = awaited.args
    assert str(params["id"]) == "notebook:synthetic"
    assert "order by " + key + ".updated desc" in sql
    if kind == "sources":
        assert ("omit source.full_text" in sql) is (not include)
    else:
        assert (
            "omit note.embedding" in sql
            if include
            else "omit note.content, note.embedding" in sql
        )
    query.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["get_sources", "get_notes", "get_chat_sessions"])
async def test_empty_collection_is_not_missing_notebook(monkeypatch, method):
    query = AsyncMock(return_value=[])
    monkeypatch.setattr(target, "repo_query", query)
    assert await getattr(notebook(), method)() == []
    query.assert_awaited_once()


@pytest.mark.asyncio
async def test_chat_session_projection_preserves_order(monkeypatch):
    query = AsyncMock(
        return_value=[
            {"chat_session": [{"id": "chat_session:two", "title": "Second"}]},
            {"chat_session": [{"id": "chat_session:one", "title": "First"}]},
        ]
    )
    monkeypatch.setattr(target, "repo_query", query)
    result = await notebook().get_chat_sessions()
    assert [x.id for x in result] == ["chat_session:two", "chat_session:one"]
    awaited = query.await_args
    assert awaited is not None
    assert str(awaited.args[1]["id"]) == "notebook:synthetic"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method", ["get_sources", "get_notes", "get_chat_sessions", "get_delete_preview"]
)
@pytest.mark.parametrize("cancel", [False, True])
async def test_read_error_is_not_empty_success_and_cancel_is_not_wrapped(
    monkeypatch, method, cancel
):
    error = (
        asyncio.CancelledError()
        if cancel
        else RuntimeError("synthetic storage unavailable")
    )
    query = AsyncMock(side_effect=error)
    monkeypatch.setattr(target, "repo_query", query)
    with pytest.raises(asyncio.CancelledError if cancel else DatabaseOperationError):
        await getattr(notebook(), method)()
    query.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "notes,sources,expected",
    [
        ([], [], (0, 0, 0)),
        (
            [{"count": 3}],
            [{"assigned_others": 0}, {}, {"assigned_others": 2}],
            (3, 2, 1),
        ),
    ],
)
async def test_delete_preview_counts_without_mutation(
    monkeypatch, notes, sources, expected
):
    query = AsyncMock(side_effect=[notes, sources])
    monkeypatch.setattr(target, "repo_query", query)
    result = await notebook().get_delete_preview()
    assert result == dict(
        zip(["note_count", "exclusive_source_count", "shared_source_count"], expected)
    )
    assert query.await_count == 2
    for call in query.await_args_list:
        sql, params = call.args
        assert sql.lstrip().upper().startswith("SELECT")
        assert str(params["notebook_id"]) == "notebook:synthetic"


@pytest.mark.asyncio
async def test_batch_insights_deduplicates_ids_and_preserves_empty_buckets(monkeypatch):
    query = AsyncMock(
        return_value=[
            {
                "id": "source_insight:one",
                "source": "source:a",
                "insight_type": "summary",
                "content": "第一条",
            },
            {
                "id": "source_insight:two",
                "source": "source:a",
                "insight_type": "quote",
                "content": "第二条",
            },
        ]
    )
    monkeypatch.setattr(target, "repo_query", query)
    result = await target.SourceInsight.get_for_sources(
        ["source:a", "", "source:b", "source:a"]
    )
    assert list(result) == ["source:a", "source:b"]
    assert [x.content for x in result["source:a"]] == ["第一条", "第二条"]
    assert result["source:b"] == []
    query.assert_awaited_once()
    awaited = query.await_args
    assert awaited is not None
    assert [str(x) for x in awaited.args[1]["source_ids"]] == [
        "source:a",
        "source:b",
    ]


@pytest.mark.asyncio
async def test_empty_batch_never_queries(monkeypatch):
    query = AsyncMock(side_effect=AssertionError("query forbidden"))
    monkeypatch.setattr(target, "repo_query", query)
    assert await target.SourceInsight.get_for_sources(["", ""]) == {}
    query.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_failure_is_sanitized_and_cancel_propagates(monkeypatch):
    error = RuntimeError("synthetic private backend detail")
    query = AsyncMock(side_effect=error)
    monkeypatch.setattr(target, "repo_query", query)
    with pytest.raises(DatabaseOperationError) as caught:
        await target.SourceInsight.get_for_sources(["source:a"])
    assert str(caught.value) == "Failed to fetch insights for sources"
    assert caught.value.__cause__ is error
    query.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await target.SourceInsight.get_for_sources(["source:a"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,omitted",
    [
        ("sources", "omit source.full_text"),
        ("notes", "omit note.content, note.embedding"),
    ],
)
async def test_omitted_content_option_keeps_default_light_projection(
    monkeypatch, kind, omitted
):
    query = AsyncMock(return_value=[])
    monkeypatch.setattr(target, "repo_query", query)
    assert await getattr(notebook(), "get_" + kind)() == []
    query.assert_awaited_once()
    awaited = query.await_args
    assert awaited is not None
    assert omitted in awaited.args[0]
