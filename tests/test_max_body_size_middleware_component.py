"""Direct composition of the CORS and body-size middleware against fake ASGI."""

import pytest
from body_size_middleware_scope_fixtures import (
    CollectingSend,
    FakeReceiveStream,
    _echo_body_app,
    make_scope,
)
from starlette.middleware.cors import CORSMiddleware

from api.middleware import MaxBodySizeMiddleware


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
