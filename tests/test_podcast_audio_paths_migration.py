"""On-disk migration 21 assets and actual migration-manager registration."""

from pathlib import Path


class TestMigration21Registration:
    """Migration files exist and are registered in AsyncMigrationManager
    (migrations are hard-coded, not auto-discovered)."""

    MIGRATIONS_DIR = Path("open_notebook/database/migrations")

    def test_migration_files_exist(self):
        assert (self.MIGRATIONS_DIR / "21.surrealql").is_file()
        assert (self.MIGRATIONS_DIR / "21_down.surrealql").is_file()

    def test_manager_registers_migration_21(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 21
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "podcasts/" in manager.up_migrations[20].sql

    def test_up_migration_strips_known_prefixes_only(self):
        sql = (self.MIGRATIONS_DIR / "21.surrealql").read_text()
        for prefix in (
            "file:///",
            "/app/data/podcasts/",
            "/data/podcasts/",
            "./data/podcasts/",
            "data/podcasts/",
        ):
            assert f'"{prefix}"' in sql, f"expected conversion of prefix {prefix}"
        # Prefix-strip lengths must match the prefixes they guard.
        assert "string::slice(audio_file, 7)" in sql  # len("file://"), keeps "/"
        assert "string::slice(audio_file, 19)" in sql  # len("/app/data/podcasts/")
        assert "string::slice(audio_file, 15)" in sql  # len("/data/podcasts/")
        assert "string::slice(audio_file, 16)" in sql  # len("./data/podcasts/")
        assert "string::slice(audio_file, 14)" in sql  # len("data/podcasts/")
        # Percent-encoded file:// URIs cannot be URL-decoded in SurrealQL and
        # must stay untouched (legacy-invalid).
        assert '!string::contains(audio_file, "%")' in sql
        # Root prefixes are stripped through ONE IF/ELSE chain so a stripped
        # remainder can never be stripped a second time.
        assert sql.count("UPDATE episode") == 2
