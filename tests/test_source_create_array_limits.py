"""Source array parsing through the FastAPI form endpoint."""

import pytest
from source_create_array_fixtures import make_ids


class TestFormParsingReturns422:
    """The multipart form path builds SourceCreate manually in
    parse_source_form_data(), so pydantic's ValidationError doesn't go
    through FastAPI's request-validation handler — without an explicit
    catch it surfaced as a 500. These hit the real endpoint and assert
    the client gets a clean 422 instead (found in v1.11 release testing).
    """

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from api.main import app

        return TestClient(app)

    def test_51_notebooks_via_form_returns_422(self, client):
        import json as _json

        response = client.post(
            "/api/sources",
            data={
                "type": "text",
                "content": "probe",
                "notebooks": _json.dumps(make_ids(51, "notebook")),
            },
        )
        assert response.status_code == 422
        assert "Invalid source data" in response.json()["detail"]

    def test_invalid_notebooks_json_returns_422(self, client):
        response = client.post(
            "/api/sources",
            data={"type": "text", "content": "probe", "notebooks": "not-json["},
        )
        assert response.status_code == 422
        assert "notebooks" in response.json()["detail"]

    def test_invalid_transformations_json_returns_422(self, client):
        response = client.post(
            "/api/sources",
            data={"type": "text", "content": "probe", "transformations": "]bad"},
        )
        assert response.status_code == 422
        assert "transformations" in response.json()["detail"]
