"""DNS rejection and cancellation policy; resolver boundary only, no network."""

import asyncio
import socket
from collections.abc import Awaitable
from unittest.mock import Mock

import pytest

from open_notebook.utils import url_validation as target


def address(value):
    family = socket.AF_INET6 if ":" in value else socket.AF_INET
    sockaddr = (value, 0, 0, 0) if family == socket.AF_INET6 else (value, 0)
    return (family, socket.SOCK_STREAM, 6, "", sockaddr)


@pytest.mark.asyncio
async def test_validation_tolerates_unresolved_configuration_but_outbound_pinning_does_not(
    monkeypatch,
):
    failure = socket.gaierror("synthetic unresolved")
    resolver = Mock(side_effect=failure)
    monkeypatch.setattr(target.socket, "getaddrinfo", resolver)
    validation: Awaitable[object] = target.validate_url(
        "https://synthetic.invalid", "custom"
    )
    assert await validation is None
    with pytest.raises(ValueError, match="Could not resolve hostname") as caught:
        await target.prepare_pinned_http_target("https://synthetic.invalid", "custom")
    assert caught.value.__cause__ is failure
    assert resolver.call_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [[], ["not-an-ip"]])
async def test_no_valid_resolved_address_cannot_create_outbound_target(
    monkeypatch, values
):
    resolver = Mock(return_value=[address(v) for v in values])
    monkeypatch.setattr(target.socket, "getaddrinfo", resolver)
    with pytest.raises(ValueError, match="Could not resolve hostname"):
        await target.prepare_pinned_http_target("https://synthetic.invalid", "custom")
    resolver.assert_called_once_with("synthetic.invalid", None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "blocked", ["169.254.169.254", "fd00:ec2::254", "::ffff:169.254.169.254"]
)
@pytest.mark.parametrize("blocked_first", [False, True])
async def test_any_forbidden_answer_rejects_whole_dns_set(
    monkeypatch, blocked, blocked_first
):
    values = [blocked, "93.184.216.34"] if blocked_first else ["93.184.216.34", blocked]
    resolver = Mock(return_value=[address(v) for v in values])
    monkeypatch.setattr(target.socket, "getaddrinfo", resolver)
    with pytest.raises(ValueError, match="link-local|metadata"):
        await target.prepare_pinned_http_target("https://synthetic.invalid", "custom")
    resolver.assert_called_once_with("synthetic.invalid", None)


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["validate_url", "prepare_pinned_http_target"])
async def test_resolver_cancellation_is_not_hidden_as_invalid_url(monkeypatch, method):
    cancellation = asyncio.CancelledError()
    resolver = Mock(side_effect=cancellation)
    monkeypatch.setattr(target.socket, "getaddrinfo", resolver)
    with pytest.raises(asyncio.CancelledError) as caught:
        await getattr(target, method)("https://synthetic.invalid", "custom")
    assert caught.value is cancellation
    resolver.assert_called_once()


@pytest.mark.asyncio
async def test_pinning_skips_non_ip_answers_without_weakening_valid_target(monkeypatch):
    resolver = Mock(return_value=[address("bad"), address("93.184.216.34")])
    monkeypatch.setattr(target.socket, "getaddrinfo", resolver)
    result = await target.prepare_pinned_http_target(
        "https://synthetic.invalid:8443/a?q=1", "custom"
    )
    assert result.url == "https://93.184.216.34:8443/a?q=1"
    assert result.headers == {"Host": "synthetic.invalid:8443"}
    assert result.extensions == {"sni_hostname": "synthetic.invalid"}
    resolver.assert_called_once()
