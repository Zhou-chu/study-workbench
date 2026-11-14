"""Fake-only pinned calls: no provider, database, environment keys or sockets."""

import asyncio
from dataclasses import replace
from typing import Any

import pytest

from open_notebook.ai.evidence_embeddings import (
    EmbeddingDisclosureStale,
    EmbeddingInputInvalid,
    EmbeddingOutcomeUnknown,
    EmbeddingResponseInvalid,
    EmbeddingUnavailable,
    EvidenceEmbeddingClient,
    FrozenEmbeddingConfiguration,
)
from open_notebook.domain.evidence_retrieval import QueryEmbeddingDisclosure
from tests.test_evidence_embedding_profiles import make_profile


class DisclosedTestClient(EvidenceEmbeddingClient):
    test_disclosure: Any


class FakeResolver:
    def __init__(self, profile):
        self.profile = profile
        self.default_model_id = "model:unrelated-default"
        self.endpoint = profile.endpoint
        self.model_name = profile.model_name
        self.model_type = "embedding"
        self.calls = []
        self.provisions = []
        self.resolutions = []
        self.result = None
        self.failure = None
        self.on_provision = None
        self.active = 0
        self.max_active = 0

    async def resolve(self, profile):
        self.resolutions.append(profile.model_id)
        return FrozenEmbeddingConfiguration(
            model_id=profile.model_id,
            model_type=self.model_type,
            provider=profile.provider,
            model_name=self.model_name,
            credential_binding_id=profile.credential_binding_id,
            endpoint=self.endpoint,
            api_key="fake-test-secret",
            no_retry=True,
        )

    async def provision(self, config):
        self.provisions.append(config)
        if self.on_provision:
            self.on_provision()
        return self

    async def aembed(self, texts):
        self.calls.append(list(texts))
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await asyncio.sleep(0)
            if self.failure:
                raise self.failure
            return (
                self.result if self.result is not None else [[3.0, 4.0] for _ in texts]
            )
        finally:
            self.active -= 1

    async def aclose(self):
        pass


def setup_client(*, acknowledged=True, disclosure=True, **changes):
    profile = make_profile(**changes)
    current = {profile.profile_id: profile}
    fake = FakeResolver(profile)
    ack = (
        QueryEmbeddingDisclosure(
            disclosed_profile_fingerprint=profile.fingerprint,
            destination_descriptor_version=profile.destination_descriptor_version,
            acknowledge_query_processing=acknowledged,
        )
        if disclosure
        else None
    )
    client = DisclosedTestClient(
        profile_loader=lambda: current, resolver=fake, enabled=lambda: True
    )
    client.test_disclosure = ack
    return profile, current, fake, client


@pytest.mark.asyncio
async def test_default_model_change_does_not_change_pinned_model():
    profile, _, fake, client = setup_client()
    fake.default_model_id = "model:rotated-default"
    assert await client.embed_query(
        profile, "  unchanged\nquery  ", disclosure=client.test_disclosure
    ) == [0.6, 0.8]
    assert fake.resolutions == [profile.model_id]
    assert fake.provisions[0].model_name == profile.model_name
    assert fake.calls == [["query:   unchanged\nquery  "]]
    assert "fake-test-secret" not in repr(fake.provisions[0])


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["endpoint", "model_name", "model_type"])
async def test_model_configuration_change_rejects_before_send(change):
    profile, _, fake, client = setup_client()
    setattr(
        fake, change, "https://changed.invalid" if change == "endpoint" else "changed"
    )
    with pytest.raises(EmbeddingDisclosureStale, match="EMBEDDING_DISCLOSURE_STALE"):
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert fake.calls == []
    assert fake.provisions == []


@pytest.mark.asyncio
@pytest.mark.parametrize("rotation_time", ["before_acceptance", "during_provision"])
async def test_acknowledged_profile_a_rotated_to_b_rejects_before_provision_or_send(
    rotation_time,
):
    profile, current, fake, client = setup_client()
    changed = make_profile(endpoint="https://b.invalid", model_name="same-dimension-b")
    if rotation_time == "before_acceptance":
        current[profile.profile_id] = changed
    else:
        fake.on_provision = lambda: current.update({profile.profile_id: changed})
    with pytest.raises(EmbeddingDisclosureStale):
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert fake.calls == []
    if rotation_time == "before_acceptance":
        assert fake.provisions == []
        assert fake.resolutions == []


