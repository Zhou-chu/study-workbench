"""Synthetic environment projection and ordered cleanup failures only."""

import pytest

from scripts.v1.local_check import build_fixture_environment


def test_update_off_and_secret_strip(tmp_path):
    env = build_fixture_environment(
        tmp_path, {"API_KEY": "secret", "HTTP_PROXY": "proxy", "PATH": "/bin"}
    )
    assert env["OPEN_NOTEBOOK_DISABLE_UPDATE_CHECK"] == "1"
    assert "API_KEY" not in env and "HTTP_PROXY" not in env


def test_cleanup_failure_preserves_state_and_checks_other_boundaries(
    monkeypatch, tmp_path
):
    from types import SimpleNamespace

    from scripts.v1 import local_check

    events = []

    def failed_stop(_):
        events.append("stop")
        raise RuntimeError("synthetic stop uncertainty")

    monkeypatch.setattr(local_check, "stop_processes", failed_stop)
    monkeypatch.setattr(
        local_check, "require_free_ports", lambda _: events.append("ports")
    )
    custody = SimpleNamespace(__exit__=lambda *_: events.append("drain"))
    copies = SimpleNamespace(remove_after_drain=lambda: events.append("delete"))
    with pytest.raises(BaseExceptionGroup):
        local_check.finish_owned_run(
            [],
            custody,
            (1, 2, 3),
            copies,
            tmp_path,
            None,
            lambda: events.append("artifact"),
        )
    assert events == ["stop", "drain", "ports", "artifact"]
