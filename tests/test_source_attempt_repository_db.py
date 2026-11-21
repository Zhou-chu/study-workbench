"""Opt-in ownership acceptance; ONLY an owned memory-only SurrealDB 2.3.10.

Set SOURCE_ATTEMPT_DISPOSABLE_DB=1 and SOURCE_ATTEMPT_TEST_SURREAL_BINARY.
No configured runtime/database is contacted; credentials are public fixtures.
"""

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from disposable_database import disposable_database

pytestmark = pytest.mark.asyncio
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def disposable_server(tmp_path_factory):
    with disposable_database(
        tmp_path_factory, "SOURCE_ATTEMPT", "source-attempt-surreal"
    ) as url:
        yield url


@pytest_asyncio.fixture
async def database(disposable_server, monkeypatch):
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_source_attempt_fixture")
    monkeypatch.setenv("SURREAL_DATABASE", "attempt_" + uuid4().hex)
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        for number in (1, 8, 13):
            await checked(
                db,
                (
                    ROOT / f"open_notebook/database/migrations/{number}.surrealql"
                ).read_text(),
            )
        await checked(
            db, "CREATE source:fixture SET title='Fixture', full_text='original body';"
        )
        await checked(
            db, (ROOT / "open_notebook/database/migrations/30.surrealql").read_text()
        )
    yield


async def checked(db, query, variables=None):
    response = await db.query_raw(query, variables)
    assert not response.get("error"), response
    assert response.get("result"), response
    assert all(row.get("status") == "OK" for row in response["result"]), response
    return response


async def query(sql, params=None):
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        await checked(db, sql, params)


async def source():
    from open_notebook.domain.notebook import Source

    return await Source.get("source:fixture")


async def pending(token="attempt_a", command=None, phase="pending", owner=None):
    from surrealdb import RecordID

    attempt = {"token": token, "phase": phase}
    if owner:
        attempt["owner"] = owner
    if command:
        attempt["command"] = RecordID.parse(command)
    await query(
        "UPDATE source:fixture SET processing_attempt=$attempt, command=$command;",
        {
            "attempt": attempt,
            "command": RecordID.parse(command) if command else None,
        },
    )


async def command(command_id="command:a", status="new", token="attempt_a"):
    from surrealdb import RecordID

    await query(
        "CREATE $id CONTENT $data;",
        {
            "id": RecordID.parse(command_id),
            "data": {
                "app": "open_notebook",
                "name": "process_source",
                "status": status,
                "args": {"source_id": "source:fixture", "submission_token": token},
            },
        },
    )


async def test_migration_roundtrip_preserves_source(database):
    await pending()
    from open_notebook.database.repository import db_connection

    async with db_connection() as db:
        await checked(
            db,
            (ROOT / "open_notebook/database/migrations/30_down.surrealql").read_text(),
        )
        await checked(db, "UPDATE source:fixture SET title='Legacy compatible';")
        legacy = (await db.query("SELECT * FROM source:fixture;"))[0]
        assert legacy["full_text"] == "original body"
        assert "processing_attempt" not in legacy
        await checked(
            db, (ROOT / "open_notebook/database/migrations/30.surrealql").read_text()
        )
    assert (await source()).full_text == "original body"
    await pending("after_roundtrip")
    assert (await source()).processing_attempt["token"] == "after_roundtrip"


async def test_fast_worker_then_ack_preserves_phase_and_content(database):
    from open_notebook.database import source_attempt_repository as repo

    await query("UPDATE source:fixture SET title='Processing...';")
    await pending()
    await command()
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "owner_a")
    await repo.publish_source(
        "source:fixture",
        "attempt_a",
        "owner_a",
        {"full_text": "worker completed", "title": "Worker title"},
    )
    await repo.finish_worker("source:fixture", "attempt_a", "owner_a", True)
    await query("UPDATE command:a SET status='completed';")
    await repo.bind_command("source:fixture", "attempt_a", "command:a")
    current = await source()
    assert current.full_text == "worker completed"
    assert current.title == "Worker title"
    assert current.processing_attempt["phase"] == "succeeded"
    assert str(current.command) == "command:a"