@pytest.mark.asyncio
async def test_provision_uses_checked_frozen_configuration_not_mutable_destination():
    profile, _, fake, client = setup_client()
    fake.on_provision = lambda: setattr(fake, "endpoint", "https://rotated.invalid")
    await client.embed_query(profile, "query", disclosure=client.test_disclosure)
    assert fake.provisions[0].endpoint == profile.endpoint
    assert fake.provisions[0].endpoint != fake.endpoint


@pytest.mark.asyncio
@pytest.mark.parametrize("acknowledged,disclosure", [(False, True), (True, False)])
async def test_missing_acknowledgment_never_provisions_or_sends(
    acknowledged, disclosure
):
    profile, _, fake, client = setup_client(
        acknowledged=acknowledged, disclosure=disclosure
    )
    with pytest.raises(EmbeddingInputInvalid):
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert fake.calls == []
    assert fake.provisions == []
    assert fake.resolutions == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        [],
        [[1]],
        [[0, 0]],
        [[float("nan"), 1]],
        [[float("inf"), 1]],
        [[True, 1]],
        [["1", 2]],
        [[1, 0], [0, 1]],
        None,
    ],
)
async def test_invalid_vectors_and_response_count_fail(result):
    profile, _, fake, client = setup_client()
    fake.result = result
    if result is None:

        async def invalid(_texts):
            fake.calls.append(_texts)
            return None

        fake.aembed = invalid
    with pytest.raises(EmbeddingResponseInvalid, match="EMBEDDING_INVALID_RESPONSE"):
        await client.embed_query(profile, "q", disclosure=client.test_disclosure)
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_timeout_is_unknown_and_not_retried():
    profile, _, fake, client = setup_client()
    fake.failure = TimeoutError("provider-body fake-test-secret private query")
    with pytest.raises(
        EmbeddingOutcomeUnknown, match="EMBEDDING_OUTCOME_UNKNOWN"
    ) as error:
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert len(fake.calls) == 1
    assert error.value.__cause__ is None
    assert "fake-test-secret" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.asyncio
async def test_other_provider_errors_are_sanitized_and_never_replayed():
    profile, _, fake, client = setup_client()
    fake.failure = RuntimeError("provider-body fake-test-secret private query")
    with pytest.raises(EmbeddingUnavailable, match="EMBEDDING_UNAVAILABLE") as error:
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert len(fake.calls) == 1
    assert "fake-test-secret" not in str(error.value)
    assert error.value.__cause__ is None


@pytest.mark.asyncio
async def test_oversize_input_is_not_truncated():
    profile, _, fake, client = setup_client(max_input_bytes=12)
    with pytest.raises(EmbeddingInputInvalid, match="EMBEDDING_INPUT_TOO_LARGE"):
        await client.embed_query(
            profile, "界界", disclosure=client.test_disclosure
        )  # prefix + UTF-8 exceeds 12
    with pytest.raises(EmbeddingInputInvalid):
        await client.embed_documents(profile, ["ok"] * 16 + ["too large" * 3])
    assert fake.calls == []
    assert fake.provisions == []
    assert fake.resolutions == []


@pytest.mark.asyncio
async def test_documents_batch_16_without_chunking_and_worker_serializes_clients():
    profile, _, fake, client = setup_client()
    texts = [f" original\n{i}  " for i in range(33)]
    vectors, query = await asyncio.gather(
        client.embed_documents(profile, texts),
        client.embed_query(profile, "question", disclosure=client.test_disclosure),
    )
    assert len(vectors) == 33 and query == [0.6, 0.8]
    documents = [batch for batch in fake.calls if batch[0].startswith("passage:")]
    assert [len(batch) for batch in documents] == [16, 16, 1]
    assert [text for batch in documents for text in batch] == [
        profile.document_prefix + text for text in texts
    ]
    assert fake.max_active == 1


@pytest.mark.asyncio
async def test_empty_documents_and_invalid_input_do_not_provision():
    profile, _, fake, client = setup_client()
    assert await client.embed_documents(profile, []) == []
    for query in ["", "  ", None, 42]:
        with pytest.raises(EmbeddingInputInvalid):
            await client.embed_query(profile, query, disclosure=client.test_disclosure)
    assert fake.calls == []
    assert fake.provisions == []


