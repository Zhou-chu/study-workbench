"""Load migration 22 through the actual migration manager without starting a database."""

from pathlib import Path

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


class TestMigration22Registration:
    """Migration files exist and are registered in AsyncMigrationManager
    (migrations are hard-coded, not auto-discovered)."""

    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "22.surrealql").is_file()
        assert (MIGRATIONS_DIR / "22_down.surrealql").is_file()

    def test_manager_registers_migration_22(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 22
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert (
            "REMOVE FIELD IF EXISTS outline_provider" in manager.up_migrations[21].sql
        )
