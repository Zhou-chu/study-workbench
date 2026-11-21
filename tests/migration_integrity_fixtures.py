"""Load trusted migration definitions from source with a synthetic database."""

import ast
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, Mock


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