@pytest.mark.asyncio
async def test_uncontrolled_retries_are_unavailable_before_provision():
    profile, _, fake, client = setup_client()
    original = fake.resolve

    async def unsupported(profile):
        return replace(await original(profile), no_retry=False)

    fake.resolve = unsupported
    with pytest.raises(EmbeddingUnavailable):
        await client.embed_query(profile, "query", disclosure=client.test_disclosure)
    assert fake.calls == [] and fake.provisions == []


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
async def test_forged_disclosure_cannot_bypass_strict_boolean_acknowledgment():
    profile, _, fake, client = setup_client()
    forged = client.test_disclosure.model_copy(
        update={"acknowledge_query_processing": "false"}
    )
    with pytest.raises(EmbeddingInputInvalid):
        await client.embed_query(profile, "query", disclosure=forged)
    assert fake.resolutions == [] and fake.provisions == [] and fake.calls == []


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
async def test_disabled_feature_never_resolves_models():
    profile, current, fake, old_client = setup_client()
    client = EvidenceEmbeddingClient(
        profile_loader=lambda: current, resolver=fake, enabled=lambda: False
    )
    with pytest.raises(EmbeddingUnavailable, match="FEATURE_DISABLED"):
        await client.embed_query(profile, "q", disclosure=old_client.test_disclosure)
    assert fake.resolutions == fake.provisions == fake.calls == []


@pytest.mark.asyncio
async def test_profile_rotation_between_document_batches_stops_without_partial_result():
    profile, current, fake, client = setup_client()
    original = fake.aembed

    async def rotate_after_first(texts):
        result = await original(texts)
        current[profile.profile_id] = make_profile(revision="changed-after-first-batch")
        return result

    fake.aembed = rotate_after_first
    with pytest.raises(EmbeddingDisclosureStale):
        await client.embed_documents(profile, ["document"] * 17)
    assert len(fake.calls) == len(fake.provisions) == 1


@pytest.mark.asyncio
async def test_distinct_clients_share_one_worker_dispatch_slot():
    profile, current, fake, client = setup_client()
    other_client = EvidenceEmbeddingClient(
        profile_loader=lambda: current, resolver=fake, enabled=lambda: True
    )
    await asyncio.gather(
        client.embed_query(profile, "one", disclosure=client.test_disclosure),
        other_client.embed_query(profile, "two", disclosure=client.test_disclosure),
    )
    assert fake.max_active == 1 and len(fake.calls) == 2


@pytest.mark.asyncio
async def test_deadline_cancels_inflight_dispatch_without_replay(monkeypatch):
    from open_notebook.ai import evidence_embeddings

    profile, _, fake, client = setup_client()
    monkeypatch.setattr(evidence_embeddings, "TIMEOUT_SECONDS", 0.01)

    async def stalled(texts):
        fake.calls.append(texts)
        await asyncio.Event().wait()

    fake.aembed = stalled
    with pytest.raises(EmbeddingOutcomeUnknown):
        await client.embed_query(
            profile, "private query", disclosure=client.test_disclosure
        )
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_unrepresentable_numeric_response_is_invalid_not_unavailable():
    profile, _, fake, client = setup_client()
    fake.result = [[10**400, 1]]
    with pytest.raises(EmbeddingResponseInvalid):
        await client.embed_query(profile, "q", disclosure=client.test_disclosure)
    assert len(fake.calls) == 1


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


@pytest.mark.asyncio
async def test_debug_mode_change_during_provision_is_rejected_before_send(caplog):
    import logging
    from contextlib import ExitStack

    profile, _, fake, client = setup_client()
    with ExitStack() as stack:
        fake.on_provision = lambda: stack.enter_context(
            caplog.at_level(logging.DEBUG, logger="httpcore.http11")
        )
        with pytest.raises(EmbeddingUnavailable, match="EMBEDDING_DIAGNOSTICS_UNSAFE"):
            await client.embed_query(
                profile, "private query", disclosure=client.test_disclosure
            )
        assert fake.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("rejected_check", [1, 2, 3])
