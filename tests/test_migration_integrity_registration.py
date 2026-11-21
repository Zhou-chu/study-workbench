"""Read migration SQL and verify actual manager registration without a database."""

from pathlib import Path

from migration_integrity_fixtures import load_migrations


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
