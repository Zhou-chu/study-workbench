"""Direct checks of historical runner policy and mocked lifecycle."""

from scripts import historical_database_pytest as runner


def test_network_guard_rejects_dns_before_any_connect():
    import pytest

    with pytest.raises(OSError):
        runner.network_guard(
            12345, "socket.getaddrinfo", ("provider.example", 443, 0, 0, 0)
        )
    runner.network_guard(12345, "socket.getaddrinfo", ("127.0.0.1", 12345, 0, 0, 0))
    with pytest.raises(OSError):
        runner.network_guard(12345, "socket.gethostbyname", ("provider.example",))


def test_network_guard_rejects_other_loopback_ports():
    import socket
    from unittest.mock import Mock

    import pytest

    sock = Mock(family=socket.AF_INET)
    runner.network_guard(12345, "socket.connect", (sock, ("127.0.0.1", 12345)))
    with pytest.raises(OSError):
        runner.network_guard(12345, "socket.connect", (sock, ("127.0.0.1", 8000)))


def test_sigterm_during_spawn_defers_until_owned_registration(monkeypatch):
    import signal
    from unittest.mock import Mock

    import pytest

    process = Mock(closed=True)
    previous = signal.getsignal(signal.SIGTERM)

    def start(*args, **kwargs):
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)
        return process

    monkeypatch.setattr(runner.lifecycle, "start_owned", start)
    stop = Mock()
    monkeypatch.setattr(runner.lifecycle, "stop_processes", stop)
    with pytest.raises(SystemExit) as result:
        with runner.owned_processes() as processes:
            runner.start_registered(processes, ["public-synthetic-child"])
    assert result.value.code == 128 + signal.SIGTERM
    stop.assert_called_once_with([process])
    assert signal.getsignal(signal.SIGTERM) is previous


def test_cleanup_failure_still_restores_original_handler(monkeypatch):
    import signal
    from unittest.mock import Mock

    import pytest

    previous = signal.getsignal(signal.SIGTERM)
    monkeypatch.setattr(
        runner.lifecycle,
        "stop_processes",
        Mock(side_effect=RuntimeError("identity changed")),
    )
    with pytest.raises(RuntimeError, match="identity changed"):
        with runner.owned_processes():
            pass
    assert signal.getsignal(signal.SIGTERM) is previous
