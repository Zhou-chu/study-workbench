"""Real portable ASGI route and security middleware with synthetic requests."""

import pytest
from container_contract_fixtures import manifest


@pytest.mark.parametrize(
    "public_origin", ["http://127.0.0.1:8502", "https://workbench.example"]
)
@pytest.mark.parametrize("foreign", [False, True])
def test_portable_proxy_origin_with_real_security_middleware(
    monkeypatch, public_origin, foreign
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.auth import PasswordAuthMiddleware
    from api.personal_security import PersonalSecurityMiddleware

    # Model Compose's one explicit substitution, without reading operator env/files.
    frontend_origin = manifest()["services"]["bff"]["environment"][
        "STUDY_WORKBENCH_WEB_ORIGIN"
    ]
    api_cors = manifest()["services"]["api"]["environment"].get("CORS_ORIGINS", "")
    monkeypatch.setenv("CORS_ORIGINS", api_cors.replace(frontend_origin, public_origin))
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "test-deployment-access")
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD_FILE", raising=False)
    app = FastAPI()

    @app.post("/api/personal/imports/portable")
    async def upload():
        return {"accepted": True}

    app.add_middleware(PasswordAuthMiddleware)
    app.add_middleware(PersonalSecurityMiddleware)
    # The streaming proxy forwards Origin/auth/content-type, NOT public Host.
    with TestClient(app, base_url="http://api:5055") as client:
        response = client.post(
            "/api/personal/imports/portable",
            headers={
                "Origin": "https://foreign.example" if foreign else public_origin,
                "Authorization": "Bearer test-deployment-access",
                "Content-Type": "multipart/form-data; boundary=test",
            },
            content=b"--test--\r\n",
        )
    assert response.status_code == (403 if foreign else 200)
    if foreign:
        assert response.json()["error"]["code"] == "CROSS_SITE_REQUEST"
    else:
        assert response.json() == {"accepted": True}
