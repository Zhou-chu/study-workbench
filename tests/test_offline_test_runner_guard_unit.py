"""Direct tests of the offline runner audit-event predicate."""


def test_network_tripwire_blocks_dns_and_inet_without_making_connections():
    import socket
    from types import SimpleNamespace

    import pytest

    from scripts.offline_pytest import network_guard

    for event in ("getaddrinfo", "gethostbyname", "gethostbyaddr", "getnameinfo"):
        with pytest.raises(socket.gaierror, match="Network disabled"):
            network_guard(f"socket.{event}", ())
    for family in (socket.AF_INET, socket.AF_INET6):
        for event in ("connect", "bind", "sendto"):
            with pytest.raises(OSError, match="Network disabled"):
                network_guard(f"socket.{event}", (SimpleNamespace(family=family),))
    network_guard("socket.connect", (SimpleNamespace(family=socket.AF_UNIX),))
