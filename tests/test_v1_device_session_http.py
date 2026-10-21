"""Synthetic HTTP boundary tests; no production credentials or ingress claim."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_v1_device_session_core import MemoryStore

from api.auth import PasswordAuthMiddleware
from api.device_session_credentials import StrictPasswordProvider
from api.device_session_runtime import DeviceAuthRuntime, install_auth_handlers
from api.device_session_service import DeviceSessionService
from api.personal_security import PersonalSecurityMiddleware
from api.routers.auth import router


def client(monkeypatch, password_file=None):
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "device_sessions")
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "https://app.example")
    app = FastAPI()
    store = MemoryStore()
    service = DeviceSessionService(
        store, StrictPasswordProvider(password="synthetic", password_file=password_file)
    )
    app.state.device_auth_runtime = DeviceAuthRuntime(
        "device_sessions", service, {"https://app.example"}
    )
    install_auth_handlers(app)
    app.include_router(router, prefix="/api")

    @app.post("/api/resource")
    async def resource():
        return {"ok": True}

    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    return TestClient(app), store


def login(c):
    return c.post(
        "/api/auth/sessions", json={"password": "synthetic", "device_name": " Test "}
    )


def test_native_lifecycle_and_no_password_fallback(monkeypatch):
    c, _ = client(monkeypatch)
    r = login(c)
    assert r.status_code == 201, r.text
    assert r.headers["cache-control"] == "no-store"
    pair = r.json()
    assert pair["access_expires_at"].endswith("Z")
    h = {"Authorization": "Bearer " + pair["access_token"]}
    assert c.post("/api/resource", headers=h).status_code == 200
    assert (
        c.post(
            "/api/resource", headers={"Authorization": "Bearer synthetic"}
        ).status_code
        == 400
    )
    rows = c.get("/api/auth/sessions", headers=h).json()["sessions"]
    assert rows[0]["is_current"] and rows[0]["device_name"] == "Test"
    r = c.post(
        "/api/auth/sessions/refresh",
        json={"session_id": pair["session_id"], "refresh_token": pair["refresh_token"]},
    )
    assert r.status_code == 200
    assert c.post("/api/resource", headers=h).status_code == 200
    assert c.delete("/api/auth/sessions", headers=h).status_code == 204
    assert c.post("/api/resource", headers=h).status_code == 401


@pytest.mark.parametrize(
    "headers,body,code",
    [
        ({"Origin": "https://evil.example"}, None, "CROSS_SITE_REQUEST"),
        ({"Origin": "null"}, None, "CROSS_SITE_REQUEST"),
        ({"Cookie": "__Host-sw-access=secret"}, None, "AUTH_MIXED_CREDENTIALS"),
        ({"Authorization": "Bearer secret"}, None, "AUTH_MIXED_CREDENTIALS"),
        ({"Content-Type": "text/plain"}, "secret", "AUTH_UNSUPPORTED_MEDIA_TYPE"),
        (
            {"Content-Type": "application/json"},
            '{"password":"SENSITIVE",bad',
            "AUTH_INVALID_REQUEST",
        ),
        ({"Content-Type": "application/json"}, "x" * 8193, "AUTH_BODY_TOO_LARGE"),
    ],
)
def test_sanitized_boundary(monkeypatch, headers, body, code):
    c, _ = client(monkeypatch)
    r = (
        c.post("/api/auth/sessions", headers=headers, content=body)
        if body is not None
        else c.post(
            "/api/auth/sessions",
            headers=headers,
            json={"password": "synthetic", "device_name": "Test"},
        )
    )
    assert r.json()["error"]["code"] == code, r.text
    assert "SENSITIVE" not in r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_file_outage_observation_through_http(monkeypatch, tmp_path):
    path = tmp_path / "synthetic-password"
    path.write_text("synthetic")
    c, _ = client(monkeypatch, str(path))
    pair = login(c).json()
    h = {"Authorization": "Bearer " + pair["access_token"]}
    path.unlink()
    assert c.post("/api/resource", headers=h).status_code == 503
    path.write_text("synthetic")
    assert c.post("/api/resource", headers=h).status_code == 401


def test_status_storage_failure_and_schema_validation(monkeypatch):
    c, store = client(monkeypatch)
    assert c.get("/api/auth/status").json() == {
        "auth_enabled": True,
        "auth_mode": "device_sessions",
        "protocol_version": 1,
    }
    for body in [
        {"password": "SENSITIVE", "device_name": "x", "extra": "secret"},
        {"password": 34, "device_name": "x"},
        {"password": "SENSITIVE"},
        [],
        None,
    ]:
        r = c.post(
            "/api/auth/sessions",
            json=body,
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400, r.text
        assert "SENSITIVE" not in r.text and "input" not in r.text
    store.fail = True
    r = c.get("/api/auth/status")
    assert r.status_code == 503 and "auth_enabled" not in r.json()


def test_origin_exact_no_host_trust_and_mutations(monkeypatch):
    c, _ = client(monkeypatch)
    pair = login(c).json()
    h = {"Authorization": "Bearer " + pair["access_token"]}
    for origin in [
        "https://app.example/",
        "https://app.example.evil",
        "http://testserver",
        "null",
        "https://app.example, https://evil.example",
    ]:
        r = c.post("/api/resource", headers={**h, "origin": origin})
        assert r.status_code == 403, r.text
    assert (
        c.post(
            "/api/resource", headers={**h, "origin": "https://app.example"}
        ).status_code
        == 200
    )
    assert c.post("/api/auth/status").status_code == 401
    assert c.options("/api/auth/sessions").status_code == 405


def test_rate_keys_ignore_forwarded_headers(monkeypatch):
    c, _ = client(monkeypatch)
    app = c.app
    for index in range(5):
        # A proxy may already have rewritten scope.client. Neither that nor
        # arbitrary forwarding headers changes the conservative shared bucket.
        spoofed = TestClient(app, client=(f"192.0.2.{index}", 10000 + index))
        assert (
            spoofed.post(
                "/api/auth/sessions",
                json={"password": "wrong", "device_name": "x"},
                headers={
                    "X-Forwarded-For": f"192.0.2.{index}",
                    "X-Real-IP": f"198.51.100.{index}",
                },
            ).status_code
            == 401
        )
    r = login(c)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0


def test_legacy_gate_and_unknown_mode(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "legacy_password")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic")
    app = FastAPI()
    install_auth_handlers(app)
    app.include_router(router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware, excluded_paths=["/api/auth/status"])
    c = TestClient(app)
    assert c.get("/api/auth/status").json()["auth_enabled"] is True
    r = c.post(
        "/api/auth/sessions",
        json={"password": "synthetic", "device_name": "x"},
        headers={"Authorization": "Bearer synthetic"},
    )
    assert r.status_code == 503
    assert (
        c.post(
            "/api/auth/sessions", json={"password": "synthetic", "device_name": "x"}
        ).status_code
        == 503
    )
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "typo")
    app = FastAPI()
    app.add_middleware(PasswordAuthMiddleware)
    assert TestClient(app).get("/health").status_code == 503


def test_chunked_body_limit(monkeypatch):
    c, _ = client(monkeypatch)

    def chunks():
        yield b'{"password":"'
        for _ in range(9):
            yield b"x" * 1024
        yield b'"}'

    r = c.post(
        "/api/auth/sessions",
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413 and r.json()["error"]["code"] == "AUTH_BODY_TOO_LARGE"


@pytest.mark.parametrize("mode", ["", " ", "typo", "DEVICE_SESSIONS"])
def test_unknown_modes_fail_closed(monkeypatch, mode):
    from api.device_session_models import AuthError
    from api.device_session_runtime import get_auth_mode

    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", mode)
    with pytest.raises(AuthError, match="Authentication unavailable"):
        get_auth_mode()
    app = FastAPI()
    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    assert TestClient(app).get("/api/auth/status").status_code == 503


def test_auth_fixtures_are_actual_http_results(monkeypatch):
    import json
    from datetime import datetime, timezone
    from pathlib import Path

    c, _ = client(monkeypatch)
    service = c.app.state.device_auth_runtime.service
    service._clock = lambda: datetime(2026, 1, 1, tzinfo=timezone.utc)
    service._random = lambda size: bytes(size)
    root = Path("contracts/v1/fixtures")
    pair = login(c).json()
    assert pair == json.loads((root / "auth-session-created.json").read_text())
    result = c.get(
        "/api/auth/sessions",
        headers={"Authorization": "Bearer " + pair["access_token"]},
    )
    assert result.json() == json.loads((root / "auth-session-list.json").read_text())
    result = c.post(
        "/api/auth/sessions", json={"password": "wrong", "device_name": "Test"}
    )
    assert result.json() == json.loads(
        (root / "auth-invalid-credentials.json").read_text()
    )
    assert result.headers["www-authenticate"] == "Bearer"
    schema = c.app.openapi()
    for path, method in [
        ("/api/auth/sessions", "post"),
        ("/api/auth/sessions/refresh", "post"),
    ]:
        assert "422" not in schema["paths"][path][method]["responses"]
        assert "400" in schema["paths"][path][method]["responses"]


def test_auth_tables_are_not_personal_archive_kinds():
    from api.personal_store import KINDS
    from api.portable_service import PERSONAL_KINDS

    auth_tables = {"auth_session", "auth_access", "auth_session_guard"}
    assert auth_tables.isdisjoint(KINDS)
    assert auth_tables.isdisjoint(PERSONAL_KINDS)


@pytest.mark.asyncio
async def test_startup_runtime_is_fail_closed_and_new_epoch(monkeypatch):
    from api import device_session_repository
    from api.device_session_models import AuthError
    from api.device_session_runtime import initialize_device_auth

    class ReadyStore(MemoryStore):
        async def ready(self):
            self.check()

    store = ReadyStore()
    monkeypatch.setattr(
        device_session_repository, "SurrealDeviceSessionStore", lambda: store
    )
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_MODE", "device_sessions")
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "https://app.example")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic")
    app = FastAPI()
    await initialize_device_auth(app)
    initial = app.state.device_auth_runtime.service
    pair = await initial.create_session("synthetic", "Test")
    await initialize_device_auth(app)
    restarted = app.state.device_auth_runtime.service
    assert initial is not restarted
    with pytest.raises(AuthError, match="Authentication required"):
        await restarted.authenticate_access(pair.access_token)
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "*")
    with pytest.raises(AuthError, match="Authentication unavailable"):
        await initialize_device_auth(FastAPI())
    monkeypatch.setenv("STUDY_WORKBENCH_AUTH_ORIGINS", "https://app.example")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD")
    with pytest.raises(AuthError, match="Authentication unavailable"):
        await initialize_device_auth(FastAPI())


def test_auth_routing_errors_keep_sanitized_envelope(monkeypatch):
    c, _ = client(monkeypatch)
    pair = login(c).json()
    headers = {"Authorization": "Bearer " + pair["access_token"]}
    for method, path, status in [
        ("GET", "/api/auth/missing", 404),
        ("PUT", "/api/auth/sessions", 405),
    ]:
        response = c.request(method, path, headers=headers)
        assert response.status_code == status
        assert response.json() == {
            "error": {
                "code": "AUTH_INVALID_REQUEST",
                "message": "Invalid authentication request.",
            }
        }
        assert response.headers["cache-control"] == "no-store"
        if status == 405:
            assert response.headers["allow"]
    assert c.get("/api/not-an-auth-route", headers=headers).json() == {
        "detail": "Not Found"
    }
