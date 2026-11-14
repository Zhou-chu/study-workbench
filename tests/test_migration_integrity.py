"""Migration integrity probes without application imports or runtime settings."""

import ast
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest


def load_migrations(response=None, error=None):
    path = Path(__file__).parents[1] / "open_notebook/database/async_migrate.py"
    tree = ast.parse(path.read_text())
    tree.body = [
        node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))
    ]
    connection = Mock()
    connection.query_raw = AsyncMock(return_value=response, side_effect=error)
    # SDK 1.0.8 drops all but the first result, without checking SQL status.
    results = response.get("result") if isinstance(response, dict) else None
    first = (
        results[0]
        if isinstance(results, list) and results and isinstance(results[0], dict)
        else {}
    )
    connection.query = AsyncMock(return_value=first.get("result"), side_effect=error)

    @asynccontextmanager
    async def db_connection():
        yield connection

    namespace = {
        "List": list,
        "logger": Mock(),
        "db_connection": db_connection,
        "repo_query": AsyncMock(return_value=first.get("result"), side_effect=error),
    }
    exec(compile(tree, str(path), "exec"), namespace)
    return namespace, connection


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"result": []},
        {"error": {"code": -1}, "result": [{"status": "OK", "result": None}]},
        {"result": [{"status": "ERR", "result": "failed"}]},
        {
            "result": [
                {"status": "OK", "result": None},
                {"status": "ERR", "result": "failed"},
            ]
        },
        {"result": [{"status": "OK"}]},
        {"result": [{"status": "UNKNOWN", "result": None}]},
        {"result": [None]},
        {"result": {"status": "OK", "result": None}},
    ],
)
@pytest.mark.parametrize("bump", [True, False])
async def test_invalid_ack_does_not_advance_or_lower_version(response, bump):
    ns, _ = load_migrations(response)
    ns["bump_version"] = AsyncMock()
    ns["lower_version"] = AsyncMock()
    with pytest.raises(RuntimeError):
        await ns["AsyncMigration"]("RETURN true; RETURN false;").run(bump=bump)
    ns["bump_version"].assert_not_awaited()
    ns["lower_version"].assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("bump", [True, False])
async def test_all_acknowledgements_ok_updates_version(bump):
    ns, _ = load_migrations(
        {"result": [{"status": "OK", "result": None}, {"status": "OK", "result": []}]}
    )
    ns["bump_version"] = AsyncMock()
    ns["lower_version"] = AsyncMock()
    await ns["AsyncMigration"]("RETURN true; RETURN false;").run(bump=bump)
    ns["bump_version" if bump else "lower_version"].assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error", [ConnectionError("fixture"), PermissionError("fixture")]
)
async def test_version_read_failure_prevents_migration_replay(error):
    ns, _ = load_migrations(error=error)
    migration = Mock(run=AsyncMock())
    with pytest.raises(type(error)):
        await ns["AsyncMigrationRunner"]([migration], []).run_all()
    migration.run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows",
    [
        None,
        {},
        "failed",
        [{}],
        [{"version": True}],
        [{"version": "1"}],
        [{"version": -1}],
        [{"version": 0}],
        [None],
    ],
)
async def test_malformed_version_history_is_not_empty(rows):
    ns, _ = load_migrations({"result": [{"status": "OK", "result": rows}]})
    with pytest.raises(RuntimeError):
        await ns["get_latest_version"]()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows,expected", [([], 0), ([{"version": 1}, {"version": 3}], 3)]
)
async def test_successful_empty_or_valid_history(rows, expected):
    ns, _ = load_migrations({"result": [{"status": "OK", "result": rows}]})
    assert await ns["get_latest_version"]() == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["bump_version", "lower_version"])
@pytest.mark.parametrize(
    "response",
    [
        {"result": [{"status": "ERR", "result": "failed"}]},
        {"result": []},
        {"result": [{"status": "OK"}]},
    ],
)
async def test_version_write_requires_acknowledgement(operation, response):
    ns, _ = load_migrations(response)
    ns["get_latest_version"] = AsyncMock(return_value=2)
    with pytest.raises(RuntimeError):
        await ns[operation]()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation,version", [("bump_version", 3), ("lower_version", 2)]
)
async def test_version_write_uses_bound_version(operation, version):
    ns, connection = load_migrations({"result": [{"status": "OK", "result": []}]})
    ns["get_latest_version"] = AsyncMock(return_value=2)
    await ns[operation]()
    assert connection.query_raw.await_args.args[1] == {"version": version}