async def test_duplicate_workers_only_one_can_acquire(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command()
    outcomes = await asyncio.gather(
        *[
            repo.start_worker(
                "source:fixture", "attempt_a", "command:a", f"owner_{index}"
            )
            for index in range(2)
        ],
        return_exceptions=True,
    )
    assert (
        sum(
            not isinstance(value, BaseException) and value is not False
            for value in outcomes
        )
        == 1
    )
    assert (await source()).processing_attempt["phase"] == "running"


async def test_simultaneous_retries_one_owner_and_late_ack_is_stale(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed", owner="owner_a")
    await command(status="failed")
    old = await source()
    outcomes = await asyncio.gather(
        repo.claim_retry(old), repo.claim_retry(old), return_exceptions=True
    )
    assert (
        sum(
            not isinstance(value, BaseException) and value is not False
            for value in outcomes
        )
        == 1
    )
    current = await source()
    assert current.processing_attempt["token"] != "attempt_a"
    assert current.processing_attempt["phase"] == "pending"
    try:
        await repo.bind_command("source:fixture", "attempt_a", "command:a")
    except ValueError:
        pass
    latest = await source()
    assert latest.processing_attempt == current.processing_attempt
    assert latest.full_text == "original body"


@pytest.mark.parametrize("status", ["new", "queued", "running", "completed", "unknown"])
async def test_failed_owner_phase_does_not_override_actual_command_status(
    database, status
):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed", owner="owner_a")
    await command(status=status)
    old = await source()
    try:
        result = await repo.claim_retry(old)
    except ValueError:
        result = False
    assert result is False
    assert (await source()).processing_attempt == old.processing_attempt


async def test_unknown_no_id_never_becomes_retryable_from_absence(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(phase="pending")
    old = await source()
    await repo.reconcile(old)
    try:
        result = await repo.claim_retry(await source())
    except ValueError:
        result = False
    assert result is False
    assert (await source()).processing_attempt == old.processing_attempt


async def test_unknown_recovers_only_unique_matching_command(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(phase="pending")
    await command()
    await repo.reconcile(await source())
    assert str((await source()).command) == "command:a"
    assert (await source()).processing_attempt["token"] == "attempt_a"


async def test_ambiguous_matching_commands_remain_unbound(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(phase="pending")
    await command()
    await command("command:b")
    await repo.reconcile(await source())
    assert not (await source()).command
    assert (await source()).processing_attempt["phase"] == "pending"


@pytest.mark.parametrize("worker_token", [None, "stale_token"])
async def test_stale_and_legacy_worker_cannot_take_new_attempt(database, worker_token):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command()
    try:
        result = await repo.start_worker(
            "source:fixture", worker_token, "command:a", "owner_a"
        )
    except ValueError:
        result = False
    assert result is False
    assert (await source()).processing_attempt["phase"] == "pending"


@pytest.mark.parametrize("status", ["failed", "canceled", "cancelled"])
async def test_failed_owner_allows_retry_only_after_real_terminal_failure(
    database, status
):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed", owner="owner_a")
    await command(status=status)
    attempt = await repo.claim_retry(await source())
    assert attempt["phase"] == "pending"
    assert attempt["token"] != "attempt_a"


async def test_stale_snapshot_cannot_claim_after_command_status_changes(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed", owner="owner_a")
    await command(status="failed")
    stale = await source()
    await query("UPDATE command:a SET status='running';")
    with pytest.raises(ValueError):
        await repo.claim_retry(stale)
    assert (await source()).processing_attempt["token"] == "attempt_a"


async def test_legacy_worker_without_superseding_attempt_still_runs_once(database):
    from open_notebook.database import source_attempt_repository as repo

    await command()
    await repo.start_worker("source:fixture", None, "command:a", "owner_a")
    with pytest.raises(ValueError):
        await repo.start_worker("source:fixture", None, "command:a", "owner_a")
    assert str((await source()).command) == "command:a"


async def test_legacy_no_command_source_can_claim_first_retry(database):
    from open_notebook.database import source_attempt_repository as repo

    attempt = await repo.claim_retry(await source())
    assert (await source()).processing_attempt == attempt


async def test_unknown_reconciliation_ignores_other_source_and_token(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(token="another_attempt")
    await command("command:b")
    await query("UPDATE command:b SET args.source_id='source:other';")
    await repo.reconcile(await source())
    assert not (await source()).command


async def test_stale_domain_save_cannot_rewind_attempt_ownership(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed", owner="owner_a")
    await command(status="failed")
    stale = await source()
    attempt = await repo.claim_retry(await source())
    await command("command:b", token=attempt["token"])
    await repo.start_worker("source:fixture", attempt["token"], "command:b", "owner_b")
    stale.title = "A content edit"
    await stale.save()
    latest = await source()
    assert latest.title == "A content edit"
    assert latest.processing_attempt["token"] == attempt["token"]
    assert latest.processing_attempt["phase"] == "running"
    assert str(latest.command) == "command:b"


async def test_pending_attempt_cannot_reclaim_stale_terminal_reference(database):
    from open_notebook.database import source_attempt_repository as repo

    await command(status="failed")
    await pending()
    await query("UPDATE source:fixture SET command=command:a;")
    with pytest.raises(ValueError, match="retry refused"):
        await repo.claim_retry(await source())
    assert (await source()).processing_attempt["token"] == "attempt_a"


async def test_fresh_full_migration_chain_composite(
    disposable_server, monkeypatch, tmp_path
):
    """Fresh 1–30 install only; not acceptance of arbitrary existing upgrades."""
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_source_attempt_full_chain")
    monkeypatch.setenv("SURREAL_DATABASE", "fresh_" + uuid4().hex)
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    from open_notebook.database import embedding_repository as embeddings
    from open_notebook.database import note_repository as notes
    from open_notebook.database import source_attempt_repository as attempts
    from open_notebook.database.async_migrate import AsyncMigrationManager
    from open_notebook.database.repository import db_connection, ensure_record_id
    from open_notebook.domain.notebook import Source

    manager = AsyncMigrationManager()
    assert len(manager.up_migrations) == 30
    assert await manager.get_current_version() == 0
    # No schema-subset fixture is used: the actual registered manager owns every
    # migration on this unique, previously nonexistent database.
    try:
        await manager.run_migration_up()
    except Exception as exc:
        completed = await manager.get_current_version()
        pytest.fail(f"Fresh full-chain migration {completed + 1} failed: {exc!r}")
    assert await manager.get_current_version() == 30
    assert not await manager.needs_migration()

    original = Source(title="Composite", full_text="original body")
    await original.save()
    attempt = await attempts.claim_retry(original)
    identity = str(original.id)
    await query(
        "CREATE command:composite CONTENT {app:'open_notebook', name:'process_source', status:'running', args:{source_id:$source_id, submission_token:$submission_token}};",
        {"source_id": identity, "submission_token": attempt["token"]},
    )
    await attempts.start_worker(
        identity, attempt["token"], "command:composite", "owner_composite"
    )
    worker_source = await Source.get(identity)
    await attempts.publish_source(
        identity, attempt["token"], "owner_composite", {"full_text": "processed body"}
    )
    await embeddings.publish_source_embeddings(
        identity,
        "processed body",
        None,
        worker_source.created,
        [{"content": "processed chunk", "embedding": [1.0, 0.0]}],
    )
    await attempts.bind_command(identity, attempt["token"], "command:composite")
    current = await Source.get(identity)
    assert current.full_text == "processed body"
    assert current.processing_attempt is not None
    assert current.processing_attempt["phase"] == "running"
    assert current.processing_attempt["token"] == attempt["token"]
    assert str(current.command) == "command:composite"
    # An ordinary save after publication and ACK retains both ownership records.
    current.title = "Edited title"
    await current.save()
    async with db_connection() as db:
        stored = (
            await db.query(
                "SELECT * FROM $source_id;",
                {"source_id": ensure_record_id(identity)},
            )
        )[0]
        chunks = await db.query(
            "SELECT * FROM source_embedding WHERE source=$source_id;",
            {"source_id": ensure_record_id(identity)},
        )
    assert stored["embedding_publication"]
    assert stored["processing_attempt"]["token"] == attempt["token"]
    assert len(chunks) == 1 and chunks[0]["content"] == "processed chunk"

    bundle = await notes.create_note(
        fields={"title": "Composite note", "content": "note text"}
    )
    note = bundle.native
    await embeddings.publish_markdown_embedding(
        str(note["id"]), note["content"], note["created"], [1.0, 0.0], revision=1
    )
    edited = await notes.update_note(
        note_id=str(note["id"]),
        fields={"title": "Editorial change"},
        expected_revision=1,
        mode="multiclient",
    )
    assert edited.native["revision"] == 2
    assert not edited.native.get("embedding")
    with pytest.raises(ValueError, match="changed"):
        await embeddings.publish_markdown_embedding(
            str(note["id"]), note["content"], note["created"], [0.0, 1.0], revision=1
        )
    reloaded = await notes.read_note_bundle(str(note["id"]))
    assert reloaded.native["revision"] == 2
    assert not reloaded.native.get("embedding")
    final_source = await Source.get(identity)
    assert final_source.processing_attempt is not None
    assert final_source.processing_attempt["token"] == attempt["token"]


@pytest.mark.parametrize("raw_sql", [False, True])
@pytest.mark.parametrize(
    "legacy_table, populated",
    [
        (None, False),
        ("speaker_profile", False),
        ("speaker_profile", True),
        ("episode_profile", False),
        ("episode_profile", True),
        ("episode", False),
        ("episode", True),
        ("podcast_config", True),
    ],
)
async def test_migration_seven_preserves_unknown_legacy_state(
    disposable_server, monkeypatch, legacy_table, populated, raw_sql
):
    """Unknown tables, custom fields and seed collisions must never be reset."""
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_migration_seven_fixture")
    monkeypatch.setenv("SURREAL_DATABASE", "migration_" + uuid4().hex)
    from open_notebook.database.async_migrate import AsyncMigrationManager
    from open_notebook.database.repository import db_connection

    manager = AsyncMigrationManager()
    for migration in manager.up_migrations[:6]:
        await migration.run()
    async with db_connection() as db:
        await checked(db, "CREATE source:preserved SET title='Unrelated source';")
        if legacy_table:
            # Table names are fixed parametrized test constants, never user input.
            await checked(db, f"DEFINE TABLE IF NOT EXISTS {legacy_table} SCHEMALESS;")
            if populated:
                for record, name in (
                    ("custom", "My custom profile"),
                    ("collision", "solo_expert"),
                ):
                    await checked(
                        db,
                        f"CREATE {legacy_table}:{record} CONTENT $data;",
                        {
                            "data": {
                                "name": name,
                                "unknown": {"nested": [1, "保持", None]},
                                "voice": "legacy",
                                "custom_bytes": "\\x00\\xff",
                            }
                        },
                    )

        async def snapshot():
            info = await db.query("INFO FOR DB;")
            tables = info["tables"]
            return {
                "info": info,
                "schemas": {
                    name: await db.query(f"INFO FOR TABLE {name};") for name in tables
                },
                "records": {
                    name: await db.query(f"SELECT * FROM {name} ORDER BY id;")
                    for name in tables
                },
            }

        before = await snapshot()
        if legacy_table:
            from open_notebook.database.async_migrate import AsyncMigration

            migration = manager.up_migrations[6]
            if raw_sql:
                # Bypass Python preflight to exercise the SQL guard itself,
                # including a table appearing after the read-only preflight.
                migration = AsyncMigration(migration.sql)
            with pytest.raises(
                RuntimeError, match=None if raw_sql else "manual review"
            ):
                await migration.run()
            assert await manager.get_current_version() == 6
            assert await snapshot() == before
        else:
            await manager.up_migrations[6].run()
            assert await manager.get_current_version() == 7
            profiles = await db.query("SELECT * FROM speaker_profile;")
            assert {row["name"] for row in profiles} == {
                "tech_experts",
                "solo_expert",
                "business_panel",
            }
            assert (
                await db.query("SELECT * FROM source:preserved;")
                == before["records"]["source"]
            )


async def test_migration_seven_failure_after_seeding_rolls_back_all_writes(
    disposable_server, monkeypatch
):
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_migration_seven_fixture")
    monkeypatch.setenv("SURREAL_DATABASE", "rollback_" + uuid4().hex)
    from open_notebook.database.async_migrate import (
        AsyncMigration,
        AsyncMigrationManager,
    )
    from open_notebook.database.repository import db_connection

    manager = AsyncMigrationManager()
    for migration in manager.up_migrations[:6]:
        await migration.run()
    async with db_connection() as db:
        before = await db.query("INFO FOR DB;")
        sql = manager.up_migrations[6].sql.replace(
            "COMMIT TRANSACTION;",
            "THROW 'synthetic post-seed failure'; COMMIT TRANSACTION;",
        )
        with pytest.raises(RuntimeError):
            await AsyncMigration(sql).run()
        assert await manager.get_current_version() == 6
        assert await db.query("INFO FOR DB;") == before
        for table in ("speaker_profile", "episode_profile", "episode"):
            assert await db.query(f"SELECT * FROM {table};") == []
        # The failed attempt left no schema/index/seed residue preventing retry.
        await manager.up_migrations[6].run()
        assert await manager.get_current_version() == 7


@pytest.mark.parametrize("table", ["speaker_profile", "episode_profile", "episode"])
async def test_migration_seven_table_created_after_preflight_is_preserved(
    disposable_server, monkeypatch, table
):
    monkeypatch.setenv("SURREAL_URL", disposable_server)
    monkeypatch.setenv("SURREAL_USER", "public_fixture")
    monkeypatch.setenv("SURREAL_PASSWORD", "public_fixture")
    monkeypatch.setenv("SURREAL_NAMESPACE", "public_migration_seven_fixture")
    monkeypatch.setenv("SURREAL_DATABASE", "race_" + uuid4().hex)
    from open_notebook.database import async_migrate as migrations
    from open_notebook.database.repository import db_connection

    manager = migrations.AsyncMigrationManager()
    for migration in manager.up_migrations[:6]:
        await migration.run()
    original = migrations._query_checked
    baseline = None

    async def introduce_table(sql, variables=None):
        nonlocal baseline
        result = await original(sql, variables)
        if sql.startswith("INFO FOR DB;"):
            async with db_connection() as db:
                await checked(
                    db,
                    f"DEFINE TABLE {table} SCHEMALESS; DEFINE FIELD custom ON {table} TYPE option<string>;",
                )
                baseline = (
                    await db.query("INFO FOR DB;"),
                    await db.query(f"INFO FOR TABLE {table};"),
                )
        return result

    monkeypatch.setattr(migrations, "_query_checked", introduce_table)
    with pytest.raises(RuntimeError, match="statement"):
        await manager.up_migrations[6].run()
    assert baseline is not None
    assert await manager.get_current_version() == 6
    async with db_connection() as db:
        assert (
            await db.query("INFO FOR DB;"),
            await db.query(f"INFO FOR TABLE {table};"),
        ) == baseline
        assert await db.query(f"SELECT * FROM {table};") == []


async def test_duplicate_loser_cannot_unlock_active_winner_via_shared_command(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    with pytest.raises(ValueError):
        await repo.start_worker("source:fixture", "attempt_a", "command:a", "loser")
    # The queue library writes its failure to the same command record even
    # though a different execution still owns the active source graph.
    await query("UPDATE command:a SET status='failed';")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    current = await source()
    assert current.processing_attempt["owner"] == "winner"
    assert current.processing_attempt["phase"] == "running"
    await repo.publish_source(
        "source:fixture", "attempt_a", "winner", {"full_text": "winner content"}
    )
    assert (await source()).full_text == "winner content"


async def test_failed_actual_owner_can_release_for_explicit_retry(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    await repo.finish_worker("source:fixture", "attempt_a", "winner", False)
    # Ownership completion alone cannot authorize replay before queue completion.
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    await query("UPDATE command:a SET status='failed';")
    attempt = await repo.claim_retry(await source())
    assert attempt["token"] != "attempt_a"
    assert attempt["phase"] == "pending"


async def test_successful_owner_cannot_be_retried_when_loser_marks_shared_command_failed(
    database,
):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    await repo.finish_worker("source:fixture", "attempt_a", "winner", True)
    await query("UPDATE command:a SET status='failed';")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    await repo.bind_command("source:fixture", "attempt_a", "command:a")
    assert (await source()).processing_attempt["phase"] == "succeeded"


@pytest.mark.parametrize("succeeded", [False, True])
async def test_loser_cannot_finish_winners_execution(database, succeeded):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    with pytest.raises(ValueError):
        await repo.finish_worker("source:fixture", "attempt_a", "loser", succeeded)
    current = await source()
    assert current.processing_attempt["phase"] == "running"
    assert current.processing_attempt["owner"] == "winner"


async def test_delayed_old_owner_publish_and_finish_cannot_touch_new_attempt(database):
    from open_notebook.database import source_attempt_repository as repo

    await query("UPDATE source:fixture SET title='Processing...';")
    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "owner_a")
    await repo.finish_worker("source:fixture", "attempt_a", "owner_a", False)
    await query("UPDATE command:a SET status='failed';")
    attempt_b = await repo.claim_retry(await source())
    await command("command:b", status="running", token=attempt_b["token"])
    await repo.start_worker(
        "source:fixture", attempt_b["token"], "command:b", "owner_b"
    )
    await repo.publish_source(
        "source:fixture",
        attempt_b["token"],
        "owner_b",
        {"full_text": "new owner", "title": "New"},
    )
    with pytest.raises(ValueError):
        await repo.publish_source(
            "source:fixture",
            "attempt_a",
            "owner_a",
            {"full_text": "stale overwrite", "title": "Old"},
        )
    with pytest.raises(ValueError):
        await repo.finish_worker("source:fixture", "attempt_a", "owner_a", True)
    current = await source()
    assert current.full_text == "new owner"
    assert current.title == "New"
    assert current.processing_attempt["owner"] == "owner_b"
    assert current.processing_attempt["phase"] == "running"


async def test_lost_claim_ack_cannot_let_other_execution_finish_owner(
    database, monkeypatch
):
    from contextlib import asynccontextmanager

    from open_notebook.database import source_attempt_repository as repo
    from open_notebook.exceptions import CommandSubmissionUnknownError

    await pending()
    await command(status="running")
    original = repo.db_connection

    @asynccontextmanager
    async def lost_ack():
        async with original() as db:
            query_raw = db.query_raw

            async def lose(*args, **kwargs):
                await query_raw(*args, **kwargs)
                raise ConnectionError("fixture lost claim acknowledgement")

            db.query_raw = lose
            yield db

    with monkeypatch.context() as patch:
        patch.setattr(repo, "db_connection", lost_ack)
        with pytest.raises(CommandSubmissionUnknownError):
            await repo.start_worker(
                "source:fixture", "attempt_a", "command:a", "uncertain_owner"
            )
    current = await source()
    assert current.processing_attempt["owner"] == "uncertain_owner"
    with pytest.raises(ValueError):
        await repo.finish_worker(
            "source:fixture", "attempt_a", "another_execution", False
        )
    await query("UPDATE command:a SET status='failed';")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    assert (await source()).processing_attempt["phase"] == "running"


@pytest.mark.parametrize("phase", ["pending", "confirmed", "running", "succeeded"])
async def test_shared_failed_queue_never_releases_nonfailed_attempt(database, phase):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase=phase, owner="existing_owner")
    await command(status="failed")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    assert (await source()).processing_attempt["phase"] == phase


async def test_failed_phase_without_execution_owner_remains_unresolved(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending(command="command:a", phase="failed")
    await command(status="failed")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    assert (await source()).processing_attempt["token"] == "attempt_a"


async def test_legacy_failed_command_without_owner_is_not_termination_evidence(
    database,
):
    from open_notebook.database import source_attempt_repository as repo

    await command(status="failed", token=None)
    await query("UPDATE source:fixture SET command=command:a;")
    with pytest.raises(ValueError):
        await repo.claim_retry(await source())
    assert (await source()).processing_attempt is None


async def test_publication_preserves_user_title_and_cannot_change_ownership(database):
    from open_notebook.database import source_attempt_repository as repo

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    await repo.publish_source(
        "source:fixture",
        "attempt_a",
        "winner",
        {
            "full_text": "extracted",
            "title": "Extraction title",
            "command": "command:other",
            "processing_attempt": {
                "token": "injected",
                "owner": "loser",
                "phase": "failed",
            },
        },
    )
    current = await source()
    assert current.title == "Fixture"
    assert current.full_text == "extracted"
    assert str(current.command) == "command:a"
    assert current.processing_attempt["token"] == "attempt_a"
    assert current.processing_attempt["owner"] == "winner"


@pytest.mark.parametrize("committed", [True, False])
async def test_lost_success_finish_receipt_never_authorizes_replay(
    database, monkeypatch, committed
):
    from contextlib import asynccontextmanager
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from open_notebook.database import source_attempt_repository as repo
    from open_notebook.exceptions import CommandSubmissionUnknownError

    await pending()
    await command(status="running")
    await repo.start_worker("source:fixture", "attempt_a", "command:a", "winner")
    original = repo.db_connection

    @asynccontextmanager
    async def lost_finish_ack():
        async with original() as db:
            query_raw = db.query_raw

            async def lose(*args, **kwargs):
                if committed:
                    await query_raw(*args, **kwargs)
                raise ConnectionError("fixture lost successful finish acknowledgement")

            db.query_raw = lose
            yield db

    with monkeypatch.context() as patch:
        patch.setattr(repo, "db_connection", lost_finish_ack)
        with pytest.raises(CommandSubmissionUnknownError):
            await repo.finish_worker("source:fixture", "attempt_a", "winner", True)

    await query("UPDATE command:a SET status='failed';")
    current = await source()
    assert current.processing_attempt["phase"] == (
        "succeeded" if committed else "running"
    )
    monkeypatch.setattr(
        "surreal_commands.get_command_status",
        AsyncMock(return_value=SimpleNamespace(status="failed")),
    )
    assert await current.get_status() == ("completed" if committed else "unknown")
    with pytest.raises(ValueError):
        await repo.claim_retry(current)
    assert (await source()).processing_attempt["token"] == "attempt_a"
