"""Opt-in acceptance against an owned, disposable SurrealDB 2.3.10 process.

Set EMBEDDING_DISPOSABLE_DB=1 and EMBEDDING_TEST_SURREAL_BINARY to the verified
SurrealDB 2.3.10 executable, then run pytest on this file. See ADR-017.
No configured database is contacted. Fixture credentials are intentionally public.
"""

import asyncio
import hashlib
import os
import signal
import socket
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio

pytestmark = pytest.mark.asyncio
ROOT = Path(__file__).resolve().parents[1]
SHA256 = "bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7"


@pytest.fixture(scope="session")
def disposable_server(tmp_path_factory):
    if os.getenv("EMBEDDING_DISPOSABLE_DB") != "1":
        pytest.skip("requires explicitly enabled owned disposable database")
    selected = os.getenv("EMBEDDING_TEST_SURREAL_BINARY")
    if not selected:
        pytest.fail(
            "Set EMBEDDING_TEST_SURREAL_BINARY to an explicitly selected verified SurrealDB 2.3.10 executable"
        )
    binary = Path(selected).expanduser().resolve(strict=True)
    assert binary.is_file() and os.access(binary, os.X_OK), (
        "fixture binary must be executable"
    )
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == SHA256, (
        "fixture requires the documented official 2.3.10 binary digest"
    )
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    directory = tmp_path_factory.mktemp("embedding-surreal")
    with (directory / "server.log").open("wb") as log:
        process = subprocess.Popen(
            [
                str(binary),
                "start",
                "--bind",
                f"127.0.0.1:{port}",
                "--user",
                "public_fixture",
                "--pass",
                "public_fixture",
                "memory",
            ],
            cwd=directory,
            env={"PATH": "/usr/bin:/bin", "HOME": str(directory)},
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            assert os.getpgid(process.pid) == process.pid
            deadline = time.monotonic() + 15
            while True:
                assert process.poll() is None, (directory / "server.log").read_text()
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    if time.monotonic() >= deadline:
                        pytest.fail("owned disposable database did not become ready")
                    time.sleep(0.05)
            yield f"ws://127.0.0.1:{port}/rpc"
        finally:
            if process.poll() is None:
                assert os.getpgid(process.pid) == process.pid
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
            else:
                process.wait()


@pytest_asyncio.fixture
async def database(disposable_server, monkeypatch, tmp_path):
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_embedding_fixture")
    monkeypatch.setenv("SURREAL_DATABASE", "embedding_" + uuid4().hex)
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        for number in (1, 2, 13, 19, 24, 25, 26, 27, 29):
            await checked(
                db,
                (
                    ROOT / f"open_notebook/database/migrations/{number}.surrealql"
                ).read_text(),
            )
        await checked(
            db, "CREATE source:fixture SET title='Fixture', full_text='original body';"
        )
        source = (await db.query("SELECT * FROM source:fixture;"))[0]
    yield source


async def checked(db, query, variables=None):
    response = await db.query_raw(query, variables)
    assert not response.get("error"), response
    assert response.get("result"), response
    assert all(row.get("status") == "OK" for row in response["result"]), response
    return response


def records(label, count=3):
    from surrealdb import RecordID

    return [
        {
            "source": RecordID("source", "fixture"),
            "order": i,
            "content": f"{label} searchablechunk {i}",
            "embedding": [1.0, 0.0],
        }
        for i in range(count)
    ]


async def publish(source, label="new", count=3):
    from open_notebook.database.embedding_repository import publish_source_embeddings

    return await publish_source_embeddings(
        source_id="source:fixture",
        content=source["full_text"],
        file_path=None,
        created=source["created"],
        records=records(label, count),
    )


async def rows():
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        return await db.query(
            "SELECT * FROM source_embedding WHERE source=source:fixture ORDER BY order;"
        )


@pytest.mark.parametrize("old_index", [False, True])
async def test_two_concurrent_publishers_leave_one_complete_generation(
    database, monkeypatch, old_index
):
    from open_notebook.database import embedding_repository as repo

    if old_index:
        await publish(database, "old")
    original = repo.db_connection
    arrived = 0
    ready = asyncio.Event()

    @asynccontextmanager
    async def synchronized_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    nonlocal arrived
                    arrived += 1
                    if arrived == 2:
                        ready.set()
                    await ready.wait()
                    # Both transactions establish snapshots before writing the
                    # common source row; at least one must abort, even if empty.
                    query = query.replace(
                        "BEGIN TRANSACTION;",
                        "BEGIN TRANSACTION; LET $initial = SELECT * FROM source:fixture; SLEEP 350ms;",
                        1,
                    )
                    response = await db.query_raw(query, variables)
                    assert not response.get("error"), response
                    return response

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", synchronized_connection)
    outcomes = await asyncio.gather(
        publish(database, "alpha", 4),
        publish(database, "beta", 5),
        return_exceptions=True,
    )
    assert sum(not isinstance(value, BaseException) for value in outcomes) == 1, [
        (repr(v), repr(v.__cause__) if isinstance(v, BaseException) else None)
        for v in outcomes
    ]
    assert sum(isinstance(value, RuntimeError) for value in outcomes) == 1, outcomes
    assert not any(
        isinstance(value, repo.EmbeddingOutcomeUnknown) for value in outcomes
    )
    result = await rows()
    labels = {row["content"].split()[0] for row in result}
    assert labels in ({"alpha"}, {"beta"})
    assert len(result) == (4 if labels == {"alpha"} else 5)


async def test_insert_failure_rolls_back_old_index_and_token(database, monkeypatch):
    from open_notebook.database import embedding_repository as repo
    from open_notebook.database.repository import db_connection

    await publish(database, "old")
    before = await rows()
    async with db_connection() as db:
        token = (await db.query("SELECT embedding_publication FROM source:fixture;"))[0]
    original = repo.db_connection

    @asynccontextmanager
    async def failing_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    query = query.replace(
                        "INSERT INTO source_embedding $records;",
                        'INSERT INTO source_embedding $records; THROW "FIXTURE_FAILURE_AFTER_INSERT";',
                    )
                    response = await db.query_raw(query, variables)
                    return response

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", failing_connection)
    with pytest.raises(RuntimeError) as failure:
        await publish(database, "broken")
    assert not isinstance(failure.value, repo.EmbeddingOutcomeUnknown)
    assert await rows() == before
    async with db_connection() as db:
        assert (await db.query("SELECT embedding_publication FROM source:fixture;"))[
            0
        ] == token


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE source:fixture SET full_text='changed';",
        "UPDATE source:fixture SET asset={file_path:'different.md'};",
        "DELETE source:fixture;",
    ],
)
async def test_stale_or_deleted_source_never_publishes(database, mutation):
    from open_notebook.database.repository import db_connection

    await publish(database, "old")
    async with db_connection() as db:
        await checked(db, mutation)
    before = await rows()
    with pytest.raises(ValueError):
        await publish(database, "stale")
    assert await rows() == before
    if mutation.startswith("DELETE"):
        assert before == []
        async with db_connection() as db:
            assert await db.query("SELECT * FROM source:fixture;") == []