@pytest.mark.asyncio
async def test_statement_failure_stops_later_migrations():
    ns, _ = load_migrations({"result": [{"status": "ERR", "result": "failed"}]})
    ns["get_latest_version"] = AsyncMock(return_value=0)
    ns["bump_version"] = AsyncMock()
    later = Mock(run=AsyncMock())
    runner = ns["AsyncMigrationRunner"](
        [ns["AsyncMigration"]("THROW 'fixture';"), later], []
    )
    with pytest.raises(RuntimeError):
        await runner.run_all()
    later.run.assert_not_awaited()
    ns["bump_version"].assert_not_awaited()


@pytest.mark.asyncio
async def test_version_query_rejects_extra_statement_results():
    ns, _ = load_migrations(
        {"result": [{"status": "OK", "result": []}, {"status": "OK", "result": []}]}
    )
    with pytest.raises(RuntimeError):
        await ns["get_latest_version"]()


@pytest.mark.asyncio
@pytest.mark.parametrize("bump", [True, False])
async def test_query_cancellation_does_not_change_version(bump):
    error = asyncio.CancelledError()
    ns, _ = load_migrations(error=error)
    ns["bump_version"] = AsyncMock()
    ns["lower_version"] = AsyncMock()
    with pytest.raises(asyncio.CancelledError) as caught:
        await ns["AsyncMigration"]("RETURN true;").run(bump=bump)
    assert caught.value is error
    ns["bump_version"].assert_not_awaited()
    ns["lower_version"].assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["speaker_profile", "episode_profile", "episode"])
async def test_podcast_preflight_rejects_existing_schema_before_writes(table):
    ns, connection = load_migrations(
        {
            "result": [
                {"status": "OK", "result": {"tables": {table: "private schema"}}},
                {"status": "OK", "result": []},
            ]
        }
    )
    ns["bump_version"] = AsyncMock()
    with pytest.raises(RuntimeError, match="manual review"):
        await ns["PodcastProfileMigration"]("CREATE should_not_run;").run()
    assert connection.query_raw.await_count == 1
    assert "CREATE" not in connection.query_raw.await_args.args[0]
    ns["bump_version"].assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "results",
    [[], [{}], [{"tables": []}, []], [{"tables": {}}, {}], [{"tables": {}}, [], []]],
)
async def test_podcast_preflight_rejects_malformed_state(results):
    ns, _ = load_migrations(
        {"result": [{"status": "OK", "result": value} for value in results]}
    )
    ns["bump_version"] = AsyncMock()
    with pytest.raises(RuntimeError):
        await ns["PodcastProfileMigration"]("CREATE should_not_run;").run()
    ns["bump_version"].assert_not_awaited()


@pytest.mark.asyncio
async def test_podcast_preflight_legacy_config_has_safe_operator_message():
    ns, connection = load_migrations(
        {
            "result": [
                {"status": "OK", "result": {"tables": {"podcast_config": "schema"}}},
                {"status": "OK", "result": [{"private": "synthetic-private-value"}]},
            ]
        }
    )
    with pytest.raises(RuntimeError, match="manual review") as caught:
        await ns["PodcastProfileMigration"]("CREATE should_not_run;").run()
    assert "synthetic-private-value" not in str(caught.value)
    assert connection.query_raw.await_count == 1


def test_evidence_vector_migration_is_registered_and_derived_only():
    root = Path(__file__).parents[1]
    up = root / "open_notebook/database/migrations/31.surrealql"
    down = root / "open_notebook/database/migrations/31_down.surrealql"
    assert up.is_file() and down.is_file()
    sql, rollback = up.read_text(), down.read_text()
    for table in (
        "evidence_embedding_profile",
        "evidence_embedding_scope",
        "evidence_embedding_attempt",
        "evidence_embedding_manifest",
        "evidence_embedding_vector",
    ):
        assert f"DEFINE TABLE {table}" in sql
        assert f"REMOVE TABLE {table}" in rollback
    assert "HNSW" not in sql and "MTREE" not in sql
    assert "DEFINE INDEX" in sql
    assert "v1_evidence" not in rollback and "v1_version" not in rollback
    ns, _ = load_migrations()
    manager = ns["AsyncMigrationManager"]()
    assert len(manager.up_migrations) == len(manager.down_migrations) == 31
