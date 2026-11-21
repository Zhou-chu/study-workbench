"""On-disk speaker migration schema and actual migration manager registration."""


class TestMigration20:
    """Migration 20 converts speaker_config from name string to record link.

    Migrations are hard-coded in AsyncMigrationManager, not discovered, so
    these tests guard both the SQL content and the registration."""

    def test_migration_converts_names_and_tightens_type(self):
        from pathlib import Path

        sql = (
            Path(__file__).parent.parent
            / "open_notebook"
            / "database"
            / "migrations"
            / "20.surrealql"
        ).read_text()
        assert (
            "UPDATE episode_profile SET speaker_config = "
            "(SELECT VALUE id FROM ONLY speaker_profile "
            "WHERE name = $parent.speaker_config LIMIT 1) "
            "WHERE type::is::string(speaker_config)" in sql
        )
        assert (
            "DEFINE FIELD OVERWRITE speaker_config ON TABLE episode_profile "
            "TYPE option<record<speaker_profile>>" in sql
        )

    def test_migration_down_restores_names(self):
        from pathlib import Path

        sql = (
            Path(__file__).parent.parent
            / "open_notebook"
            / "database"
            / "migrations"
            / "20_down.surrealql"
        ).read_text()
        assert (
            "UPDATE episode_profile SET speaker_config = speaker_config.name "
            "WHERE type::is::record(speaker_config)" in sql
        )
        assert (
            "DEFINE FIELD OVERWRITE speaker_config ON TABLE episode_profile "
            "TYPE option<string>" in sql
        )

    def test_migration_is_registered_in_manager(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 20
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "speaker_config" in manager.up_migrations[19].sql
        assert "option<record<speaker_profile>>" in manager.up_migrations[19].sql
        assert "speaker_config.name" in manager.down_migrations[19].sql
