"""
Tests for the CORS wildcard + allow_credentials fix (api/main.py).

Combining allow_origins=["*"] with allow_credentials=True makes Starlette's
CORSMiddleware reflect the request's Origin header verbatim instead of
returning a literal "*" (browsers reject a literal wildcard alongside
credentials) - defeating the origin allowlist for any credentialed request.
allow_credentials is now keyed on the parsed origins list: False whenever it
contains "*" (whether from the unset default or an explicit CORS_ORIGINS=*),
True once an operator scopes CORS_ORIGINS to specific origins.
"""

from starlette.middleware.cors import CORSMiddleware
from starlette.testclient import TestClient

from api import main as api_main


class TestRealAppDefaultsToNoCredentialsWithWildcard:
    """The test environment has no CORS_ORIGINS set, matching the shipped
    default - this validates the actual registered app, not a simulation."""

    def test_default_test_environment_is_wildcard(self):
        assert api_main.CORS_IS_DEFAULT_WILDCARD is True
        assert api_main.CORS_ALLOWED_ORIGINS == ["*"]
        assert api_main.CORS_ALLOW_CREDENTIALS is False

    def test_cors_middleware_registered_with_credentials_disabled(self):
        matches = [m for m in api_main.app.user_middleware if m.cls is CORSMiddleware]
        assert len(matches) == 1
        assert matches[0].kwargs["allow_credentials"] is False

    def test_real_response_does_not_claim_allow_credentials(self):
        client = TestClient(api_main.app)
        response = client.get("/health", headers={"Origin": "https://evil.example.com"})
        assert response.status_code == 200
        assert "access-control-allow-credentials" not in {
            k.lower() for k in response.headers.keys()
        }
        # Still reflects the origin (wildcard-equivalent), just without
        # granting credentialed access.
        assert response.headers.get("access-control-allow-origin") in (
            "*",
            "https://evil.example.com",
        )
