"""Actual credential migration HTTP route with its service substituted."""

import pytest


@pytest.fixture()
def client():
    """Test client mirroring tests/test_credentials_api.py."""
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def test_migrate_endpoint_returns_summary(client):
    """POST /api/credentials/migrate-encryption surfaces the service summary."""
    from unittest.mock import AsyncMock, patch

    summary = {"message": "done", "migrated": ["a"], "skipped": [], "errors": []}
    with patch(
        "api.routers.credentials.svc_migrate_encryption_scheme",
        AsyncMock(return_value=summary),
    ):
        response = client.post("/api/credentials/migrate-encryption")

    assert response.status_code == 200
    assert response.json() == summary


def test_migrate_endpoint_missing_key_is_bad_request(client):
    """A missing encryption key surfaces as 400, not 500."""
    from unittest.mock import AsyncMock, patch

    with patch(
        "api.routers.credentials.svc_migrate_encryption_scheme",
        AsyncMock(side_effect=ValueError("Encryption key not configured.")),
    ):
        response = client.post("/api/credentials/migrate-encryption")

    assert response.status_code == 400
