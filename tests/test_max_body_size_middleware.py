"""
Tests for api.middleware.MaxBodySizeMiddleware.

Covers the raw-ASGI unit behavior (Content-Length pre-check, streaming
enforcement for chunked/no-Content-Length requests, CORS interaction) plus
integration through a real FastAPI app and the actual registered app.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware

from api.middleware import (
    DEFAULT_MAX_UPLOAD_SIZE_MB,
    MaxBodySizeMiddleware,
    get_max_upload_size_bytes,
)


async def _echo_body_app(scope, receive, send):
    """Minimal ASGI app that reads the full body then returns 200."""
    body = b""
    more_body = True
    while more_body:
        message = await receive()
        body += message.get("body", b"")
        more_body = message.get("more_body", False)
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send(
        {"type": "http.response.body", "body": f"received {len(body)} bytes".encode()}
    )


def make_scope(headers=None, method="POST", path="/upload"):
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return {
        "type": "http",
        "method": method,
        "path": path,
        "headers": raw_headers,
    }


class FakeReceiveStream:
    """Feeds a list of body chunks as successive http.request ASGI messages."""

    def __init__(self, chunks):
        self._chunks = list(chunks)

    async def __call__(self):
        if not self._chunks:
            return {"type": "http.request", "body": b"", "more_body": False}
        chunk = self._chunks.pop(0)
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": bool(self._chunks),
        }


class CollectingSend:
    def __init__(self):
        self.messages = []

    async def __call__(self, message):
        self.messages.append(message)

    @property
    def status(self):
        for m in self.messages:
            if m["type"] == "http.response.start":
                return m["status"]
        return None

    @property
    def body(self):
        return b"".join(
            m.get("body", b"")
            for m in self.messages
            if m["type"] == "http.response.body"
        )

    def header(self, name: bytes):
        for m in self.messages:
            if m["type"] == "http.response.start":
                for k, v in m["headers"]:
                    if k.lower() == name.lower():
                        return v.decode()
        return None


class TestConfig:
    def test_default_is_100mb(self, monkeypatch):
        monkeypatch.delenv("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB", raising=False)
        assert DEFAULT_MAX_UPLOAD_SIZE_MB == 100
        assert get_max_upload_size_bytes() == 100 * 1024 * 1024

    def test_reads_env_override(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB", "5")
        assert get_max_upload_size_bytes() == 5 * 1024 * 1024

    def test_malformed_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB", "not-a-number")
        assert get_max_upload_size_bytes() == 100 * 1024 * 1024

    def test_non_positive_env_falls_back_to_default(self, monkeypatch):
        # A zero/negative limit would 413 every request that has a body.
        monkeypatch.setenv("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB", "0")
        assert get_max_upload_size_bytes() == 100 * 1024 * 1024
        monkeypatch.setenv("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB", "-5")
        assert get_max_upload_size_bytes() == 100 * 1024 * 1024


class TestMiddlewareAsgiLevel:
    @pytest.mark.asyncio
    async def test_content_length_precheck_rejects_before_app_runs(self):
        app_called = False

        async def inner_app(scope, receive, send):
            nonlocal app_called
            app_called = True
            await _echo_body_app(scope, receive, send)

        middleware = MaxBodySizeMiddleware(inner_app, max_body_size=10)
        scope = make_scope(headers={"content-length": "1000"})
        send = CollectingSend()
        await middleware(scope, FakeReceiveStream([b"x" * 1000]), send)

        assert not app_called, (
            "inner app must not run when Content-Length exceeds the limit"
        )
        assert send.status == 413

    @pytest.mark.asyncio
    async def test_small_body_passes_through(self):
        middleware = MaxBodySizeMiddleware(_echo_body_app, max_body_size=1000)
        scope = make_scope(headers={"content-length": "5"})
        send = CollectingSend()
        await middleware(scope, FakeReceiveStream([b"hello"]), send)

        assert send.status == 200
        assert send.body == b"received 5 bytes"

    @pytest.mark.asyncio
    async def test_streaming_body_without_content_length_is_still_enforced(self):
        """A client can omit Content-Length (chunked transfer-encoding) - the
        middleware must still catch an oversized body as it streams in."""
        middleware = MaxBodySizeMiddleware(_echo_body_app, max_body_size=10)
        scope = make_scope(headers={})  # no content-length
        send = CollectingSend()
        chunks = [b"a" * 5, b"b" * 5, b"c" * 5]  # totals 15 > 10
        await middleware(scope, FakeReceiveStream(chunks), send)

        assert send.status == 413

    @pytest.mark.asyncio
    async def test_malformed_content_length_falls_back_to_streaming_check(self):
        middleware = MaxBodySizeMiddleware(_echo_body_app, max_body_size=10)
        scope = make_scope(headers={"content-length": "not-a-number"})
        send = CollectingSend()
        await middleware(scope, FakeReceiveStream([b"x" * 1000]), send)

        assert send.status == 413  # caught by streaming enforcement instead

    @pytest.mark.asyncio
    async def test_non_http_scope_passes_through_untouched(self):
        calls = []

        async def inner_app(scope, receive, send):
            calls.append(scope["type"])

        middleware = MaxBodySizeMiddleware(inner_app, max_body_size=10)
        await middleware({"type": "lifespan"}, FakeReceiveStream([]), CollectingSend())
        assert calls == ["lifespan"]

    @pytest.mark.asyncio
    async def test_exactly_at_limit_passes(self):
        middleware = MaxBodySizeMiddleware(_echo_body_app, max_body_size=10)
        scope = make_scope(headers={"content-length": "10"})
        send = CollectingSend()
        await middleware(scope, FakeReceiveStream([b"x" * 10]), send)
        assert send.status == 200

    @pytest.mark.asyncio
    async def test_one_byte_over_limit_rejected(self):
        middleware = MaxBodySizeMiddleware(_echo_body_app, max_body_size=10)
        scope = make_scope(headers={"content-length": "11"})
        send = CollectingSend()
        await middleware(scope, FakeReceiveStream([b"x" * 11]), send)
        assert send.status == 413


class TestCorsInteraction:
    @pytest.mark.asyncio
    async def test_cors_headers_present_on_413_when_wrapped_by_cors_middleware(self):
        """MaxBodySizeMiddleware must sit *inside* CORSMiddleware so a
        rejected upload still gets CORS headers (mirrors the ordering used
        in api/main.py)."""
        app = CORSMiddleware(
            MaxBodySizeMiddleware(_echo_body_app, max_body_size=10),
            allow_origins=["http://example.com"],
            allow_credentials=True,
        )
        scope = make_scope(
            headers={"content-length": "1000", "origin": "http://example.com"}
        )
        send = CollectingSend()
        await app(scope, FakeReceiveStream([b"x" * 1000]), send)

        assert send.status == 413
        assert send.header(b"access-control-allow-origin") == "http://example.com"


class TestFastApiIntegration:
    """Drives the middleware through a real FastAPI app + TestClient (real
    HTTP-shaped requests via httpx), not just hand-rolled ASGI messages."""

    @pytest.fixture
    def small_limit_app(self):
        app = FastAPI()

        @app.post("/echo")
        async def echo():
            return {"ok": True}

        app.add_middleware(MaxBodySizeMiddleware, max_body_size=100)
        return app

    def test_small_request_passes(self, small_limit_app):
        client = TestClient(small_limit_app)
        response = client.post("/echo", content=b"x" * 50)
        assert response.status_code == 200

    def test_oversized_request_rejected_with_413(self, small_limit_app):
        client = TestClient(small_limit_app)
        response = client.post("/echo", content=b"x" * 1000)
        assert response.status_code == 413
        assert "exceeds the maximum" in response.json()["detail"]


class TestRealAppWiring:
    def test_real_app_registers_middleware_with_configured_size(self):
        from api.main import MAX_UPLOAD_SIZE_BYTES, app

        matches = [m for m in app.user_middleware if m.cls is MaxBodySizeMiddleware]
        assert len(matches) == 1
        assert matches[0].kwargs["max_body_size"] == MAX_UPLOAD_SIZE_BYTES

    def test_real_app_wraps_it_inside_cors(self):
        """CORS must be outermost so it can attach headers to a 413 from
        MaxBodySizeMiddleware - i.e. CORSMiddleware must be added *after* it."""
        from api.main import app

        # getattr: Middleware.cls is typed as a callable protocol without
        # __name__, but every registered middleware here is a plain class.
        classes = [getattr(m.cls, "__name__", "") for m in app.user_middleware]
        assert classes.index("CORSMiddleware") < classes.index("MaxBodySizeMiddleware")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers", [{}, {"content-length": "21"}, {"content-length": "1"}]
)
async def test_portable_route_budget_stream_and_header(headers):
    middleware = MaxBodySizeMiddleware(
        _echo_body_app, max_body_size=10, portable_body_size=20
    )
    send = CollectingSend()
    await middleware(
        make_scope(headers=headers, path="/api/personal/imports/portable"),
        FakeReceiveStream([b"a" * 10, b"b" * 11]),
        send,
    )
    assert send.status == 413


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,method,status",
    [
        ("/api/personal/imports/portable", "POST", 200),
        ("/api/personal/imports/portable/", "POST", 413),
        ("/api/personal/imports/portable", "PUT", 413),
        ("/api/sources", "POST", 413),
    ],
)
async def test_portable_override_is_exact_route_only(path, method, status):
    middleware = MaxBodySizeMiddleware(
        _echo_body_app, max_body_size=10, portable_body_size=20
    )
    send = CollectingSend()
    await middleware(
        make_scope(path=path, method=method), FakeReceiveStream([b"x" * 20]), send
    )
    assert send.status == status


@pytest.mark.asyncio
async def test_multipart_stream_limit_returns_413_and_closes_spool(monkeypatch):
    import starlette.formparsers

    from api.routers import portable

    opened = []
    original = starlette.formparsers.SpooledTemporaryFile

    def track(*args, **kwargs):
        file = original(*args, **kwargs)
        opened.append(file)
        return file

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", track)
    app = FastAPI()

    app.include_router(portable.router, prefix="/api")

    app.add_middleware(MaxBodySizeMiddleware, max_body_size=10, portable_body_size=200)

    def chunks():
        yield b'--abc\r\nContent-Disposition: form-data; name="file"; filename="x.zip"\r\nContent-Type: application/zip\r\n\r\n'
        yield b"x" * 300
        yield b"\r\n--abc--\r\n"

    scope = make_scope(
        path="/api/personal/imports/portable",
        headers={"content-type": "multipart/form-data; boundary=abc"},
    )
    scope.update(
        query_string=b"",
        server=("testserver", 80),
        client=("testclient", 1),
        scheme="http",
        root_path="",
        http_version="1.1",
    )
    send = CollectingSend()
    await app(scope, FakeReceiveStream(list(chunks())), send)
    assert send.status == 413
    assert opened and all(file.closed for file in opened)


def test_real_auth_precedes_body_limit():
    from api.main import app

    classes = [getattr(m.cls, "__name__", "") for m in app.user_middleware]
    assert classes.index("PasswordAuthMiddleware") < classes.index(
        "MaxBodySizeMiddleware"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("headers", [{}, {"content-length": "999999999999"}])
async def test_anonymous_import_never_reads_body(monkeypatch, headers):
    from api.auth import PasswordAuthMiddleware

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "test-only")
    app = PasswordAuthMiddleware(
        MaxBodySizeMiddleware(_echo_body_app, max_body_size=10, portable_body_size=20)
    )
    scope = make_scope(path="/api/personal/imports/portable", headers=headers)
    scope.update(
        query_string=b"",
        server=("testserver", 80),
        client=("testclient", 1),
        scheme="http",
        root_path="",
        http_version="1.1",
    )

    async def forbidden_receive():
        raise AssertionError("Anonymous body must not be read")

    send = CollectingSend()
    await app(scope, forbidden_receive, send)
    assert send.status == 401


def test_portable_limits_endpoint_requires_auth_and_exposes_safe_contract(monkeypatch):
    from types import SimpleNamespace

    from api.auth import PasswordAuthMiddleware
    from api.portable_limits import get_portable_limits
    from api.routers import portable

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "test-only")
    monkeypatch.setattr(
        portable,
        "get_portable_service",
        lambda: SimpleNamespace(limits=get_portable_limits()),
    )
    app = FastAPI()
    app.include_router(portable.router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware)
    client = TestClient(app)
    assert client.get("/api/personal/portable/limits").status_code == 401
    response = client.get(
        "/api/personal/portable/limits", headers={"Authorization": "Bearer test-only"}
    )
    assert response.status_code == 200
    data = response.json()
    assert all(type(value) is int and value > 0 for value in data.values())
    assert (
        data["max_request_bytes"]
        == data["max_archive_bytes"] + data["multipart_overhead_bytes"]
    )
    assert data["max_entity_bytes"] == 32 * 1024 * 1024


@pytest.mark.parametrize("value", ["0", "-1", "bad", str(2**53)])
def test_portable_budget_rejects_invalid_or_unsafe_config(monkeypatch, value):
    from api.portable_limits import get_portable_limits

    monkeypatch.setenv("STUDY_WORKBENCH_PORTABLE_MAX_BYTES", value)
    with pytest.raises(ValueError):
        get_portable_limits()


@pytest.mark.parametrize(
    "parts",
    [
        [("file", ("one.zip", b"one")), ("file", ("two.zip", b"two"))],
        [("file", ("one.zip", b"one")), ("extra", (None, "field"))],
        [("wrong", ("one.zip", b"one"))],
    ],
)
def test_portable_parser_rejects_extra_parts_and_closes_spools(monkeypatch, parts):
    import starlette.formparsers
    from fastapi.responses import JSONResponse

    from api.routers import portable
    from open_notebook.exceptions import InvalidInputError

    opened = []
    original = starlette.formparsers.SpooledTemporaryFile

    def track(*args, **kwargs):
        file = original(*args, **kwargs)
        opened.append(file)
        return file

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", track)

    def forbidden_service():
        raise AssertionError("Rejected multipart must never reach archive processing")

    monkeypatch.setattr(portable, "get_portable_service", forbidden_service)
    app = FastAPI()
    app.include_router(portable.router, prefix="/api")

    @app.exception_handler(InvalidInputError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    response = TestClient(app).post("/api/personal/imports/portable", files=parts)
    assert response.status_code == 400
    assert opened and all(file.closed for file in opened)


def test_portable_single_file_parser_retains_openapi_and_closes_success(monkeypatch):
    from types import SimpleNamespace

    from api.routers import portable

    seen = []

    async def import_archive(file):
        seen.append(file)
        assert file.read() == b"one"
        return {"notebook_id": "notebook:fixture"}

    monkeypatch.setattr(
        portable,
        "get_portable_service",
        lambda: SimpleNamespace(import_archive=import_archive),
    )
    app = FastAPI()
    app.include_router(portable.router, prefix="/api")
    response = TestClient(app).post(
        "/api/personal/imports/portable", files={"file": ("one.zip", b"one")}
    )
    assert response.status_code == 201
    assert seen and seen[0].closed
    schema = app.openapi()["paths"]["/api/personal/imports/portable"]["post"][
        "requestBody"
    ]["content"]["multipart/form-data"]["schema"]
    assert schema["required"] == ["file"]
    assert schema["properties"]["file"]["format"] == "binary"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content_type",
    ["application/x-www-form-urlencoded", "application/json", "", "multipart/mixed"],
)
async def test_portable_rejects_nonmultipart_without_reading(content_type):
    from fastapi import Request

    from api.routers.portable import import_portable
    from open_notebook.exceptions import InvalidInputError

    async def forbidden_receive():
        raise AssertionError("Unsupported content type must not read body")

    request = Request(
        make_scope(headers={"content-type": content_type}), forbidden_receive
    )
    with pytest.raises(InvalidInputError, match="requires multipart/form-data"):
        await import_portable(request)
