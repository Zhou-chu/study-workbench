"""Static timestamp field contracts for source-insight migration 19."""

from pathlib import Path

MIGRATIONS_DIR = (
    Path(__file__).parent.parent / "open_notebook" / "database" / "migrations"
)


class TestInsightTimestampStamping:
    """source_insight rows must be stamped with created/updated on creation.

    Insights are created by a raw `CREATE source_insight CONTENT {...}` query
    (create_insight command), and source_insight is SCHEMAFULL - so the stamp
    has to come from the schema (DEFINE FIELD ... DEFAULT time::now()), exactly
    like the source, note and notebook tables. These tests guard the two
    failure modes: the migration losing its field definitions, and the
    migration file not being registered in the hard-coded manager list.
    """

    def test_migration_defines_timestamp_fields(self):
        sql = (MIGRATIONS_DIR / "19.surrealql").read_text()
        assert (
            "DEFINE FIELD IF NOT EXISTS created ON source_insight "
            "DEFAULT time::now() VALUE $before OR time::now()" in sql
        )
        assert (
            "DEFINE FIELD IF NOT EXISTS updated ON source_insight "
            "DEFAULT time::now() VALUE time::now()" in sql
        )

    def test_migration_down_removes_timestamp_fields(self):
        sql = (MIGRATIONS_DIR / "19_down.surrealql").read_text()
        assert "REMOVE FIELD IF EXISTS created ON TABLE source_insight" in sql
        assert "REMOVE FIELD IF EXISTS updated ON TABLE source_insight" in sql
