"""Provider protocol tests; no real provider or target website is contacted."""

import asyncio

import httpx
import pytest

from api.web_discovery_provider import FirecrawlProvider, public_web_url
from open_notebook.exceptions import (
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    RateLimitError,
)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/x",
        "http://127.0.0.1",
        "http://10.0.0.1",
        "http://[::ffff:127.0.0.1]",
        "http://169.254.169.254",
        "http://[fd00:ec2::254]",
        "https://user:pass@example.com",
        "https://example.com:8000",
        "https://example.com\\@localhost",
        "https://example.com/\nsecret",
    ],
)
def test_public_url_rejects_unsafe_targets(url):
    with pytest.raises(InvalidInputError, match="WEB_INVALID_URL"):
        public_web_url(url)


def test_public_url_canonicalization_preserves_meaningful_query():
    assert (
        public_web_url("HTTPS://Example.COM:443/path?a=1#section")
        == "https://example.com/path?a=1"
    )


@pytest.mark.asyncio
async def test_unconfigured_provider_never_dispatches(monkeypatch):
    monkeypatch.delenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    monkeypatch.delenv("FIRECRAWL_API_KEY_FILE", raising=False)
    provider = FirecrawlProvider()
    assert provider.status().state == "configuration_required"
    assert provider.status().access_mode == "api_key"
    with pytest.raises(ConfigurationError, match="WEB_SEARCH_CONFIGURATION_REQUIRED"):
        await provider.search("private query", 6)


@pytest.mark.asyncio
@pytest.mark.parametrize("ambient_key", [False, True])
async def test_explicit_keyless_trial_search_and_scrape_never_send_or_read_key(
    monkeypatch, ambient_key
):
    monkeypatch.setenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "keyless_trial")
    if ambient_key:
        monkeypatch.setenv("FIRECRAWL_API_KEY", "ambient-do-not-send")
        monkeypatch.setenv("FIRECRAWL_API_KEY_FILE", "/not-read-in-trial")
    else:
        monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
        monkeypatch.delenv("FIRECRAWL_API_KEY_FILE", raising=False)

    def forbidden_key_read(*args):
        raise AssertionError("Trial must not read ambient credentials")

    monkeypatch.setattr(
        "api.web_discovery_provider.get_secret_from_env", forbidden_key_read
    )
    requests = []

    async def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={"success": True, "data": {"web": [], "markdown": "Trial snapshot"}},
        )

    provider = FirecrawlProvider(
        api_key="injected-do-not-send" if ambient_key else None,
        transport=httpx.MockTransport(respond),
    )
    status = provider.status()
    assert status.state == "ready"
    assert status.access_mode == "keyless_trial"
    assert status.automatic_paid_fallback is False
    assert status.externally_verified is False
    assert status.trial_limits.model_dump() == {
        "scope": "server_ip",
        "period": "daily",
        "numeric_caps_published": False,
    }
    assert requests == []
    await provider.search("explicit trial query", 1)
    await provider.scrape("https://example.com/article")
    assert len(requests) == 2
    assert all("authorization" not in request.headers for request in requests)
    assert all(request.url.host == "api.firecrawl.dev" for request in requests)


@pytest.mark.asyncio
async def test_unsupported_access_mode_fails_closed(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "automatic")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200)

    provider = FirecrawlProvider(
        api_key="present-key", transport=httpx.MockTransport(respond)
    )
    assert provider.status().access_mode is None
    assert provider.status().state == "configuration_required"
    with pytest.raises(ConfigurationError, match="WEB_SEARCH_UNSUPPORTED_ACCESS_MODE"):
        await provider.search("query", 1)
    assert requests == []


@pytest.mark.asyncio
async def test_trial_quota_rejection_never_retries_or_falls_back_to_ambient_key(
    monkeypatch,
):
    monkeypatch.setenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "keyless_trial")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "do-not-send")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(429, json={"error": "provider details not exposed"})

    provider = FirecrawlProvider(transport=httpx.MockTransport(respond))
    with pytest.raises(RateLimitError, match="WEB_PROVIDER_RATE_LIMIT"):
        await provider.search("query", 1)
    assert len(requests) == 1
    assert "authorization" not in requests[0].headers