@pytest.mark.parametrize("code", ["SCOPE_CHANGED", "INDEX_READ_UNAVAILABLE"])
async def test_query_dispatch_admission_failure_is_hard_before_each_boundary(
    rejected_check, code
):
    from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

    profile, _, fake, client = setup_client()
    checks = 0
    error_type = (
        InvalidInputError if code == "SCOPE_CHANGED" else DatabaseOperationError
    )

    async def admission():
        nonlocal checks
        checks += 1
        if checks == rejected_check:
            raise error_type(code)

    with pytest.raises(error_type, match=code) as caught:
        await client.embed_query(
            profile,
            "q",
            disclosure=client.test_disclosure,
            dispatch_admission=admission,
        )
    assert caught.value.__cause__ is caught.value.__context__ is None
    assert checks == rejected_check
    assert len(fake.provisions) == (1 if rejected_check == 3 else 0)
    assert fake.calls == []


@pytest.mark.asyncio
async def test_query_admission_is_per_call_and_never_applies_to_documents():
    profile, _, fake, client = setup_client()
    admitted = []

    async def first():
        admitted.append("first")

    async def second():
        admitted.append("second")

    await asyncio.gather(
        client.embed_query(
            profile,
            "first",
            disclosure=client.test_disclosure,
            dispatch_admission=first,
        ),
        client.embed_query(
            profile,
            "second",
            disclosure=client.test_disclosure,
            dispatch_admission=second,
        ),
        client.embed_documents(profile, ["document"]),
    )
    assert admitted == ["first"] * 3 + ["second"] * 3
    assert len(fake.calls) == 3
    assert fake.max_active == 1
    await client.embed_query(
        profile, "without callback", disclosure=client.test_disclosure
    )
    await client.embed_documents(profile, ["next document"])
    assert len(admitted) == 6


@pytest.mark.asyncio
async def test_cancelled_query_admission_does_not_leak_into_next_query_or_documents():
    profile, _, fake, client = setup_client()
    checks = 0

    async def cancelled():
        nonlocal checks
        checks += 1
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await client.embed_query(
            profile,
            "q",
            disclosure=client.test_disclosure,
            dispatch_admission=cancelled,
        )
    assert fake.resolutions == fake.provisions == fake.calls == []
    await client.embed_query(profile, "next", disclosure=client.test_disclosure)
    await client.embed_documents(profile, ["document"])
    assert checks == 1
    assert len(fake.calls) == 2


@pytest.mark.asyncio
async def test_documents_keep_original_missing_profile_unavailable_behavior():
    profile, current, fake, client = setup_client()
    current.clear()
    with pytest.raises(EmbeddingUnavailable, match="PROFILE_UNAVAILABLE"):
        await client.embed_documents(profile, ["document"])
    assert fake.resolutions == fake.provisions == fake.calls == []


@pytest.mark.asyncio
async def test_scope_admission_deadline_is_read_error_not_unknown_provider_send(
    monkeypatch,
):
    from open_notebook.ai import evidence_embeddings
    from open_notebook.exceptions import DatabaseOperationError

    profile, _, fake, client = setup_client()
    monkeypatch.setattr(evidence_embeddings, "TIMEOUT_SECONDS", 0.01)
    checks = 0

    async def admission():
        nonlocal checks
        checks += 1
        if checks == 2:
            await asyncio.Event().wait()

    with pytest.raises(DatabaseOperationError, match="INDEX_READ_UNAVAILABLE"):
        await client.embed_query(
            profile,
            "q",
            disclosure=client.test_disclosure,
            dispatch_admission=admission,
        )
    assert fake.provisions == fake.calls == []


