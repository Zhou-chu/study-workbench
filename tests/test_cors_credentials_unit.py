"""Direct logical-unit cases extracted without changing assertions or parameters."""

from typing import cast

from starlette.requests import Request

from api import main as api_main


class TestExplicitWildcardAlsoDisablesCredentials:
    """An operator who sets CORS_ORIGINS=* explicitly must get the same
    treatment as the unset default. The predicate keys on the parsed list
    containing "*", not on whether the env var was set - keying on the env
    var would reintroduce the exact reflect-any-Origin behavior this fix
    prevents. CORS_ALLOW_CREDENTIALS is fixed at api.main import time, so
    these exercise the real parser plus the same expression used there."""

    def test_explicit_wildcard_disables_credentials(self):
        origins = api_main._parse_cors_origins("*")
        assert origins == ["*"]
        assert ("*" not in origins) is False

    def test_explicit_origins_enable_credentials(self):
        origins = api_main._parse_cors_origins(
            "https://notebook.example.com, https://other.example.com"
        )
        assert origins == [
            "https://notebook.example.com",
            "https://other.example.com",
        ]
        assert ("*" not in origins) is True


class TestCorsHeadersHelperMatchesMiddlewarePolicy:
    """api/main.py's _cors_headers() manually builds CORS headers for error
    responses (for errors raised before CORSMiddleware runs) - it must not
    grant credentials the real middleware wouldn't."""

    def test_omits_allow_credentials_header_for_wildcard(self, monkeypatch):
        monkeypatch.setattr(api_main, "CORS_ALLOW_CREDENTIALS", False)
        monkeypatch.setattr(api_main, "CORS_ALLOWED_ORIGINS", ["*"])

        class FakeRequest:
            headers = {"origin": "https://evil.example.com"}

        # cast: _cors_headers only reads request.headers
        headers = api_main._cors_headers(cast(Request, FakeRequest()))
        assert "Access-Control-Allow-Credentials" not in headers

    def test_includes_allow_credentials_header_for_explicit_origins(self, monkeypatch):
        monkeypatch.setattr(api_main, "CORS_ALLOW_CREDENTIALS", True)
        monkeypatch.setattr(
            api_main, "CORS_ALLOWED_ORIGINS", ["https://notebook.example.com"]
        )

        class FakeRequest:
            headers = {"origin": "https://notebook.example.com"}

        # cast: _cors_headers only reads request.headers
        headers = api_main._cors_headers(cast(Request, FakeRequest()))
        assert headers["Access-Control-Allow-Credentials"] == "true"

    def test_disallowed_origin_still_gets_no_allow_origin_header(self, monkeypatch):
        monkeypatch.setattr(api_main, "CORS_ALLOW_CREDENTIALS", True)
        monkeypatch.setattr(
            api_main, "CORS_ALLOWED_ORIGINS", ["https://notebook.example.com"]
        )

        class FakeRequest:
            headers = {"origin": "https://evil.example.com"}

        # cast: _cors_headers only reads request.headers
        headers = api_main._cors_headers(cast(Request, FakeRequest()))
        assert "Access-Control-Allow-Origin" not in headers
