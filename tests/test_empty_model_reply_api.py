"""Round trip HTTP retry against a synthetic SQLite-backed graph."""

from unittest.mock import AsyncMock, MagicMock, patch

from empty_model_reply_fixtures import _history, _toy_graph


def test_notebook_chat_failed_turn_is_rolled_back_and_retry_is_clean():
    from fastapi.testclient import TestClient

    from api.main import app

    client = TestClient(app)
    graph = _toy_graph(["", "the answer"])
    session = MagicMock(model_override=None, save=AsyncMock())
    with (
        patch("api.routers.chat.chat_graph", graph),
        patch(
            "api.routers.chat.get_session_or_404",
            new=AsyncMock(return_value=("chat_session:n", session)),
        ),
        patch("api.routers.chat.repo_query", new=AsyncMock(return_value=[])),
    ):
        payload = {"session_id": "chat_session:n", "message": "question", "context": {}}
        failed = client.post("/api/chat/execute", json=payload)
        assert failed.status_code >= 400
        assert "empty response" in failed.json()["detail"]
        assert _history(graph, "chat_session:n") == []

        retried = client.post("/api/chat/execute", json=payload)

    assert retried.status_code == 200
    assert _history(graph, "chat_session:n") == [
        ("human", "question"),
        ("ai", "the answer"),
    ]