async def test_lost_ack_after_real_commit_does_not_clean_up(database, monkeypatch):
    from open_notebook.database import embedding_repository as repo

    await publish(database, "old")
    original = repo.db_connection
    calls = 0

    @asynccontextmanager
    async def losing_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    nonlocal calls
                    calls += 1
                    await checked(db, query, variables)
                    raise ConnectionError("fixture dropped committed acknowledgement")

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", losing_connection)
    with pytest.raises(repo.EmbeddingOutcomeUnknown):
        await publish(database, "committed")
    assert calls == 1
    assert {row["content"].split()[0] for row in await rows()} == {"committed"}


async def test_note_revision_race_and_editorial_invalidation(database):
    from open_notebook.database import embedding_repository as repo
    from open_notebook.database.note_repository import create_note, update_note
    from open_notebook.database.repository import db_connection

    first = (await create_note(fields={"content": "revision one"})).native
    await repo.publish_markdown_embedding(
        record_id=first["id"],
        content=first["content"],
        created=first["created"],
        embedding=[1.0, 0.0],
        revision=1,
    )
    second = (
        await update_note(
            note_id=first["id"], fields={"content": "revision two"}, expected_revision=1
        )
    ).native
    assert not second.get("embedding")
    await repo.publish_markdown_embedding(
        record_id=second["id"],
        content=second["content"],
        created=second["created"],
        embedding=[0.0, 1.0],
        revision=2,
    )
    with pytest.raises(ValueError):
        await repo.publish_markdown_embedding(
            record_id=first["id"],
            content=first["content"],
            created=first["created"],
            embedding=[1.0, 0.0],
            revision=1,
        )
    from surrealdb import RecordID

    async with db_connection() as db:
        result = (
            await db.query(
                "SELECT * FROM $note;", {"note": RecordID.parse(first["id"])}
            )
        )[0]
    assert result["content"] == "revision two"
    assert result["embedding"] == [0.0, 1.0]
    assert result["revision"] == 2


