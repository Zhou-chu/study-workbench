"""SQL-bound authorization fake for legacy grounded-service fixtures."""

from test_workbench_hybrid_retrieval import RetrievalDatabase


def install_scope_database(monkeypatch, store, tmp_path, notebook_id):
    database = RetrievalDatabase(store)
    database.members = {
        value["source_id"]
        for (kind, _), value in store.data.items()
        if kind == "version" and value["notebook_id"] == notebook_id
    }

    async def query(sql, params=None):
        params = params or {}
        if "scope-notebook" in sql:
            return (
                [{"id": notebook_id}]
                if str(params["notebook_target"]) == notebook_id
                else []
            )
        if "scope-membership" in sql:
            return [
                {"in": identity, "out": notebook_id} for identity in database.members
            ]
        rows = await database.query(sql, params)
        if "canonical-evidence" in sql:
            for row in rows:
                row["notebook_id"] = notebook_id
        return rows

    monkeypatch.setattr(
        "open_notebook.database.evidence_embedding_repository.repo_query", query
    )
    monkeypatch.setattr(
        "open_notebook.database.project_locks.data_root", lambda: tmp_path
    )
    return database
