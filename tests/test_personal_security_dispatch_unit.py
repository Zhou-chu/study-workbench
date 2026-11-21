"""Personal-data dispatch policy with only credential and next-call boundaries replaced."""

import json
from unittest.mock import AsyncMock, Mock

import pytest
from starlette.requests import Request
from starlette.responses import Response

import api.personal_security as module


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "STUDY_WORKBENCH_AUTH_MODE",
        "STUDY_WORKBENCH_PRIVATE_MODE",
        "CORS_ORIGINS",
    ):
        monkeypatch.delenv(name, raising=False)


def request_for(path: str, method: str = "GET", origin: str | None = None) -> Request:
    headers = [(b"host", b"workbench.invalid")]
    if origin is not None:
        headers.append((b"origin", origin.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "scheme": "https",
            "server": ("workbench.invalid", 443),
            "query_string": b"",
            "headers": headers,
        }
    )


def middleware() -> module.PersonalSecurityMiddleware:
    # The ASGI application is never invoked: exercise dispatch directly.
    return module.PersonalSecurityMiddleware(AsyncMock())


def assert_private_headers(response: Response) -> None:
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["device_session", "web_session", "unknown"])
async def test_nonlegacy_mode_never_reads_legacy_credentials(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", mode)
    loader = Mock(side_effect=AssertionError("must not observe legacy credentials"))
    monkeypatch.setattr(module, "get_secret_from_env", loader)
    response = Response(headers={"cache-control": "private"})
    next_call = AsyncMock(return_value=response)
    request = request_for("/api/personal/notes", "POST", "https://other.invalid")
    assert await middleware().dispatch(request, next_call) is response
    next_call.assert_awaited_once_with(request)
    loader.assert_not_called()
    assert response.headers["cache-control"] == "private"
    assert "x-content-type-options" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,private",
    [("/health", "1"), ("/api/sources", "0"), ("/api/personalized/x", "0")],
)
async def test_unprotected_routes_are_untouched(
    monkeypatch: pytest.MonkeyPatch, path: str, private: str
) -> None:
    monkeypatch.setenv("STUDY_WORKBENCH_PRIVATE_MODE", private)
    loader = Mock(side_effect=AssertionError("unprotected route"))
    monkeypatch.setattr(module, "get_secret_from_env", loader)
    response = Response(status_code=202)
    next_call = AsyncMock(return_value=response)
    request = request_for(path)
    assert await middleware().dispatch(request, next_call) is response
    next_call.assert_awaited_once_with(request)
    loader.assert_not_called()
    assert "cache-control" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,private", [("/api/personal/notes", "0"), ("/api/sources", "1")]
)
@pytest.mark.parametrize("mode", [None, "legacy_password"])
async def test_missing_password_fails_closed(
    monkeypatch: pytest.MonkeyPatch, path: str, private: str, mode: str | None
) -> None:
    monkeypatch.setenv("STUDY_WORKBENCH_PRIVATE_MODE", private)
    if mode is not None:
        monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", mode)
    loader = Mock(return_value=None)
    monkeypatch.setattr(module, "get_secret_from_env", loader)
    next_call = AsyncMock(side_effect=AssertionError("missing private access"))
    response = await middleware().dispatch(request_for(path), next_call)
    assert response.status_code == 503
    assert json.loads(response.body)["error"]["code"] == "PRIVATE_ACCESS_REQUIRED"
    loader.assert_called_once_with("OPEN_NOTEBOOK_PASSWORD")
    next_call.assert_not_awaited()
    assert_private_headers(response)


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("allowed", ["", "*", "https://trusted.invalid, *"])
async def test_cross_origin_mutations_rejected(
    monkeypatch: pytest.MonkeyPatch, method: str, allowed: str
) -> None:
    monkeypatch.setenv("CORS_ORIGINS", allowed)
    monkeypatch.setattr(module, "get_secret_from_env", Mock(return_value="synthetic"))
    next_call = AsyncMock(side_effect=AssertionError("must reject before next"))
    response = await middleware().dispatch(
        request_for("/api/personal/notes", method, "https://other.invalid"), next_call
    )
    assert response.status_code == 403
    assert json.loads(response.body)["error"]["code"] == "CROSS_SITE_REQUEST"
    next_call.assert_not_awaited()
    assert_private_headers(response)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,origin,allowed",
    [
        ("POST", "https://workbench.invalid", ""),
        ("POST", "https://trusted.invalid/", " , https://trusted.invalid/ , *,"),
        ("POST", None, ""),
        ("GET", "https://other.invalid", ""),
        ("HEAD", "https://other.invalid", ""),
        ("OPTIONS", "https://other.invalid", ""),
    ],
)
async def test_allowed_requests_keep_response_and_override_privacy_headers(
    monkeypatch: pytest.MonkeyPatch, method: str, origin: str | None, allowed: str
) -> None:
    monkeypatch.setenv("CORS_ORIGINS", allowed)
    monkeypatch.setattr(module, "get_secret_from_env", Mock(return_value="synthetic"))
    response = Response(
        b"payload",
        status_code=201,
        headers={"cache-control": "public", "x-content-type-options": "other"},
    )
    next_call = AsyncMock(return_value=response)
    request = request_for("/api/personal/notes", method, origin)
    assert await middleware().dispatch(request, next_call) is response
    next_call.assert_awaited_once_with(request)
    assert response.status_code == 201
    assert response.body == b"payload"
    assert_private_headers(response)