async def test_migration_up_down_and_existing_retrieval_compatibility(database):
    from open_notebook.database.repository import db_connection

    await publish(database, "new")
    async with db_connection() as db:
        count = await db.query(
            "SELECT count() AS chunks FROM source_embedding WHERE source=source:fixture GROUP ALL;"
        )
        assert count == [{"chunks": 3}]
        listed = await db.query(
            "SELECT (SELECT VALUE id FROM source_embedding WHERE source=$parent.id LIMIT 1) != [] AS embedded FROM source:fixture;"
        )
        assert listed == [{"embedded": True}]
        vector = await db.query(
            "RETURN fn::vector_search([1.0,0.0], 10, true, false, 0.5, NONE);"
        )
        assert vector and all(
            str(row["parent_id"]) == "source:fixture" for row in vector
        )
        text = await db.query(
            "RETURN fn::text_search('searchablechunk', 10, true, false, NONE);"
        )
        assert text and all(str(row["parent_id"]) == "source:fixture" for row in text)
        before = await db.query("SELECT * FROM source_embedding ORDER BY order;")
        await checked(
            db,
            (ROOT / "open_notebook/database/migrations/29_down.surrealql").read_text(),
        )
        assert (
            await db.query("SELECT * FROM source_embedding ORDER BY order;") == before
        )
        await checked(
            db, (ROOT / "open_notebook/database/migrations/29.surrealql").read_text()
        )
    await publish(database, "after_reupgrade", 2)
    assert len(await rows()) == 2


async def test_readers_keep_old_index_until_replace_commits(database, monkeypatch):
    from open_notebook.database import embedding_repository as repo

    await publish(database, "old")
    before = await rows()
    original = repo.db_connection
    sent = asyncio.Event()

    @asynccontextmanager
    async def paused_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    query = query.replace(
                        "INSERT INTO source_embedding",
                        "SLEEP 600ms; INSERT INTO source_embedding",
                        1,
                    )
                    sent.set()
                    return await db.query_raw(query, variables)

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", paused_connection)
    task = asyncio.create_task(publish(database, "new"))
    await sent.wait()
    await asyncio.sleep(0.1)
    try:
        assert not task.done()
        assert await rows() == before
    finally:
        await task
    assert {row["content"].split()[0] for row in await rows()} == {"new"}


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE source:fixture SET full_text='new editorial content';",
        "DELETE source:fixture;",
    ],
)
async def test_source_mutation_during_publication_aborts_stale_transaction(
    database, monkeypatch, mutation
):
    from open_notebook.database import embedding_repository as repo
    from open_notebook.database.repository import db_connection

    await publish(database, "old")
    original = repo.db_connection
    sent = asyncio.Event()

    @asynccontextmanager
    async def paused_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    query = query.replace(
                        "BEGIN TRANSACTION;",
                        "BEGIN TRANSACTION; LET $initial = SELECT * FROM source:fixture; SLEEP 600ms;",
                        1,
                    )
                    sent.set()
                    return await db.query_raw(query, variables)

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", paused_connection)
    task = asyncio.create_task(publish(database, "stale"))
    await sent.wait()
    await asyncio.sleep(0.1)
    assert not task.done()
    async with db_connection() as db:
        await checked(db, mutation)
    with pytest.raises((RuntimeError, ValueError)) as failure:
        await task
    assert not isinstance(failure.value, repo.EmbeddingOutcomeUnknown)
    result = await rows()
    if mutation.startswith("DELETE"):
        assert result == []
    else:
        assert {row["content"].split()[0] for row in result} == {"old"}


async def test_insight_content_guard_without_note_revision(database):
    from open_notebook.database import embedding_repository as repo
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        insight = (
            await db.query(
                "CREATE source_insight:fixture SET source=source:fixture, insight_type='summary', content='original';"
            )
        )[0]
    await repo.publish_markdown_embedding(
        record_id="source_insight:fixture",
        content="original",
        created=insight["created"],
        embedding=[1.0, 0.0],
    )
    async with db_connection() as db:
        await checked(
            db,
            "UPDATE source_insight:fixture SET content='changed', embedding=[0.0,1.0];",
        )
    with pytest.raises(ValueError):
        await repo.publish_markdown_embedding(
            record_id="source_insight:fixture",
            content="original",
            created=insight["created"],
            embedding=[1.0, 0.0],
        )
    async with db_connection() as db:
        current = (await db.query("SELECT * FROM source_insight:fixture;"))[0]
    assert current["embedding"] == [0.0, 1.0]


async def test_real_transaction_ack_shape(database, monkeypatch):
    from open_notebook.database import embedding_repository as repo

    original = repo.db_connection
    observed = []

    @asynccontextmanager
    async def recording_connection():
        async with original() as db:

            class Proxy:
                async def query_raw(self, query, variables=None):
                    response = await db.query_raw(query, variables)
                    observed.extend(response["result"])
                    return response

            yield Proxy()

    monkeypatch.setattr(repo, "db_connection", recording_connection)
    await publish(database)
    assert len(observed) == 2
    assert [row["status"] for row in observed] == ["OK", "OK"]
    assert observed[0]["result"] == observed[1]["result"]
    assert set(observed[0]["result"]) == {"token", "chunks"}
