"""Test source insight timestamp serialization through the HTTP endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.notebook import Source, SourceInsight


@pytest.fixture
def client():
    """Create test client after environment variables have been cleared by conftest."""
    from api.main import app

    return TestClient(app)


def _insight(created=None, updated=None) -> SourceInsight:
    return SourceInsight(
        id="source_insight:abc",
        insight_type="summary",
        content="Some insight",
        created=created,
        updated=updated,
    )


def _source() -> Source:
    return Source(id="source:xyz", title="A source")


class TestInsightTimestampSerialization:
    """API must emit null for missing timestamps and ISO strings otherwise."""

    @patch("api.routers.insights.SourceInsight.get", new_callable=AsyncMock)
    def test_get_insight_absent_timestamps_are_null(self, mock_get, client):
        insight = _insight()
        mock_get.return_value = insight

        with patch.object(
            SourceInsight, "get_source", new_callable=AsyncMock
        ) as mock_source:
            mock_source.return_value = _source()
            response = client.get("/api/insights/source_insight:abc")

        assert response.status_code == 200
        body = response.json()
        assert body["created"] is None
        assert body["updated"] is None

    @patch("api.routers.insights.SourceInsight.get", new_callable=AsyncMock)
    def test_get_insight_present_timestamps_are_iso(self, mock_get, client):
        ts = datetime(2026, 7, 11, 12, 30, 45, tzinfo=timezone.utc)
        mock_get.return_value = _insight(created=ts, updated=ts)

        with patch.object(
            SourceInsight, "get_source", new_callable=AsyncMock
        ) as mock_source:
            mock_source.return_value = _source()
            response = client.get("/api/insights/source_insight:abc")

        assert response.status_code == 200
        body = response.json()
        assert body["created"] == "2026-07-11T12:30:45+00:00"
        assert body["updated"] == "2026-07-11T12:30:45+00:00"

    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    def test_list_source_insights_never_serializes_the_string_none(
        self, mock_get, client
    ):
        ts = datetime(2026, 7, 11, 12, 30, 45, tzinfo=timezone.utc)
        source = _source()
        mock_get.return_value = source

        with patch.object(
            Source, "get_insights", new_callable=AsyncMock
        ) as mock_insights:
            mock_insights.return_value = [
                _insight(),  # legacy row without timestamps
                _insight(created=ts, updated=ts),  # stamped row
            ]
            response = client.get("/api/sources/source:xyz/insights")

        assert response.status_code == 200
        body = response.json()
        assert body[0]["created"] is None
        assert body[0]["updated"] is None
        assert body[1]["created"] == "2026-07-11T12:30:45+00:00"
        assert body[1]["updated"] == "2026-07-11T12:30:45+00:00"
        for row in body:
            assert row["created"] != "None"
            assert row["updated"] != "None"
