from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from api.routers import web_discovery as routes
from api.web_discovery_contracts import WebIdempotencyConflict
from open_notebook.exceptions import ConfigurationError


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    monkeypatch.setattr(routes, "Notebook", SimpleNamespace(get=AsyncMock()))

    @app.exception_handler(ConfigurationError)
    async def configuration_error(request, error):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    return app


@pytest.mark.asyncio
async def test_unconfigured_status_and_search_are_explicit_without_provider_calls(
    app, monkeypatch
):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_KEY_FILE", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_URL", raising=False)
    monkeypatch.delenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        status = await client.get("/api/personal/web-search/status")
        assert status.json()["state"] == "configuration_required"
        assert status.json()["externally_verified"] is False
        assert status.json()["access_mode"] == "api_key"
        assert status.json()["trial_limits"] is None
        search = await client.post("/api/personal/web-search", json={"query": "topic"})
        assert search.status_code == 422
        assert "results" not in search.json()


@pytest.mark.asyncio
async def test_trial_status_contract_is_local_only_and_explicit(app, monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "keyless_trial")
    monkeypatch.delenv("FIRECRAWL_API_URL", raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/personal/web-search/status")
    assert response.status_code == 200
    status = response.json()
    assert status["state"] == "ready"
    assert status["access_mode"] == "keyless_trial"
    assert status["automatic_paid_fallback"] is False
    assert status["externally_verified"] is False
    assert status["trial_limits"] == {
        "scope": "server_ip",
        "period": "daily",
        "numeric_caps_published": False,
    }


@pytest.mark.asyncio
async def test_query_bounds_and_extra_fields_rejected_before_service(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for body in (
            {"query": " "},
            {"query": "x" * 501},
            {"query": "topic", "limit": 11},
            {"query": "topic", "notebook_contents": "private"},
        ):
            assert (
                await client.post("/api/personal/web-search", json=body)
            ).status_code == 422


@pytest.mark.asyncio
async def test_import_key_conflict_is_409(app):
    service = SimpleNamespace(
        import_source=AsyncMock(side_effect=WebIdempotencyConflict())
    )
    app.dependency_overrides[routes.get_web_discovery_service] = lambda: service
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/notebooks/notebook:a/sources/web-import",
            json={
                "url": "https://example.com",
                "title": "Example",
                "idempotency_key": "once",
            },
        )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "WEB_IDEMPOTENCY_CONFLICT"


def test_service_internal_dependencies_are_not_api_query_parameters(app):
    operation = app.openapi()["paths"][
        "/api/personal/notebooks/{notebook_id}/sources/web-import"
    ]["post"]
    assert [parameter["name"] for parameter in operation["parameters"]] == [
        "notebook_id"
    ]
