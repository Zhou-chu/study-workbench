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
