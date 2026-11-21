"""Direct native web-source creation with mocked persistence boundaries."""

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_native_source_creation_uses_explicit_create_not_update(monkeypatch):
    from api.web_discovery_service import _ensure_native_source
    from open_notebook.exceptions import NotFoundError

    query = AsyncMock(return_value=[])
    relate = AsyncMock()
    monkeypatch.setattr("open_notebook.domain.notebook.Notebook.get", AsyncMock())
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Source.get",
        AsyncMock(side_effect=NotFoundError("absent")),
    )
    monkeypatch.setattr("open_notebook.database.repository.repo_query", query)
    monkeypatch.setattr("open_notebook.database.repository.repo_relate", relate)
    await _ensure_native_source(
        "notebook:a", "source:web_test", "Title", "https://example.com/"
    )
    assert query.await_args_list[0].args[0].startswith("CREATE $source")
    relate.assert_awaited_once()
