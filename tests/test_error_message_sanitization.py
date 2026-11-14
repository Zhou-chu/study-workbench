"""
Tests that internal exception text is never leaked to API clients in
api/routers/sources.py and api/podcast_service.py.

These previously interpolated the raw exception (`detail=f"...: {str(e)}"`)
into the client-facing error response - inconsistent with the safer pattern
already used elsewhere in the same files (e.g. the download handlers),
which log the raw exception server-side but return a fixed generic
message. Every occurrence already had a matching logger.error() call, so
this was a client-facing message change only, not a logging change.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

SECRET = "connection to db-primary-7f3a.internal:5432 refused: password authentication failed"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestSourcesRouterDoesNotLeakExceptionText:
    def test_list_sources_failure_returns_generic_message(self, client):
        with patch(
            "api.routers.sources.repo_query",
            new=AsyncMock(side_effect=RuntimeError(SECRET)),
        ):
            response = client.get("/api/sources")

        assert response.status_code == 500
        assert SECRET not in response.text
        assert response.json()["detail"] == "Error fetching sources"

    def test_delete_source_failure_returns_generic_message(self, client):
        mock_source = AsyncMock()
        mock_source.delete = AsyncMock(side_effect=RuntimeError(SECRET))

        with patch(
            "api.routers.sources.Source.get", new=AsyncMock(return_value=mock_source)
        ):
            response = client.delete("/api/sources/source:abc123")

        assert response.status_code == 500
        assert SECRET not in response.text
        assert response.json()["detail"] == "Error deleting source"

    def test_get_source_insights_failure_returns_generic_message(self, client):
        mock_source = AsyncMock()
        mock_source.get_insights = AsyncMock(side_effect=RuntimeError(SECRET))

        with patch(
            "api.routers.sources.Source.get", new=AsyncMock(return_value=mock_source)
        ):
            response = client.get("/api/sources/source:abc123/insights")

        assert response.status_code == 500
        assert SECRET not in response.text
        assert response.json()["detail"] == "Error fetching insights"

    def test_update_source_failure_returns_generic_message(self, client):
        mock_source = AsyncMock()
        mock_source.asset = None

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=mock_source),
            ),
            patch(
                "api.routers.sources.repo_update",
                new=AsyncMock(side_effect=RuntimeError(SECRET)),
            ) as update,
        ):
            response = client.put(
                "/api/sources/source:abc123", json={"title": "New Title"}
            )

        update.assert_awaited_once_with(
            "source", "source:abc123", {"title": "New Title"}
        )
        assert response.status_code == 500
        assert SECRET not in response.text
        assert response.json()["detail"] == "Error updating source"


class TestInvalidInputErrorsStillReturnTheirOwnSafeMessage:
    """InvalidInputError is a distinct, deliberate pattern (app-authored,
    user-facing validation text) - not the raw-exception-leak pattern this
    fix targets, and must be untouched."""

    def test_update_source_invalid_input_still_returns_its_message(self, client):
        from open_notebook.exceptions import InvalidInputError

        mock_source = AsyncMock()
        mock_source.asset = None

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=mock_source),
            ),
            patch(
                "api.routers.sources.repo_update",
                new=AsyncMock(side_effect=InvalidInputError("Title cannot be empty")),
            ) as update,
        ):
            response = client.put("/api/sources/source:abc123", json={"title": "x"})

        update.assert_awaited_once_with("source", "source:abc123", {"title": "x"})
        assert response.status_code == 400
        assert response.json()["detail"] == "Title cannot be empty"
