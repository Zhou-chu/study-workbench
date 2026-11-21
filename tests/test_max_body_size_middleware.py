"""
Tests for api.middleware.MaxBodySizeMiddleware.

Mixed CORS/authentication/FastAPI/multipart integration and residual config
checks. Pure middleware/config cases live in test_max_body_size_middleware_unit.py.
"""

import pytest
from body_size_middleware_scope_fixtures import (
    CollectingSend,
    FakeReceiveStream,
    _echo_body_app,
    make_scope,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import (
    MaxBodySizeMiddleware,
)


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