@pytest.mark.asyncio
async def test_callers_without_dispatch_admission_keep_existing_configuration_check_count():
    profile, current, fake, old_client = setup_client()
    reads = 0

    def profiles():
        nonlocal reads
        reads += 1
        return current

    client = EvidenceEmbeddingClient(
        profile_loader=profiles, resolver=fake, enabled=lambda: True
    )
    await client.embed_documents(profile, ["document"])
    assert reads == 3
    await client.embed_query(profile, "query", disclosure=old_client.test_disclosure)
    assert reads == 6


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "error", "cancelled"])
async def test_query_admission_context_restores_exact_parent_value_after_every_exit(
    outcome,
):
    from open_notebook.ai import evidence_embeddings
    from open_notebook.exceptions import InvalidInputError

    profile, _, fake, client = setup_client()
    parent_calls = []

    async def parent_admission():
        parent_calls.append("must not run")

    async def admission():
        if outcome == "error":
            raise InvalidInputError("SCOPE_CHANGED")
        if outcome == "cancelled":
            raise asyncio.CancelledError()

    token = evidence_embeddings._QUERY_ADMISSION.set(parent_admission)
    try:
        if outcome == "success":
            await client.embed_query(
                profile,
                "q",
                disclosure=client.test_disclosure,
                dispatch_admission=admission,
            )
        else:
            error_type = (
                InvalidInputError if outcome == "error" else asyncio.CancelledError
            )
            with pytest.raises(error_type):
                await client.embed_query(
                    profile,
                    "q",
                    disclosure=client.test_disclosure,
                    dispatch_admission=admission,
                )
        assert evidence_embeddings._QUERY_ADMISSION.get() is parent_admission
        # Default queries explicitly clear inherited admission for this call;
        # documents ignore it. Both restore, rather than discard, parent state.
        await client.embed_query(
            profile, "default query", disclosure=client.test_disclosure
        )
        await client.embed_documents(profile, ["document"])
        assert evidence_embeddings._QUERY_ADMISSION.get() is parent_admission
        assert parent_calls == []
        assert len(fake.calls) == (3 if outcome == "success" else 2)
    finally:
        evidence_embeddings._QUERY_ADMISSION.reset(token)
    assert evidence_embeddings._QUERY_ADMISSION.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("rejected_check", [1, 2, 3])
@pytest.mark.parametrize("code", ["SCOPE_CHANGED", "INDEX_READ_UNAVAILABLE"])
async def test_document_dispatch_admission_errors_remain_hard(rejected_check, code):
    from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

    profile, _, fake, client = setup_client()
    count = 0
    error_type = (
        InvalidInputError if code == "SCOPE_CHANGED" else DatabaseOperationError
    )

    async def admission():
        nonlocal count
        count += 1
        if count == rejected_check:
            raise error_type(code)

    with pytest.raises(error_type, match=code) as caught:
        await client.embed_documents(
            profile, ["document"], dispatch_admission=admission
        )
    assert caught.value.__cause__ is caught.value.__context__ is None
    assert fake.calls == []
    assert len(fake.provisions) == (1 if rejected_check == 3 else 0)
    # A rejected document callback is not retained on the shared client.
    await client.embed_documents(profile, ["classic document"])
    await client.embed_query(
        profile, "classic query", disclosure=client.test_disclosure
    )
    assert count == rejected_check


@pytest.mark.asyncio
async def test_document_admission_is_per_call_and_repeats_for_each_batch():
    profile, _, fake, client = setup_client()
    calls = []

    async def first():
        calls.append("first")

    async def second():
        calls.append("second")

    await asyncio.gather(
        client.embed_documents(profile, ["one"] * 17, dispatch_admission=first),
        client.embed_documents(profile, ["two"], dispatch_admission=second),
    )
    assert calls.count("first") == 6
    assert calls.count("second") == 3
    assert len(fake.calls) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "error", "cancelled"])
async def test_document_admission_restores_context_for_every_exit(outcome):
    from open_notebook.ai import evidence_embeddings
    from open_notebook.exceptions import InvalidInputError

    profile, _, fake, client = setup_client()
    inherited = []

    async def parent():
        inherited.append("must not run")

    async def admission():
        if outcome == "error":
            raise InvalidInputError("SCOPE_CHANGED")
        if outcome == "cancelled":
            raise asyncio.CancelledError()

    token = evidence_embeddings._DOCUMENT_ADMISSION.set(parent)
    try:
        if outcome == "success":
            await client.embed_documents(profile, ["doc"], dispatch_admission=admission)
        else:
            error = InvalidInputError if outcome == "error" else asyncio.CancelledError
            with pytest.raises(error):
                await client.embed_documents(
                    profile, ["doc"], dispatch_admission=admission
                )
        assert evidence_embeddings._DOCUMENT_ADMISSION.get() is parent
        await client.embed_documents(profile, ["classic doc"])
        await client.embed_query(
            profile, "classic query", disclosure=client.test_disclosure
        )
        assert inherited == []
        assert evidence_embeddings._DOCUMENT_ADMISSION.get() is parent
    finally:
        evidence_embeddings._DOCUMENT_ADMISSION.reset(token)
    assert evidence_embeddings._DOCUMENT_ADMISSION.get() is None