@pytest.mark.asyncio
async def test_trial_rejects_nonfixed_provider_origin_before_dispatch(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_WEB_SEARCH_MODE", "keyless_trial")
    monkeypatch.setenv("FIRECRAWL_API_URL", "http://127.0.0.1:3002")
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200)

    provider = FirecrawlProvider(transport=httpx.MockTransport(respond))
    assert provider.status().state == "configuration_required"
    with pytest.raises(ConfigurationError, match="WEB_SEARCH_UNSUPPORTED_API_ORIGIN"):
        await provider.search("query", 1)
    assert requests == []


@pytest.mark.asyncio
async def test_search_protocol_bounded_deduped_plain_metadata():
    requests = []

    async def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "web": [
                        {
                            "url": "https://example.com/a#one",
                            "title": "Title",
                            "description": "Snippet",
                        },
                        {"url": "https://example.com/a#two", "title": "Duplicate"},
                        {"url": "http://127.0.0.1/", "title": "Private"},
                    ]
                },
            },
        )

    provider = FirecrawlProvider(
        api_key="test-secret", transport=httpx.MockTransport(respond)
    )
    result = await provider.search("topic", 6)
    assert len(result.results) == 1
    assert result.results[0].snippet == "Snippet"
    assert str(requests[0].url) == "https://api.firecrawl.dev/v2/search"
    assert requests[0].headers["Authorization"] == "Bearer test-secret"
    body = __import__("json").loads(requests[0].content)
    assert body["sources"] == ["web"]
    assert "scrapeOptions" not in body
    assert "notebook" not in requests[0].content.decode()


@pytest.mark.asyncio
async def test_scrape_only_contacts_fixed_provider_and_disables_escalation():
    requests = []

    async def respond(request):
        requests.append(request)
        return httpx.Response(
            200, json={"success": True, "data": {"markdown": "# Real retrieved text"}}
        )

    provider = FirecrawlProvider(
        api_key="test-secret", transport=httpx.MockTransport(respond)
    )
    assert (
        await provider.scrape("https://example.com/article") == "# Real retrieved text"
    )
    assert len(requests) == 1
    assert str(requests[0].url) == "https://api.firecrawl.dev/v2/scrape"
    body = __import__("json").loads(requests[0].content)
    assert body["proxy"] == "basic"
    assert body["parsers"] == []
    assert body["skipTlsVerification"] is False
    assert body["storeInCache"] is False
    assert body["onlyCleanContent"] is False
    assert not {"actions", "headers", "cookies"}.intersection(body)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"success": False, "error": "test-secret private query"},
        {"success": True, "data": {}},
        {"wrong": "shape"},
    ],
)
async def test_malformed_or_error_response_is_not_empty_success(body):
    provider = FirecrawlProvider(
        api_key="test-secret",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body)),
    )
    with pytest.raises(ExternalServiceError) as caught:
        await provider.search("private query", 6)
    assert "test-secret" not in str(caught.value)
    assert "private query" not in str(caught.value)


@pytest.mark.asyncio
async def test_redirect_is_not_followed_or_reported_as_empty_success():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={"Location": "http://169.254.169.254"})

    provider = FirecrawlProvider(
        api_key="test-secret", transport=httpx.MockTransport(respond)
    )
    with pytest.raises(ExternalServiceError):
        await provider.search("topic", 6)
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_provider_cancellation_does_not_retry():
    calls = 0
    started = asyncio.Event()

    async def respond(request):
        nonlocal calls
        calls += 1
        started.set()
        await asyncio.sleep(100)

    provider = FirecrawlProvider(
        api_key="test-secret", transport=httpx.MockTransport(respond)
    )
    task = asyncio.create_task(provider.search("topic", 6))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls == 1


@pytest.mark.asyncio
async def test_empty_scrape_is_never_importable():
    provider = FirecrawlProvider(
        api_key="test-secret",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, json={"success": True, "data": {"markdown": " "}}
            )
        ),
    )
    with pytest.raises(InvalidInputError, match="WEB_EMPTY_CONTENT"):
        await provider.scrape("https://example.com")
