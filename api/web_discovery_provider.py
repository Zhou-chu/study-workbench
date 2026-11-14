"""Bounded Firecrawl adapter. Never dispatches HTTP to a result/selected URL.

Provider responses are data, not tool instructions. No AI model, browser action,
automatic retry, enhanced proxy, or automatic access-mode fallback is used here.
"""

import asyncio
import hashlib
import ipaddress
import json
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx

from api.web_discovery_contracts import (
    WebResult,
    WebSearchResponse,
    WebSearchStatus,
    WebTrialLimits,
)
from open_notebook.exceptions import (
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    RateLimitError,
)
from open_notebook.utils.encryption import get_secret_from_env

API_ORIGIN = "https://api.firecrawl.dev"
SEARCH_RESPONSE_BYTES = 1024 * 1024
SCRAPE_RESPONSE_BYTES = 5 * 1024 * 1024
SNAPSHOT_BYTES = 2 * 1024 * 1024


def public_web_url(value: str) -> str:
    """Conservative URL metadata validation, not a DNS-to-connect SSRF guard.

    The actual SSRF boundary is the fixed provider origin below: this application
    does not connect to these URLs, resolve redirects, or fetch embedded resources.
    """
    try:
        if not value or len(value) > 2048 or re.search(r"[\x00-\x20\x7f\\]", value):
            raise ValueError
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower().encode("idna").decode()
        if parsed.scheme.lower() not in {"http", "https"} or not host:
            raise ValueError
        if parsed.username is not None or parsed.password is not None:
            raise ValueError
        if parsed.port not in (None, 80 if parsed.scheme.lower() == "http" else 443):
            raise ValueError
        if "%" in host or host in {"localhost", "localhost.localdomain"}:
            raise ValueError
        if host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
            raise ValueError
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            # Reject single-label and ambiguous numeric/octal/hex host spellings.
            if (
                "." not in host
                or re.fullmatch(r"[0-9.]+", host)
                or host.startswith("0x")
            ):
                raise ValueError
            if not re.fullmatch(r"[a-z0-9.-]+", host):
                raise ValueError
        else:
            mapped = getattr(address, "ipv4_mapped", None)
            if not address.is_global or (mapped and not mapped.is_global):
                raise ValueError
            host = f"[{address}]" if address.version == 6 else str(address)
        return urlunsplit(
            (parsed.scheme.lower(), host, parsed.path or "/", parsed.query, "")
        )
    except (ValueError, UnicodeError):
        raise InvalidInputError("WEB_INVALID_URL") from None


