"""Offline API contracts for source metadata-only writes."""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.models import SourceUpdate
from api.routers import sources
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import InvalidInputError, NotFoundError

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({}, {}),
        ({"title": None, "topics": None}, {}),
        ({"title": "", "topics": []}, {"title": "", "topics": []}),
        ({"title": "Renamed"}, {"title": "Renamed"}),
        ({"topics": ["new"]}, {"topics": ["new"]}),
    ],
)
async def test_writes_only_nonnull_metadata_and_uses_returned_record(
    monkeypatch, payload, expected
):
    monkeypatch.setattr(
        Source,
        "get",
        AsyncMock(return_value=Source(id="source:fixture", full_text="old")),
    )
    save = AsyncMock(side_effect=AssertionError("must not save stale snapshot"))
    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=2))
    update = AsyncMock(
        return_value=[
            {
                "id": "source:fixture",
                "title": "Returned",
                "full_text": "published",
                "asset": {"url": "https://example.org/new"},
            }
        ]
    )
    monkeypatch.setattr(sources, "repo_update", update)
    result = await sources.update_source("source:fixture", SourceUpdate(**payload))
    update.assert_awaited_once_with("source", "source:fixture", expected)
    save.assert_not_awaited()
    assert result.title == "Returned"
    assert result.full_text == "published"
    assert result.asset.url == "https://example.org/new"
    assert result.embedded_chunks == 2


@pytest.mark.parametrize(
    "error", [NotFoundError("missing"), InvalidInputError("invalid")]
)
async def test_existing_read_error_contract(monkeypatch, error):
    monkeypatch.setattr(Source, "get", AsyncMock(side_effect=error))
    with pytest.raises(
        HTTPException if isinstance(error, InvalidInputError) else NotFoundError
    ) as caught:
        await sources.update_source("source:fixture", SourceUpdate(title="new"))
    if isinstance(error, InvalidInputError):
        assert isinstance(caught.value, HTTPException)
        assert caught.value.status_code == 400
        assert caught.value.detail == "invalid"


@pytest.mark.parametrize("rows", [[], [{"id": "source:fixture", "asset": "invalid"}]])
async def test_deleted_or_invalid_returned_record(monkeypatch, rows):
    monkeypatch.setattr(
        Source, "get", AsyncMock(return_value=Source(id="source:fixture"))
    )
    monkeypatch.setattr(sources, "repo_update", AsyncMock(return_value=rows))
    with pytest.raises(HTTPException) as caught:
        await sources.update_source("source:fixture", SourceUpdate())
    assert caught.value.status_code == (500 if rows else 404)
    assert caught.value.detail == (
        "Error updating source" if rows else "Source not found"
    )
