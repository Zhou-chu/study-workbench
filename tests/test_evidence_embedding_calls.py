"""Fake-only pinned calls: no provider, database, environment keys or sockets."""

from typing import Any

import pytest

from open_notebook.ai.evidence_embeddings import (
    EmbeddingDisclosureStale,
    EmbeddingOutcomeUnknown,
    EmbeddingResponseInvalid,
    EmbeddingUnavailable,
    EvidenceEmbeddingClient,
)
from open_notebook.domain.evidence_retrieval import QueryEmbeddingDisclosure
from tests.evidence_embedding_client_fixture import FakeResolver as FakeResolver
from tests.evidence_embedding_profile_fixture import make_profile


def deployment_boundary(monkeypatch, provider, response_factory):
    """Real resolver + installed SDK, with only model reads and HTTP faked."""
    import httpx
    from pydantic import SecretStr

    from open_notebook.ai import models
    from open_notebook.ai.evidence_embeddings import DeploymentModelResolver
    from open_notebook.domain.credential import Credential

    endpoint = (
        "http://127.0.0.1:11434"
        if provider == "ollama"
        else "http://127.0.0.1:12345/v1"
    )
    profile = make_profile(provider=provider, endpoint=endpoint)
    model = models.Model(
        id=profile.model_id,
        name=profile.model_name,
        provider=provider,
        type="embedding",
        credential=profile.credential_binding_id,
    )
    credential = Credential(
        name="synthetic",
        provider=provider,
        api_key=SecretStr("synthetic-api-secret"),
        base_url=endpoint,
    )
    reads, requests, policies, backends = [], [], [], []

    async def get_model(cls, model_id):
        reads.append(model_id)
        return model

    async def get_credential(self):
        return credential

    def handle(request):
        requests.append(request)
        return response_factory(request)

    original_client, original_async_client = httpx.Client, httpx.AsyncClient

    def sync_client(**kwargs):
        policies.append(("sync", kwargs))
        return original_client(**kwargs)

    def async_client(**kwargs):
        policies.append(("async", kwargs))
        return original_async_client(**kwargs)

    retries = []

    def transport(**kwargs):
        retries.append(kwargs)
        return httpx.MockTransport(handle)

    class TrackingResolver(DeploymentModelResolver):
        async def provision(self, config):
            backend = await super().provision(config)
            backends.append(backend)
            return backend

    monkeypatch.setattr(models.Model, "get", classmethod(get_model))
    monkeypatch.setattr(models.Model, "get_credential_obj", get_credential)
    monkeypatch.setattr(httpx, "Client", sync_client)
    monkeypatch.setattr(httpx, "AsyncClient", async_client)
    monkeypatch.setattr(httpx, "HTTPTransport", transport)
    monkeypatch.setattr(httpx, "AsyncHTTPTransport", transport)
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-select-ambient-secret")
    monkeypatch.setenv("OLLAMA_BASE_URL", "https://must-not-select-ambient.invalid")
    client = EvidenceEmbeddingClient(
        profile_loader=lambda: {profile.profile_id: profile},
        resolver=TrackingResolver(),
        enabled=lambda: True,
    )
    disclosure = QueryEmbeddingDisclosure(
        disclosed_profile_fingerprint=profile.fingerprint,
        destination_descriptor_version=profile.destination_descriptor_version,
        acknowledge_query_processing=True,
    )
    return profile, client, disclosure, reads, requests, policies, retries, backends


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "ollama"])
async def test_installed_adapters_preserve_exact_text_and_explicit_http_policy(
    monkeypatch, provider
):
    import json

    import httpx

    def response(request):
        count = len(json.loads(request.content)["input"])
        payload: dict[str, Any] = (
            {"data": [{"index": i, "embedding": [3, 4]} for i in range(count)]}
            if provider == "openai"
            else {"embeddings": [[3, 4] for _ in range(count)]}
        )
        return httpx.Response(200, json=payload)

    profile, client, disclosure, reads, requests, policies, retries, backends = (
        deployment_boundary(monkeypatch, provider, response)
    )
    originals = ["  original\n界 . .. ,  " + str(i) for i in range(17)]
    assert await client.embed_documents(profile, originals) == [[0.6, 0.8]] * 17
    assert await client.embed_query(
        profile, "  query\n界 ..  ", disclosure=disclosure
    ) == [0.6, 0.8]
    bodies = [json.loads(request.content) for request in requests]
    assert [text for body in bodies[:2] for text in body["input"]] == [
        profile.document_prefix + value for value in originals
    ]
    assert bodies[2]["input"] == [profile.query_prefix + "  query\n界 ..  "]
    for request, body in zip(requests, bodies):
        assert body["model"] == profile.model_name
        assert str(request.url) == profile.endpoint + (
            "/embeddings" if provider == "openai" else "/api/embed"
        )
        assert set(body) == (
            {"model", "input"}
            if provider == "openai"
            else {"model", "input", "truncate"}
        )
        if provider == "ollama":
            assert body["truncate"] is False
        else:
            assert request.headers["Authorization"] == "Bearer synthetic-api-secret"
    assert reads == [profile.model_id] * 3
    assert len(policies) == 6 and all(
        kwargs["trust_env"] is False
        and kwargs["follow_redirects"] is False
        and kwargs["timeout"] == 30
        for _, kwargs in policies
    )
    assert retries == [{"retries": 0}] * 6
    assert all(
        backend.client.is_closed and backend.async_client.is_closed
        for backend in backends
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "ollama"])
@pytest.mark.parametrize("json_body", [True, False])
async def test_installed_adapter_http_errors_never_retain_or_log_synthetic_secrets(
    monkeypatch, provider, json_body, caplog
):
    import logging

    import httpx
    from loguru import logger

    secret = "synthetic-response-secret-private-query"

    def response(request):
        if json_body:
            return httpx.Response(
                400,
                json={"error": {"message": secret} if provider == "openai" else secret},
            )
        return httpx.Response(400, text=secret)

    profile, client, disclosure, _, requests, _, _, _ = deployment_boundary(
        monkeypatch, provider, response
    )
    messages = []
    sink = logger.add(lambda message: messages.append(str(message)), level="TRACE")
    try:
        with caplog.at_level(logging.DEBUG, logger="httpx"):
            with pytest.raises(
                EmbeddingUnavailable, match="EMBEDDING_UNAVAILABLE"
            ) as caught:
                await client.embed_query(
                    profile, "private query", disclosure=disclosure
                )
        error: BaseException | None = caught.value
        while error is not None:
            assert secret not in str(error)
            error = error.__cause__ or error.__context__
        assert secret not in caplog.text + "".join(messages)
        assert "synthetic-api-secret" not in caplog.text + "".join(messages)
        assert len(requests) == 1
    finally:
        logger.remove(sink)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "ollama"])
