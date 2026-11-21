"""Direct logical-unit cases extracted without changing assertions or parameters."""

from unittest.mock import Mock

import pytest

from scripts.v1 import local_check


def test_http_requires_artifact_before_ports(monkeypatch):
    monkeypatch.setattr("sys.argv", ["local_check", "--frontend-http"])
    ports = Mock()
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(SystemExit) as error:
        local_check.main()
    assert error.value.code == 2
    ports.assert_not_called()


@pytest.mark.parametrize("failure", [None, "stop", "ports", "backend", "frontend"])
def test_coupled_restart_order_and_fail_closed(monkeypatch, failure):
    calls = []

    def step(name, result=None):
        def run(*args):
            calls.append(name)
            if name == failure:
                raise RuntimeError(name)
            return result

        return run

    monkeypatch.setattr(local_check, "stop_processes", step("stop"))
    monkeypatch.setattr(local_check, "require_free_ports", step("ports"))
    backend = step("backend", ("new-db", "new-api", "new-worker"))
    frontend = step("frontend", "new-frontend")
    args = (["old-owned"], (10001, 10002, 10003), backend, frontend)
    order = ["stop", "ports", "backend", "frontend"]
    if failure:
        with pytest.raises(RuntimeError, match=failure):
            local_check.restart_owned_stack(*args)
        assert calls == order[: order.index(failure) + 1]
    else:
        assert local_check.restart_owned_stack(*args) == (
            "new-db",
            "new-api",
            "new-worker",
            "new-frontend",
        )
        assert calls == order


def test_http_rejects_stale_artifact_before_ports(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "sys.argv", ["local_check", "--frontend-http", "--artifact", str(tmp_path)]
    )
    monkeypatch.setattr(
        local_check, "verify_artifact", Mock(side_effect=RuntimeError("stale"))
    )
    ports = Mock()
    monkeypatch.setattr(local_check, "select_unused_ports", ports)
    with pytest.raises(RuntimeError, match="stale"):
        local_check.main()
    ports.assert_not_called()


def test_frontend_environment_excludes_backend_credentials(tmp_path):
    backend = local_check.build_fixture_environment(tmp_path, {"PATH": "/bin"})
    env = local_check.build_frontend_environment(backend, 12345)
    assert env["PORT"] == "12345"
    assert env["HOSTNAME"] == "127.0.0.1"
    assert env["INTERNAL_API_URL"] == backend["INTERNAL_API_URL"]
    assert env["API_URL"] == backend["API_URL"]
    assert not any("PASSWORD" in k or "SURREAL" in k or "ENCRYPTION" in k for k in env)
