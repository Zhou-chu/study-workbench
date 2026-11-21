"""
Async migration system for SurrealDB using the official Python client.
Based on patterns from sblpy migration system.
"""

from typing import List

from loguru import logger

from .repository import db_connection


async def _query_checked(sql: str, variables: dict | None = None) -> list:
    """Keep and validate every statement acknowledgement from the raw SDK RPC.

    SDK query() returns only the first statement's result, hiding later errors.
    Do not count statements by splitting SQL: migrations contain nested bodies.
    """
    async with db_connection() as connection:
        response = await connection.query_raw(sql, variables)
    if not isinstance(response, dict) or response.get("error") is not None:
        raise RuntimeError("Migration query failed or returned an invalid response")
    statements = response.get("result")
    if not isinstance(statements, list) or not statements:
        raise RuntimeError("Migration query returned no statement acknowledgements")
    for index, statement in enumerate(statements, start=1):
        if (
            not isinstance(statement, dict)
            or statement.get("status") != "OK"
            or "result" not in statement
        ):
            # Avoid including SQL or server payloads that may contain user data.
            raise RuntimeError(
                f"Migration statement {index} failed or was not acknowledged"
            )
    return [statement["result"] for statement in statements]


class AsyncMigration:
    """
    Handles individual migration operations with async support.
    """

    def __init__(self, sql: str) -> None:
        """Initialize migration with SQL content."""
        self.sql = sql

    @classmethod
    def from_file(cls, file_path: str) -> "AsyncMigration":
        """Create migration from SQL file."""
        with open(file_path, "r", encoding="utf-8") as file:
            raw_content = file.read()
            # Clean up SQL content
            lines = []
            for line in raw_content.split("\n"):
                line = line.strip()
                if line and not line.startswith("--"):
                    lines.append(line)
            sql = " ".join(lines)
            return cls(sql)

    async def run(self, bump: bool = True) -> None:
        """Run the migration."""
        try:
            await _query_checked(self.sql)

            if bump:
                await bump_version()
            else:
                await lower_version()

        except Exception as e:
            logger.error(f"Migration failed: {str(e)}")
            raise


class PodcastProfileMigration(AsyncMigration):
    """Migration 7 only: unknown legacy schemas require an operator decision.

    SurrealDB 2.3 cannot use INFO inside an expression. Inspect it read-only
    before submitting any writes; the SQL transaction independently rejects
    existing records and existing tables (including a concurrent creator).
    """

    async def run(self, bump: bool = True) -> None:
        results = await _query_checked(
            "INFO FOR DB; SELECT * FROM podcast_config LIMIT 1;"
        )
        if (
            len(results) != 2
            or not isinstance(results[0], dict)
            or not isinstance(results[0].get("tables"), dict)
            or not isinstance(results[1], list)
        ):
            raise RuntimeError("Migration 7 preflight could not verify database state")
        tables = results[0]["tables"]
        if {"speaker_profile", "episode_profile", "episode"}.intersection(
            tables
        ) or results[1]:
            raise RuntimeError(
                "Migration 7 requires manual review of existing podcast data or schema. "
                "No migration-7 writes were submitted. Back up the database and "
                "review a data-preserving conversion on a copy before upgrading; "
                "do not delete tables or mark the migration complete to bypass this check."
            )
        await super().run(bump=bump)


class AsyncMigrationRunner:
    """
    Handles running multiple migrations in sequence.
    """

    def __init__(
        self,
        up_migrations: List[AsyncMigration],
        down_migrations: List[AsyncMigration],
    ) -> None:
        """Initialize runner with migration lists."""
        self.up_migrations = up_migrations
        self.down_migrations = down_migrations

    async def run_all(self) -> None:
        """Run all pending up migrations."""
        current_version = await get_latest_version()

        for i in range(current_version, len(self.up_migrations)):
            logger.info(f"Running migration {i + 1}")
            await self.up_migrations[i].run(bump=True)

    async def run_one_up(self) -> None:
        """Run one up migration."""
        current_version = await get_latest_version()

        if current_version < len(self.up_migrations):
            logger.info(f"Running migration {current_version + 1}")
            await self.up_migrations[current_version].run(bump=True)

    async def run_one_down(self) -> None:
        """Run one down migration."""
        current_version = await get_latest_version()

        if current_version > 0:
            logger.info(f"Rolling back migration {current_version}")
            await self.down_migrations[current_version - 1].run(bump=False)


class AsyncMigrationManager:
    """
    Main migration manager with async support.
    """

    def __init__(self):
        """Initialize migration manager."""
        # The registered migrations are an explicit, contiguous release sequence.
        # Do not discover files: an extra file does not enroll a migration.
        versions = range(1, 32)
        directory = "open_notebook/database/migrations"
        self.up_migrations = [
            (PodcastProfileMigration if version == 7 else AsyncMigration).from_file(
                f"{directory}/{version}.surrealql"
            )
            for version in versions
        ]
        self.down_migrations = [
            AsyncMigration.from_file(f"{directory}/{version}_down.surrealql")
            for version in versions
        ]
        self.runner = AsyncMigrationRunner(
            up_migrations=self.up_migrations,
            down_migrations=self.down_migrations,
        )

    async def get_current_version(self) -> int:
        """Get current database version."""
        return await get_latest_version()

    async def ping(self) -> None:
        """Check whether SurrealDB is reachable for migration startup."""
        async with db_connection() as connection:
            await connection.query("RETURN true;")

        # Also exercise the migration version path. get_current_version() already
        # accepts successful empty history as version 0 for fresh databases.
        await self.get_current_version()

    async def needs_migration(self) -> bool:
        """Check if migration is needed."""
        current_version = await self.get_current_version()
        return current_version < len(self.up_migrations)

    async def run_migration_up(self):
        """Run all pending migrations."""
        current_version = await self.get_current_version()
        logger.info(f"Current version before migration: {current_version}")

        if await self.needs_migration():
            try:
                await self.runner.run_all()
                new_version = await self.get_current_version()
                logger.info(f"Migration successful. New version: {new_version}")
            except Exception as e:
                logger.error(f"Migration failed: {str(e)}")
                raise
        else:
            logger.info("Database is already at the latest version")


# Database version management functions
async def get_latest_version() -> int:
    """Get the latest version from the migrations table."""
    versions = await get_all_versions()
    return max((version["version"] for version in versions), default=0)


async def get_all_versions() -> List[dict]:
    """Read valid history; errors must never be mistaken for a fresh database.

    SurrealDB 2.3.10 in default non-strict mode returns a successful empty list
    for a missing namespace/database/table. Strict-mode absence errors are not
    suppressed; those deployments must provision their database explicitly.
    """
    results = await _query_checked("SELECT * FROM _sbl_migrations ORDER BY version;")
    if len(results) != 1 or not isinstance(results[0], list):
        raise RuntimeError("Invalid migration version query result")
    versions = results[0]
    for row in versions:
        if (
            not isinstance(row, dict)
            or type(row.get("version")) is not int
            or row["version"] <= 0
        ):
            raise RuntimeError("Invalid migration version history")
    return versions


async def bump_version() -> None:
    """Bump the version by adding a new entry to migrations table."""
    current_version = await get_latest_version()
    new_version = current_version + 1

    await _query_checked(
        "CREATE type::thing('_sbl_migrations', $version) SET version = $version, applied_at = time::now();",
        {"version": new_version},
    )


async def lower_version() -> None:
    """Lower the version by removing the latest entry from migrations table."""
    current_version = await get_latest_version()
    if current_version > 0:
        await _query_checked(
            "DELETE type::thing('_sbl_migrations', $version);",
            {"version": current_version},
        )
