import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import PasswordAuthMiddleware


def make_client(monkeypatch, password):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", password)
    from api.personal_security import PersonalSecurityMiddleware

    app = FastAPI()

    @app.api_route("/api/personal/{path:path}", methods=["GET", "POST"])
    async def data(path: str):
        return {"private": "test-fixture"}

    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    return TestClient(app)


@pytest.mark.parametrize(
    "path",
    [
        "sources/x/versions",
        "source-versions/x/download",
        "jobs/x",
        "exports/x/download",
    ],
)
def test_private_routes_reject_anonymous(monkeypatch, path):
    response = make_client(monkeypatch, "test-only-not-secret").get(
        "/api/personal/" + path
    )
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_private_routes_fail_closed_when_password_missing(monkeypatch):
    assert make_client(monkeypatch, "").get("/api/personal/jobs/x").status_code == 503


def test_authorized_private_request_succeeds(monkeypatch):
    c = make_client(monkeypatch, "test-only-not-secret")
    response = c.get(
        "/api/personal/jobs/x", headers={"Authorization": "Bearer test-only-not-secret"}
    )
    assert response.status_code == 200


def test_cross_site_mutation_rejected(monkeypatch):
    c = make_client(monkeypatch, "test-only-not-secret")
    response = c.post(
        "/api/personal/jobs/x",
        headers={
            "Authorization": "Bearer test-only-not-secret",
            "Origin": "https://evil.invalid",
        },
    )
    assert response.status_code == 403


def test_private_mode_blocks_legacy_data_when_password_missing(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "")
    monkeypatch.setenv("STUDY_WORKBENCH_PRIVATE_MODE", "1")
    from api.personal_security import PersonalSecurityMiddleware

    app = FastAPI()

    @app.get("/api/sources")
    async def private_sources():
        return {"private": "same source data"}

    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    assert TestClient(app).get("/api/sources").status_code == 503
