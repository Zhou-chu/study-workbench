"""Direct preview stop and synthetic catalog logic without a real process."""

import pytest
from model_setup_review_workspace_fixtures import review as _review

review = _review


@pytest.mark.parametrize("timeout", [False, True])
def test_preview_stop_confirms_exit(review, monkeypatch, timeout):
    from unittest.mock import Mock

    server = Mock(pid=12345)
    server.poll.return_value = None
    server.wait.side_effect = (
        [review.subprocess.TimeoutExpired("owned", 15), 0] if timeout else [0]
    )
    kill = Mock()
    monkeypatch.setattr(review.os, "killpg", kill)
    review.stop_preview(server)
    assert kill.call_args_list[0].args == (12345, review.signal.SIGTERM)
    assert server.wait.call_args_list[0].kwargs == {"timeout": 15}
    if timeout:
        assert kill.call_args_list[1].args == (12345, review.signal.SIGKILL)
        assert server.wait.call_args_list[1].kwargs == {}


@pytest.mark.parametrize(
    "scenario,credentials,models",
    [
        ("empty", 0, 0),
        ("encryption_blocker", 0, 0),
        ("saved_unregistered", 1, 0),
        ("multiple_pending", 2, 0),
        ("dangling_model", 0, 1),
        ("embedding_only", 1, 1),
        ("environment_model", 0, 1),
        ("registered_not_default", 1, 1),
        ("old_default", 3, 2),
    ],
)
def test_synthetic_state_fixture_shapes(review, scenario, credentials, models):
    state = review.state_for(scenario)
    assert len(state["credentials"]) == credentials
    assert len(state["models"]) == models
    assert "default_chat_model" in state["defaults"]
    assert all("api_key" not in value for value in state["credentials"])
