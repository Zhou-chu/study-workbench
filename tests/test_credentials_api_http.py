"""Actual credential TestClient routes with synthetic repository inputs."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client after environment variables have been cleared by conftest."""
    from api.main import app

    return TestClient(app)


class TestCredentialCascadeDelete:
    """Tests for #651 - deleting credential cascade-deletes linked models."""

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_cascade_delete_linked_models(self, mock_get, client):
        """Deleting credential without options cascade-deletes linked models."""
        mock_model1 = AsyncMock()
        mock_model1.id = "model:1"
        mock_model1.provider = "openai"
        mock_model1.name = "gpt-4"

        mock_model2 = AsyncMock()
        mock_model2.id = "model:2"
        mock_model2.provider = "openai"
        mock_model2.name = "gpt-3.5-turbo"

        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(return_value=[mock_model1, mock_model2])
        mock_cred.delete = AsyncMock()
        mock_get.return_value = mock_cred

        response = client.delete("/api/credentials/cred:123")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 2
        assert data["message"] == "Credential deleted successfully"

        mock_model1.delete.assert_awaited_once()
        mock_model2.delete.assert_awaited_once()
        mock_cred.delete.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_delete_credential_no_linked_models(self, mock_get, client):
        """Deleting credential with no linked models works cleanly."""
        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(return_value=[])
        mock_cred.delete = AsyncMock()
        mock_get.return_value = mock_cred

        response = client.delete("/api/credentials/cred:123")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 0
        mock_cred.delete.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_migrate_models_instead_of_delete(self, mock_get, client):
        """Passing migrate_to reassigns models instead of deleting them."""
        mock_model = AsyncMock()
        mock_model.id = "model:1"
        mock_model.credential = "cred:123"
        mock_model.save = AsyncMock()

        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(return_value=[mock_model])
        mock_cred.delete = AsyncMock()

        mock_target_cred = AsyncMock()
        mock_target_cred.id = "cred:456"

        # First call returns cred to delete, second returns target
        mock_get.side_effect = [mock_cred, mock_target_cred]

        response = client.delete("/api/credentials/cred:123?migrate_to=cred:456")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 0  # Models were migrated, not deleted
        mock_model.save.assert_awaited_once()
        assert mock_model.credential == "cred:456"
        mock_cred.delete.assert_awaited_once()


class TestCredentialUpdateClearsFields:
    """PUT /credentials/{id} must distinguish 'field absent' (keep) from
    'field explicitly null/empty' (clear).

    The handler used `is not None` guards, so an explicit null sent to clear
    base_url (or the Vertex project/location/credentials_path) was silently
    ignored — the old value survived while the client saw success. Found in
    v1.11 release testing: an Ollama credential kept pointing at a stale IP
    after the user cleared the field. Now keyed on model_fields_set.
    """

    def _mock_cred(self):
        from unittest.mock import MagicMock

        cred = MagicMock()
        cred.base_url = "http://10.0.0.99:11434"
        cred.credentials_path = "/old/path.json"
        cred.save = AsyncMock()
        cred.get_linked_models = AsyncMock(return_value=[])
        return cred

    def _put(self, client, cred, body):
        from api.models import CredentialResponse

        fake_response = CredentialResponse(
            id="credential:1",
            name="n",
            provider="ollama",
            modalities=["language"],
            has_api_key=False,
            created="2026-01-01",
            updated="2026-01-01",
            model_count=0,
        )
        with (
            patch("api.routers.credentials.require_encryption_key"),
            patch(
                "api.routers.credentials.Credential.get",
                new=AsyncMock(return_value=cred),
            ),
            patch(
                "api.routers.credentials.credential_to_response",
                return_value=fake_response,
            ),
        ):
            return client.put("/api/credentials/credential:1", json=body)

    def test_explicit_null_clears_base_url(self, client):
        cred = self._mock_cred()
        response = self._put(client, cred, {"base_url": None})
        assert response.status_code == 200
        assert cred.base_url is None
        cred.save.assert_awaited_once()

    def test_empty_string_clears_base_url(self, client):
        cred = self._mock_cred()
        response = self._put(client, cred, {"base_url": ""})
        assert response.status_code == 200
        assert cred.base_url is None

    def test_absent_field_keeps_old_value(self, client):
        cred = self._mock_cred()
        response = self._put(client, cred, {"name": "renamed"})
        assert response.status_code == 200
        assert cred.base_url == "http://10.0.0.99:11434"

    def test_null_clears_vertex_credentials_path(self, client):
        cred = self._mock_cred()
        response = self._put(client, cred, {"credentials_path": None})
        assert response.status_code == 200
        assert cred.credentials_path is None
