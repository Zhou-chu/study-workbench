"""Pure config/middleware units with synthetic in-memory ASGI boundaries."""

import pytest

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
