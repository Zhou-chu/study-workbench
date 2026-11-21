"""Metadata races against an owned memory-only database, never live config.

Opt in with SOURCE_METADATA_DISPOSABLE_DB=1 and
SOURCE_METADATA_TEST_SURREAL_BINARY pointing at verified SurrealDB 2.3.10.
"""

from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from disposable_database import disposable_database
from fastapi import HTTPException

from api.models import SourceUpdate
from api.routers.sources import update_source
from open_notebook.database.repository import db_connection, repo_query
from open_notebook.domain.notebook import Source

pytestmark = pytest.mark.asyncio
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def metadata_server(tmp_path_factory):
    with disposable_database(
        tmp_path_factory, "SOURCE_METADATA", "source-metadata"
    ) as url:
        yield url


@pytest_asyncio.fixture
async def database(metadata_server, monkeypatch):
    for key, value in {
        "SURREAL_URL": metadata_server,
        "SURREAL_USER": "public_fixture",
        "SURREAL_PASSWORD": "public_fixture",
        "SURREAL_NAMESPACE": "public_metadata_fixture",
        "SURREAL_DATABASE": "metadata_" + uuid4().hex,
    }.items():
        monkeypatch.setenv(key, value)
    async with db_connection() as db:
        for number in (1, 8, 13, 30):
            result = await db.query_raw(
                (
                    ROOT / f"open_notebook/database/migrations/{number}.surrealql"
                ).read_text()
            )
            assert not result.get("error"), result
            assert all(row["status"] == "OK" for row in result["result"]), result
    await repo_query(
        "CREATE source:fixture SET title='Original', topics=['original'], full_text='old body', asset={url:'https://example.org/old'};"
    )


async def test_delayed_metadata_preserves_worker_publication(database, monkeypatch):
    original_get = Source.get
    published = {}

    async def delayed_get(source_id):
        stale = await original_get(source_id)
        await repo_query(
            "UPDATE source:fixture SET full_text='published body', asset={url:'https://example.org/published'}, command=command:new, processing_attempt={token:'new', phase:'running', command:command:new};"
        )
        await repo_query(
            "CREATE source_embedding:fixture SET source=source:fixture, `order`=0, content='published chunk', embedding=[0.1, 0.2];"
        )
        published.update((await repo_query("SELECT * FROM source:fixture;"))[0])
        return stale

    monkeypatch.setattr(Source, "get", delayed_get)
    response = await update_source("source:fixture", SourceUpdate(title="Renamed"))
    current = (await repo_query("SELECT * FROM source:fixture;"))[0]
    assert current["title"] == response.title == "Renamed"
    for field in (
        "full_text",
        "asset",
        "command",
        "processing_attempt",
        "created",
        "topics",
    ):
        assert current[field] == published[field], field
    assert current["updated"] >= published["updated"]
    assert response.full_text == "published body"
    assert response.asset.url == "https://example.org/published"
    assert response.embedded_chunks == 1
    chunks = await repo_query("SELECT * FROM source_embedding:fixture;")
    assert chunks[0]["content"] == "published chunk"
    assert chunks[0]["embedding"] == [0.1, 0.2]


async def test_deleted_between_read_and_update_is_404_not_resurrected(
    database, monkeypatch
):
    original_get = Source.get

    async def delayed_get(source_id):
        stale = await original_get(source_id)
        await repo_query("DELETE source:fixture;")
        return stale

    monkeypatch.setattr(Source, "get", delayed_get)
    with pytest.raises(HTTPException) as caught:
        await update_source("source:fixture", SourceUpdate(topics=["new"]))
    assert caught.value.status_code == 404
    assert caught.value.detail == "Source not found"
    assert await repo_query("SELECT * FROM source:fixture;") == []


@pytest.mark.parametrize(
    "payload, title, topics",
    [
        ({}, "Original", ["original"]),
        ({"title": None, "topics": None}, "Original", ["original"]),
        ({"title": "", "topics": []}, "", []),
        ({"topics": ["new"]}, "Original", ["new"]),
    ],
)
async def test_metadata_null_omission_and_empty_semantics(
    database, payload, title, topics
):
    result = await update_source("source:fixture", SourceUpdate(**payload))
    assert result.title == title
    assert result.topics == topics
    assert result.full_text == "old body"
