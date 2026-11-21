"""Offline fixture ownership tests: no processes, sockets or database traffic."""

from unittest.mock import Mock

import disposable_database as fixture
import pytest

from scripts.v1 import runtime_lifecycle as lifecycle


@pytest.fixture
def harness(monkeypatch, tmp_path):
    binary = tmp_path / "surreal"
    binary.write_bytes(b"synthetic binary")
    binary.chmod(0o700)
    monkeypatch.setenv("FIXTURE_DISPOSABLE_DB", "1")
    monkeypatch.setenv("FIXTURE_TEST_SURREAL_BINARY", str(binary))
    monkeypatch.setattr(
        fixture.hashlib, "sha256", lambda _: Mock(hexdigest=lambda: fixture.SHA256)
    )
    socket = Mock()
    socket.__enter__ = Mock(return_value=socket)
    socket.__exit__ = Mock(return_value=False)
    socket.getsockname.return_value = ("127.0.0.1", 12345)
    monkeypatch.setattr(fixture.socket, "socket", Mock(return_value=socket))
    proc = Mock(poll=Mock(return_value=None))
    start = Mock(return_value=proc)
    stop = Mock()
    http = Mock(return_value=Mock(status_code=200))
    monkeypatch.setattr(lifecycle, "start_owned", start)
    monkeypatch.setattr(lifecycle, "stop_processes", stop)
    monkeypatch.setattr(lifecycle.httpx, "get", http)
    factory = Mock(mktemp=Mock(return_value=tmp_path))
    return factory, proc, start, stop, http


@pytest.mark.parametrize("failure", ["foreign", "absent", "exited"])
def test_failed_ownership_never_contacts_http_or_database(
    monkeypatch, harness, failure
):
    factory, proc, start, stop, http = harness
    monkeypatch.setattr(
        lifecycle,
        "listener_inodes",
        lambda port: {"foreign"} if failure == "foreign" else set(),
    )
    monkeypatch.setattr(lifecycle, "owned_socket_inodes", lambda owner: {"owned"})
    monkeypatch.setattr(lifecycle.time, "monotonic", Mock(side_effect=[0, 20]))
    if failure == "exited":
        proc.poll.return_value = 1
    database = Mock()
    with pytest.raises(RuntimeError):
        with fixture.disposable_database(factory, "FIXTURE", "synthetic") as url:
            database(url)
    http.assert_not_called()
    database.assert_not_called()
    stop.assert_called_once_with([proc])
    start.assert_called_once()


def test_success_checks_ownership_before_health_and_database(monkeypatch, harness):
    factory, proc, start, stop, http = harness
    events = []

    def guard(owner, port):
        assert owner is proc and port == 12345
        events.append("ownership")
        return True

    monkeypatch.setattr(lifecycle, "owned_listener_ready", guard)

    def health_response(*args, **kwargs):
        events.append("http")
        return Mock(status_code=200)

    http.side_effect = health_response
    with fixture.disposable_database(factory, "FIXTURE", "synthetic") as url:
        assert url == "ws://127.0.0.1:12345/rpc"
        events.append("database")
        stop.assert_not_called()
    assert events == ["ownership", "http", "ownership", "database"]
    http.assert_called_once_with(
        "http://127.0.0.1:12345/health", timeout=1, trust_env=False
    )
    stop.assert_called_once_with([proc])
    args, kwargs = start.call_args
    assert args[0][-1] == "memory"
    assert args[0][2:4] == ["--bind", "127.0.0.1:12345"]
    assert kwargs["env"] == {
        "PATH": "/usr/bin:/bin",
        "HOME": str(factory.mktemp.return_value),
    }


def test_disabled_fixture_does_not_spawn(monkeypatch, harness):
    factory, _, start, stop, http = harness
    monkeypatch.delenv("FIXTURE_DISPOSABLE_DB")
    with pytest.raises(pytest.skip.Exception):
        with fixture.disposable_database(factory, "FIXTURE", "synthetic"):
            pytest.fail("disabled fixture yielded")
    start.assert_not_called()
    stop.assert_not_called()
    http.assert_not_called()


def test_health_failure_never_yields_database_and_cleans_up(monkeypatch, harness):
    factory, proc, _, stop, http = harness
    monkeypatch.setattr(lifecycle, "owned_listener_ready", lambda owner, port: True)
    monkeypatch.setattr(lifecycle.time, "monotonic", Mock(side_effect=[0, 20]))
    http.return_value.status_code = 503
    database = Mock()
    with pytest.raises(RuntimeError, match="timed out"):
        with fixture.disposable_database(factory, "FIXTURE", "synthetic") as url:
            database(url)
    http.assert_called_once()
    database.assert_not_called()
    stop.assert_called_once_with([proc])


def test_wrong_digest_never_starts_or_connects(monkeypatch, harness):
    factory, _, start, stop, http = harness
    monkeypatch.setattr(
        fixture.hashlib, "sha256", lambda _: Mock(hexdigest=lambda: "wrong")
    )
    with pytest.raises(AssertionError, match="digest"):
        with fixture.disposable_database(factory, "FIXTURE", "synthetic"):
            pytest.fail("unverified binary yielded")
    start.assert_not_called()
    stop.assert_not_called()
    http.assert_not_called()
