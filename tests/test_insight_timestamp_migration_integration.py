"""Check migration 19 is read and registered by the real migration manager."""


def test_migration_is_registered_in_manager():
    """Migrations are hard-coded in AsyncMigrationManager, not discovered."""
    from open_notebook.database.async_migrate import AsyncMigrationManager

    manager = AsyncMigrationManager()
    # up and down lists must stay in sync and include migration 19
    assert len(manager.up_migrations) >= 19
    assert len(manager.up_migrations) == len(manager.down_migrations)
    assert "created ON source_insight" in manager.up_migrations[18].sql
    assert "updated ON source_insight" in manager.up_migrations[18].sql
