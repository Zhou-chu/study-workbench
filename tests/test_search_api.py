from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client after environment variables have been cleared by conftest."""
    from api.main import app

    return TestClient(app)


class TestSearchLimitValidation:
    """SearchRequest.limit must reject non-positive values (#863)."""

    @pytest.mark.parametrize("bad_limit", [0, -1, -100])
    def test_non_positive_limit_returns_422(self, bad_limit, client):
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "text", "limit": bad_limit},
        )
        assert response.status_code == 422

    def test_limit_above_max_returns_422(self, client):
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "text", "limit": 1001},
        )
        assert response.status_code == 422

    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_valid_limit_returns_200(self, mock_text_search, client):
        mock_text_search.return_value = []
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "text", "limit": 10},
        )
        assert response.status_code == 200
        mock_text_search.assert_awaited_once()


def _found(*ids):
    return [{"id": nb_id} for nb_id in ids]


class TestNotebookScopedSearchApi:
    """POST /api/search accepts a notebook scope and forwards it (#574, #87)."""

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_notebook_ids_are_forwarded_to_text_search(
        self, mock_text_search, mock_query, client
    ):
        mock_query.return_value = _found("notebook:a", "notebook:b")
        mock_text_search.return_value = []
        response = client.post(
            "/api/search",
            json={
                "query": "x",
                "type": "text",
                "notebook_ids": ["notebook:a", "notebook:b"],
            },
        )
        assert response.status_code == 200
        assert mock_text_search.await_args is not None
        assert mock_text_search.await_args.kwargs["notebook_ids"] == [
            "notebook:a",
            "notebook:b",
        ]
        # Existence is checked with a single query for the whole scope.
        mock_query.assert_awaited_once()

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch(
        "api.routers.search.model_manager.get_embedding_model", new_callable=AsyncMock
    )
    @patch("api.routers.search.vector_search", new_callable=AsyncMock)
    def test_single_notebook_id_is_forwarded_to_vector_search(
        self, mock_vector_search, mock_embedding, mock_query, client
    ):
        """`notebook_id` (the #574 shape, already sent by clients) is honored too."""
        mock_query.return_value = _found("notebook:a")
        mock_embedding.return_value = object()
        mock_vector_search.return_value = []
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "vector", "notebook_id": "notebook:a"},
        )
        assert response.status_code == 200
        assert mock_vector_search.await_args is not None
        assert mock_vector_search.await_args.kwargs["notebook_ids"] == ["notebook:a"]

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_no_scope_means_global_search(self, mock_text_search, mock_query, client):
        mock_text_search.return_value = []
        response = client.post("/api/search", json={"query": "x", "type": "text"})
        assert response.status_code == 200
        assert mock_text_search.await_args is not None
        assert mock_text_search.await_args.kwargs["notebook_ids"] == []
        mock_query.assert_not_awaited()

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_unknown_notebook_returns_404(self, mock_text_search, mock_query, client):
        mock_query.return_value = _found("notebook:a")
        response = client.post(
            "/api/search",
            json={
                "query": "x",
                "type": "text",
                "notebook_ids": ["notebook:a", "notebook:zzz"],
            },
        )
        assert response.status_code == 404
        assert "notebook:zzz" in response.json()["detail"]
        mock_text_search.assert_not_awaited()

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_database_failure_during_scope_check_is_not_a_404(
        self, mock_text_search, mock_query, client
    ):
        mock_query.side_effect = RuntimeError("connection refused ws://db:8000")
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "text", "notebook_ids": ["notebook:a"]},
        )
        assert response.status_code == 500
        # The raw driver error stays in the server log, not in the response.
        assert "ws://db:8000" not in response.text
        mock_text_search.assert_not_awaited()

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_non_notebook_id_returns_400(self, mock_text_search, mock_query, client):
        response = client.post(
            "/api/search",
            json={"query": "x", "type": "text", "notebook_ids": ["source:abc"]},
        )
        assert response.status_code == 400
        mock_query.assert_not_awaited()
        mock_text_search.assert_not_awaited()

    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    @patch("api.routers.search.text_search", new_callable=AsyncMock)
    def test_empty_notebook_id_is_rejected_not_widened(
        self, mock_text_search, mock_query, client
    ):
        response = client.post(
            "/api/search", json={"query": "x", "type": "text", "notebook_id": ""}
        )
        assert response.status_code == 400
        mock_text_search.assert_not_awaited()

    def test_scope_is_bounded(self, client):
        response = client.post(
            "/api/search",
            json={"query": "x", "notebook_ids": [f"notebook:{i}" for i in range(51)]},
        )
        assert response.status_code == 422


class TestAskScopeValidationOrder:
    """/search/ask validates the scope before touching models (#574, #87)."""

    @patch("api.routers.search.Model.get", new_callable=AsyncMock)
    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    def test_unknown_scope_fails_before_model_lookup(
        self, mock_query, mock_model_get, client
    ):
        mock_query.return_value = []
        response = client.post(
            "/api/search/ask",
            json={
                "question": "q",
                "strategy_model": "model:s",
                "answer_model": "model:a",
                "final_answer_model": "model:f",
                "notebook_ids": ["notebook:zzz"],
            },
        )
        assert response.status_code == 404
        mock_model_get.assert_not_awaited()