@pytest.mark.parametrize("vector", [[True, 1], ["3", 4], []])
async def test_installed_adapters_reject_invalid_raw_values_before_sdk_coercion(
    monkeypatch, provider, vector
):
    import httpx

    def response(request):
        return httpx.Response(
            200,
            json={"data": [{"index": 0, "embedding": vector}]}
            if provider == "openai"
            else {"embeddings": [vector]},
        )

    profile, client, disclosure, _, requests, _, _, _ = deployment_boundary(
        monkeypatch, provider, response
    )
    with pytest.raises(EmbeddingResponseInvalid, match="EMBEDDING_INVALID_RESPONSE"):
        await client.embed_query(profile, "query", disclosure=disclosure)
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_installed_openai_adapter_rejects_misordered_vector_identity(monkeypatch):
    import httpx

    profile, client, _, _, requests, _, _, _ = deployment_boundary(
        monkeypatch,
        "openai",
        lambda request: httpx.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [1, 0]},
                    {"index": 0, "embedding": [0, 1]},
                ]
            },
        ),
    )
    with pytest.raises(EmbeddingResponseInvalid):
        await client.embed_documents(profile, ["first", "second"])
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "ollama"])
@pytest.mark.parametrize("failure", ["timeout", "redirect", "malformed"])
async def test_installed_adapter_failure_is_not_replayed(
    monkeypatch, provider, failure
):
    import httpx

    def response(request):
        if failure == "timeout":
            raise httpx.ReadTimeout(
                "synthetic-private-transport-error", request=request
            )
        if failure == "redirect":
            return httpx.Response(
                307, headers={"Location": "https://must-not-follow.invalid"}
            )
        return httpx.Response(200, text="synthetic-private-invalid-json")

    profile, client, disclosure, _, requests, _, _, backends = deployment_boundary(
        monkeypatch, provider, response
    )
    expected = {
        "timeout": EmbeddingOutcomeUnknown,
        "redirect": EmbeddingUnavailable,
        "malformed": EmbeddingResponseInvalid,
    }[failure]
    with pytest.raises(expected):
        await client.embed_query(profile, "private query", disclosure=disclosure)
    assert len(requests) == 1
    assert all(
        backend.client.is_closed and backend.async_client.is_closed
        for backend in backends
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,version",
    [
        ("openai-compatible", "2.28.0"),
        ("azure", "2.28.0"),
        ("openai", "uninspected-version"),
        ("ollama", "uninspected-version"),
    ],
)
async def test_uninspected_provider_or_version_never_constructs_http_clients(
    monkeypatch, provider, version
):
    import httpx

    from open_notebook.ai import evidence_embeddings

    profile, client, disclosure, _, requests, policies, _, backends = (
        deployment_boundary(monkeypatch, provider, lambda request: httpx.Response(200))
    )
    monkeypatch.setattr(evidence_embeddings, "version", lambda name: version)
    with pytest.raises(EmbeddingUnavailable, match="PROFILE_UNAVAILABLE"):
        await client.embed_query(profile, "private query", disclosure=disclosure)
    assert requests == policies == backends == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "credential_endpoint", ["https://faß.de/v1", "https://xn--fa-hia.de/v1"]
)
async def test_distinct_idna_credential_endpoint_cannot_reuse_ascii_disclosure(
    monkeypatch, credential_endpoint
):
    from pydantic import SecretStr

    from open_notebook.ai import models
    from open_notebook.domain.credential import Credential

    profile, client, disclosure, _, requests, policies, _, _ = deployment_boundary(
        monkeypatch, "openai", lambda request: None
    )
    profile = make_profile(provider="openai", endpoint="https://fass.de/v1")
    client._profiles = lambda: {profile.profile_id: profile}
    disclosure = disclosure.model_copy(
        update={"disclosed_profile_fingerprint": profile.fingerprint}
    )
    credential = Credential(
        name="synthetic",
        provider="openai",
        api_key=SecretStr("synthetic-secret"),
        base_url=credential_endpoint,
    )

    async def get_credential(self):
        return credential

    async def no_validation_work(*args, **kwargs):
        pytest.fail("Stale destination must reject before URL validation")

    monkeypatch.setattr(models.Model, "get_credential_obj", get_credential)
    monkeypatch.setattr(models, "_revalidate_config_urls", no_validation_work)
    with pytest.raises(EmbeddingDisclosureStale):
        await client.embed_query(profile, "private query", disclosure=disclosure)
    assert requests == policies == []


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "ollama"])
async def test_untrusted_response_status_fields_cannot_reach_httpx_logs(
    monkeypatch, provider, caplog
):
    import logging

    import httpx

    markers = ["synthetic-private-reason", "synthetic-private-http-version"]
    profile, client, disclosure, _, requests, _, _, _ = deployment_boundary(
        monkeypatch,
        provider,
        lambda request: httpx.Response(
            400,
            text="private body",
            extensions={
                "reason_phrase": markers[0].encode(),
                "http_version": markers[1].encode(),
            },
        ),
    )
    with caplog.at_level(logging.DEBUG, logger="httpx"):
        with pytest.raises(EmbeddingUnavailable):
            await client.embed_query(profile, "private query", disclosure=disclosure)
    assert len(requests) == 1
    assert not any(marker in caplog.text for marker in markers)
    assert "HTTP Request: POST" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "logger_name",
    [
        "httpcore",
        "httpcore.connection",
        "httpcore.http11",
        "httpcore.http2",
        "httpcore.proxy",
        "httpcore.socks",
    ],
)
async def test_transport_debug_mode_fails_closed_without_model_or_data_dispatch(
    monkeypatch, logger_name, caplog
):
    import logging

    profile, client, disclosure, reads, requests, policies, _, _ = deployment_boundary(
        monkeypatch, "openai", lambda request: None
    )
    before = logging.getLogger(logger_name).level
    with caplog.at_level(logging.DEBUG, logger=logger_name):
        with pytest.raises(EmbeddingUnavailable, match="EMBEDDING_DIAGNOSTICS_UNSAFE"):
            await client.embed_query(profile, "private query", disclosure=disclosure)
        assert logging.getLogger(logger_name).isEnabledFor(logging.DEBUG)
    assert logging.getLogger(logger_name).level == before
    assert reads == requests == policies == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fass.de/v1/nested%20path",
        "https://xn--fa-hia.de/v1",
        "http://[::1]:11434/custom",
    ],
)
async def test_accepted_endpoint_is_exactly_disclosed_validated_and_dispatched(
    monkeypatch, endpoint, caplog
):
    import logging
    from urllib.parse import urlsplit

    import httpx
    from pydantic import SecretStr

    from open_notebook.ai import models
    from open_notebook.domain.credential import Credential

    _, client, disclosure, _, requests, _, _, _ = deployment_boundary(
        monkeypatch,
        "openai",
        lambda request: httpx.Response(
            200, json={"data": [{"index": 0, "embedding": [3, 4]}]}
        ),
    )
    profile = make_profile(provider="openai", endpoint=endpoint)
    client._profiles = lambda: {profile.profile_id: profile}
    disclosure = disclosure.model_copy(
        update={"disclosed_profile_fingerprint": profile.fingerprint}
    )
    credential = Credential(
        name="synthetic",
        provider="openai",
        api_key=SecretStr("synthetic-secret"),
        base_url=endpoint,
    )
    validated = []

    async def get_credential(self):
        return credential

    async def validate_without_dns(config, provider):
        validated.append(config["base_url"])

    monkeypatch.setattr(models.Model, "get_credential_obj", get_credential)
    monkeypatch.setattr(models, "_revalidate_config_urls", validate_without_dns)
    with caplog.at_level(logging.INFO, logger="httpx"):
        assert await client.embed_query(
            profile, "private query", disclosure=disclosure
        ) == [0.6, 0.8]
    assert validated == [profile.endpoint] == [endpoint]
    assert len(requests) == 1
    assert (
        requests[0].url.raw_host.decode("ascii") == urlsplit(profile.endpoint).hostname
    )
    assert str(requests[0].url) == profile.endpoint + "/embeddings"
    assert "HTTP Request: POST" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [
        "http://user:synthetic-secret@127.0.0.1:12345/v1",
        "http://127.0.0.1:12345/v1?token=synthetic-secret",
        "http://127.0.0.1:12345/v1#synthetic-secret",
        "http://127.0.0.1:12345/old/../v1",
        "HTTP://127.0.0.1:12345/v1/",
    ],
)
async def test_noncanonical_credential_endpoint_is_not_silently_remapped(
    monkeypatch, endpoint
):
    from pydantic import SecretStr

    from open_notebook.ai import models
    from open_notebook.domain.credential import Credential

    profile, client, disclosure, _, requests, policies, _, _ = deployment_boundary(
        monkeypatch, "openai", lambda request: None
    )
    credential = Credential(
        name="synthetic",
        provider="openai",
        api_key=SecretStr("synthetic-secret"),
        base_url=endpoint,
    )

    async def get_credential(self):
        return credential

    async def no_validation_work(*args, **kwargs):
        pytest.fail("Noncanonical configuration must reject before validation")

    monkeypatch.setattr(models.Model, "get_credential_obj", get_credential)
    monkeypatch.setattr(models, "_revalidate_config_urls", no_validation_work)
    with pytest.raises(EmbeddingDisclosureStale):
        await client.embed_query(profile, "private query", disclosure=disclosure)
    assert requests == policies == []


@pytest.mark.asyncio
@pytest.mark.parametrize("package", ["httpx", "httpcore"])
async def test_uninspected_http_stack_version_never_constructs_clients(
    monkeypatch, package
):
    from open_notebook.ai import evidence_embeddings

    profile, client, disclosure, _, requests, policies, _, _ = deployment_boundary(
        monkeypatch, "openai", lambda request: None
    )
    original = evidence_embeddings.version
    monkeypatch.setattr(
        evidence_embeddings,
        "version",
        lambda name: "uninspected" if name == package else original(name),
    )
    with pytest.raises(EmbeddingUnavailable, match="PROFILE_UNAVAILABLE"):
        await client.embed_query(profile, "private query", disclosure=disclosure)
    assert requests == policies == []
