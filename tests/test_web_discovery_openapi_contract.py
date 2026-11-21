"""Static OpenAPI schema contract for the web discovery router."""

from fastapi import FastAPI

from api.routers import web_discovery as routes


def test_service_internal_dependencies_are_not_api_query_parameters():
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    operation = app.openapi()["paths"][
        "/api/personal/notebooks/{notebook_id}/sources/web-import"
    ]["post"]
    assert [parameter["name"] for parameter in operation["parameters"]] == [
        "notebook_id"
    ]
