"""Load and verify on-disk search migration assets and registration."""

from pathlib import Path

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


class TestMigration24:
    """Migration 24 adds the optional notebook scope to both search functions
    and is registered in AsyncMigrationManager (migrations are hard-coded,
    not auto-discovered)."""

    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "24.surrealql").is_file()
        assert (MIGRATIONS_DIR / "24_down.surrealql").is_file()

    def test_manager_registers_migration_24(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 24
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "$notebook_ids" in manager.up_migrations[23].sql
        assert "$notebook_ids" not in manager.down_migrations[23].sql

    def test_up_adds_optional_scope_to_both_functions(self):
        sql = (MIGRATIONS_DIR / "24.surrealql").read_text()
        scope_param = "$notebook_ids: option<array<record<notebook>>>"

        assert sql.count("REMOVE FUNCTION IF EXISTS fn::text_search") == 1
        assert sql.count("REMOVE FUNCTION IF EXISTS fn::vector_search") == 1
        assert sql.count(scope_param) == 2
        # Trailing + optional: the previous 4-/5-argument calls keep working.
        assert f"$show_notes: bool, {scope_param})" in sql
        assert f"$min_similarity: float, {scope_param})" in sql
        # Sources follow the `reference` edge, notes the `artifact` edge.
        assert "FROM reference WHERE out IN $notebook_ids" in sql
        assert "FROM artifact WHERE out IN $notebook_ids" in sql
        # Empty or absent scope must keep the unfiltered path.
        assert "$notebook_ids != NONE AND array::len($notebook_ids) > 0" in sql

    def test_down_restores_unscoped_signatures(self):
        sql = (MIGRATIONS_DIR / "24_down.surrealql").read_text()

        assert "$notebook_ids" not in sql
        assert "$match_count: int, $sources:bool, $show_notes:bool)" in sql
        assert "$show_notes: bool, $min_similarity: float)" in sql