class FirecrawlProvider:
    def __init__(self, *, api_key: str | None = None, transport=None):
        # Dependency overrides are for protocol tests, never accepted by the API.
        self._override_key = api_key
        self._transport = transport

    def status(self) -> WebSearchStatus:
        mode = os.getenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "api_key").strip()
        if mode not in {"api_key", "keyless_trial"}:
            return WebSearchStatus(
                state="configuration_required",
                configured=False,
                access_mode=None,
                reason="WEB_SEARCH_UNSUPPORTED_ACCESS_MODE",
            )
        status = WebSearchStatus(
            state="configuration_required",
            configured=False,
            access_mode="keyless_trial" if mode == "keyless_trial" else "api_key",
            trial_limits=WebTrialLimits() if mode == "keyless_trial" else None,
        )
        configured_origin = os.getenv("FIRECRAWL_API_URL", API_ORIGIN).rstrip("/")
        if configured_origin != API_ORIGIN:
            status.reason = "WEB_SEARCH_UNSUPPORTED_API_ORIGIN"
            return status
        if mode == "keyless_trial":
            # Explicit opt-in is isolated from credentials, even when an account
            # key or key-file happens to exist. Never silently upgrade this mode.
            status.state, status.configured = "ready", True
            return status
        try:
            key = self._override_key or get_secret_from_env("FIRECRAWL_API_KEY")
        except Exception:
            key = None
        if not key or not key.strip():
            status.reason = "WEB_SEARCH_CONFIGURATION_REQUIRED"
            return status
        status.state, status.configured = "ready", True
        return status

    def _key(self) -> str | None:
        status = self.status()
        if not status.configured:
            raise ConfigurationError(status.reason)
        if status.access_mode == "keyless_trial":
            return None
        return (
            self._override_key or get_secret_from_env("FIRECRAWL_API_KEY") or ""
        ).strip()

    async def _post(self, endpoint: str, payload: dict, *, limit: int, seconds: float):
        if endpoint not in {"search", "scrape"}:
            raise ValueError("Unsupported provider operation")
        key = self._key()
        headers = {"Accept": "application/json"}
        if key is not None:
            headers["Authorization"] = f"Bearer {key}"
        try:
            async with asyncio.timeout(seconds):
                async with httpx.AsyncClient(
                    transport=self._transport,
                    timeout=httpx.Timeout(seconds, connect=5),
                    follow_redirects=False,
                    trust_env=False,
                ) as client:
                    async with client.stream(
                        "POST",
                        f"{API_ORIGIN}/v2/{endpoint}",
                        json=payload,
                        headers=headers,
                    ) as response:
                        if response.status_code in {401, 403}:
                            raise ConfigurationError(
                                "WEB_SEARCH_CONFIGURATION_REQUIRED"
                            )
                        if response.status_code in {402, 429}:
                            raise RateLimitError("WEB_PROVIDER_RATE_LIMIT")
                        if response.status_code != 200:
                            raise ExternalServiceError("WEB_PROVIDER_ERROR")
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > limit:
                                raise InvalidInputError("WEB_RESPONSE_TOO_LARGE")
            result = json.loads(content)
        except (TimeoutError, httpx.TimeoutException):
            raise NetworkError("WEB_PROVIDER_TIMEOUT") from None
        except httpx.HTTPError:
            raise NetworkError("WEB_PROVIDER_ERROR") from None
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ExternalServiceError("WEB_PROVIDER_ERROR") from None
        if (
            not isinstance(result, dict)
            or result.get("success") is not True
            or not isinstance(result.get("data"), dict)
        ):
            raise ExternalServiceError("WEB_PROVIDER_ERROR")
        return result["data"]

    async def search(self, query: str, limit: int) -> WebSearchResponse:
        data = await self._post(
            "search",
            {
                "query": query,
                "limit": limit,
                "sources": ["web"],
                "timeout": 15000,
                "domainTools": False,
            },
            limit=SEARCH_RESPONSE_BYTES,
            seconds=20,
        )
        rows = data.get("web")
        if not isinstance(rows, list):
            raise ExternalServiceError("WEB_PROVIDER_ERROR")
        results = []
        seen = set()
        for row in rows[:100]:
            if not isinstance(row, dict) or not isinstance(row.get("url"), str):
                continue
            try:
                url = public_web_url(row["url"])
            except InvalidInputError:
                continue
            if url in seen:
                continue
            seen.add(url)
            title = row.get("title")
            if not isinstance(title, str):
                title = url
            snippet = row.get("description")
            if not isinstance(snippet, str):
                snippet = ""
            results.append(
                WebResult(
                    id=hashlib.sha256(url.encode()).hexdigest(),
                    url=url,
                    title=title[:500] or url,
                    snippet=snippet[:2000],
                    domain=urlsplit(url).hostname or "",
                )
            )
            if len(results) >= limit:
                break
        return WebSearchResponse(
            searched_at=datetime.now(timezone.utc).isoformat(),
            results=results,
            total_count=len(results),
        )

    async def scrape(self, url: str) -> str:
        url = public_web_url(url)
        data = await self._post(
            "scrape",
            {
                "url": url,
                "formats": ["markdown"],
                "onlyMainContent": True,
                "onlyCleanContent": False,
                "proxy": "basic",
                "skipTlsVerification": False,
                "storeInCache": False,
                "parsers": [],
                "timeout": 30000,
            },
            limit=SCRAPE_RESPONSE_BYTES,
            seconds=35,
        )
        text = data.get("markdown")
        if not isinstance(text, str) or not text.strip():
            raise InvalidInputError("WEB_EMPTY_CONTENT")
        if len(text.encode()) > SNAPSHOT_BYTES:
            raise InvalidInputError("WEB_RESPONSE_TOO_LARGE")
        return text
