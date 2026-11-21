"""Exercise provider registry metadata and credential validation through HTTP."""

import pytest
from fastapi.testclient import TestClient

from open_notebook.ai.provider_registry import PROVIDERS


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestProvidersEndpoint:
    def test_get_providers_returns_registry_metadata(self, client):
        response = client.get("/api/providers")
        assert response.status_code == 200
        data = response.json()
        # The frontend renders providers in response order, so the endpoint
        # must preserve the registry declaration order (the display order).
        assert [p["name"] for p in data] == list(PROVIDERS.keys())

        openai = next(p for p in data if p["name"] == "openai")
        assert openai["display_name"] == "OpenAI"
        assert "language" in openai["modalities"]
        assert openai["docs_url"].startswith("https://")
        assert isinstance(openai["env_configured"], bool)


class TestCreateCredentialEndpointRejectsBadProvider:
    def test_post_credentials_with_bogus_provider_returns_422(self, client):
        response = client.post(
            "/api/credentials",
            json={"name": "Test", "provider": "not_a_real_provider"},
        )
        assert response.status_code == 422

    def test_post_credentials_with_valid_provider_passes_validation(
        self, client, monkeypatch
    ):
        """Doesn't assert overall success - just that a valid provider clears
        the 422 validation gate and reaches actual route logic.

        The encryption-key gate is forced to fail so the request never reaches
        the persistence layer: without this, running the suite with a real
        `.env` (SURREAL_URL + encryption key set) wrote a "Test" credential to
        the live dev database on every run.
        """
        from api.routers import credentials as credentials_router

        def _no_key():
            raise ValueError("encryption key intentionally absent in tests")

        monkeypatch.setattr(credentials_router, "require_encryption_key", _no_key)
        response = client.post(
            "/api/credentials",
            json={"name": "Test", "provider": "openai", "api_key": "sk-test"},
        )
        # Provider validation happens before the route body runs; the forced
        # key failure maps to a non-422 error, proving validation was cleared
        # without persisting anything.
        assert response.status_code != 422
