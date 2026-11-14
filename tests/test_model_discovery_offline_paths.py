"""Discovery contract coverage with fake HTTP, credentials and persistence."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from open_notebook.ai import model_discovery as md


@pytest.fixture
def boundary(monkeypatch):
    target = SimpleNamespace(
        url="https://192.0.2.1/pinned",
        headers={"Host": "fake.invalid"},
        extensions={"sni_hostname": "fake.invalid"},
    )
    pin = AsyncMock(return_value=target)
    client = SimpleNamespace(get=AsyncMock())
    context = Mock()
    context.__aenter__ = AsyncMock(return_value=client)
    context.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(md.httpx, "AsyncClient", Mock(return_value=context))
    monkeypatch.setattr(md, "prepare_pinned_http_target", pin)
    credentials = AsyncMock(return_value=[])
    monkeypatch.setattr(md.Credential, "get_by_provider", credentials)
    # Fake DB boundary is fail-closed unless a test explicitly supplies a result.
    monkeypatch.setattr(
        md,
        "repo_query",
        AsyncMock(side_effect=AssertionError("unexpected database access")),
    )
    for key in [
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "OLLAMA_API_BASE",
        "OPENAI_COMPATIBLE_BASE_URL",
        "OPENAI_COMPATIBLE_API_KEY",
        "ANTHROPIC_COMPATIBLE_BASE_URL",
        "ANTHROPIC_COMPATIBLE_API_KEY",
        "OMLX_API_BASE",
        "OMLX_API_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)
    return client, pin, credentials, target


def response(payload, status=200):
    return httpx.Response(
        status, json=payload, request=httpx.Request("GET", "https://fake.invalid")
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,env",
    [
        ("openai_compatible", "OPENAI_COMPATIBLE_BASE_URL"),
        ("anthropic_compatible", "ANTHROPIC_COMPATIBLE_BASE_URL"),
        ("omlx", "OMLX_API_BASE"),
    ],
)
@pytest.mark.parametrize("source", ["credential", "environment", "db-error"])
async def test_compatible_config_precedence_and_pinned_transport(
    monkeypatch, boundary, provider, env, source
):
    client, pin, credentials, target = boundary
    monkeypatch.setenv(env, "https://environment.invalid/v1/")
    monkeypatch.setenv(provider.upper() + "_API_KEY", "env-fixture")
    if source == "credential":
        credentials.return_value = [
            SimpleNamespace(
                to_esperanto_config=lambda: {
                    "base_url": "https://credential.invalid/v1/",
                    "api_key": "db-fixture",
                }
            )
        ]
    elif source == "db-error":
        credentials.side_effect = RuntimeError("fixture read failed")
    client.get.return_value = response(
        {"data": [{"id": "chat-fixture"}, {}, {"id": "text-embedding-fixture"}]}
    )
    models = await getattr(md, "discover_" + provider + "_models")()
    assert [m.name for m in models] == ["chat-fixture", "text-embedding-fixture"]
    assert all(m.provider == provider for m in models)
    assert models[1].model_type == (
        "language" if provider == "anthropic_compatible" else "embedding"
    )
    host = "credential" if source == "credential" else "environment"
    assert pin.await_args.args == (f"https://{host}.invalid/v1/models", provider)
    sent = client.get.await_args
    assert sent.args == (target.url,)
    assert sent.kwargs["extensions"] == target.extensions
    headers = sent.kwargs["headers"]
    assert headers["Host"] == "fake.invalid"
    key = "db-fixture" if source == "credential" else "env-fixture"
    if provider == "anthropic_compatible":
        assert (
            headers["x-api-key"] == key and headers["anthropic-version"] == "2023-06-01"
        )
    else:
        assert headers["Authorization"] == "Bearer " + key


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai_compatible", "anthropic_compatible"])
async def test_missing_endpoint_returns_empty_without_request(boundary, provider):
    assert await getattr(md, "discover_" + provider + "_models")() == []
    boundary[1].assert_not_awaited()
    boundary[0].get.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,env",
    [
        ("openai_compatible", "OPENAI_COMPATIBLE_BASE_URL"),
        ("anthropic_compatible", "ANTHROPIC_COMPATIBLE_BASE_URL"),
        ("omlx", "OMLX_API_BASE"),
    ],
)
@pytest.mark.parametrize("failure", ["http", "network", "validation"])
async def test_discovery_failure_never_fabricates_models(
    monkeypatch, boundary, provider, env, failure
):
    client, pin, _, _ = boundary
    monkeypatch.setenv(env, "https://fake.invalid/v1")
    if failure == "http":
        client.get.return_value = response({}, 403)
    elif failure == "network":
        client.get.side_effect = httpx.ConnectError("fixture refused")
    else:
        pin.side_effect = ValueError("unsafe target")
    assert await getattr(md, "discover_" + provider + "_models")() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,env",
    [
        ("openai_compatible", "OPENAI_COMPATIBLE_BASE_URL"),
        ("anthropic_compatible", "ANTHROPIC_COMPATIBLE_BASE_URL"),
        ("omlx", "OMLX_API_BASE"),
    ],
)
async def test_local_no_key_discovery_keeps_auth_absent(
    monkeypatch, boundary, provider, env
):
    monkeypatch.setenv(env, "https://fake.invalid/models")
    boundary[0].get.return_value = response({})
    assert await getattr(md, "discover_" + provider + "_models")() == []
    headers = boundary[0].get.await_args.kwargs["headers"]
    assert "Authorization" not in headers and "x-api-key" not in headers


@pytest.mark.asyncio
async def test_omlx_uses_documented_default_without_credentials(boundary):
    boundary[0].get.return_value = response({})
    assert await md.discover_omlx_models() == []
    assert boundary[1].await_args.args == ("http://localhost:11435/v1/models", "omlx")


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["GOOGLE_API_KEY", "GEMINI_API_KEY"])
async def test_google_method_metadata_beats_name_heuristic(monkeypatch, boundary, key):
    monkeypatch.setenv(key, "synthetic-key")
    boundary[0].get.return_value = response(
        {
            "models": [
                {
                    "name": "models/chat",
                    "displayName": "Readable",
                    "supportedGenerationMethods": ["embedContent"],
                },
                {
                    "name": "models/text-embedding",
                    "supportedGenerationMethods": ["generateContent"],
                },
                {"name": "models/gemini-other"},
                {},
            ]
        }
    )
    models = await md.discover_google_models()
    assert [(m.name, m.model_type) for m in models] == [
        ("chat", "embedding"),
        ("text-embedding", "language"),
        ("gemini-other", "language"),
    ]
    assert models[0].description == "Readable"
    request = boundary[0].get.await_args
    assert "synthetic-key" not in request.args[0]
    assert request.kwargs["headers"] == {"X-Goog-Api-Key": "synthetic-key"}


@pytest.mark.asyncio
async def test_google_missing_key_and_http_failure_are_empty(monkeypatch, boundary):
    assert await md.discover_google_models() == []
    boundary[0].get.assert_not_awaited()
    monkeypatch.setenv("GOOGLE_API_KEY", "synthetic")
    boundary[0].get.return_value = response({}, 401)
    assert await md.discover_google_models() == []


@pytest.mark.asyncio
async def test_ollama_default_empty_override_and_failure(monkeypatch, boundary):
    boundary[0].get.return_value = response({"models": [{"name": "llama-fixture"}, {}]})
    models = await md.discover_ollama_models()
    assert [(m.name, m.provider) for m in models] == [("llama-fixture", "ollama")]
    assert boundary[1].await_args.args == ("http://localhost:11434/api/tags", "ollama")
    monkeypatch.setenv("OLLAMA_API_BASE", "")
    assert await md.discover_ollama_models() == []
    monkeypatch.setenv("OLLAMA_API_BASE", "https://fake.invalid/")
    boundary[0].get.side_effect = httpx.ConnectError("unavailable")
    assert await md.discover_ollama_models() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,types",
    [
        ("voyage", {"embedding"}),
        ("elevenlabs", {"text_to_speech", "speech_to_text"}),
        ("deepgram", {"text_to_speech", "speech_to_text"}),
    ],
)
async def test_static_catalog_requires_key_and_preserves_modalities(
    monkeypatch, boundary, provider, types
):
    key = provider.upper() + "_API_KEY"
    monkeypatch.delenv(key, raising=False)
    discover = getattr(md, "discover_" + provider + "_models")
    assert await discover() == []
    monkeypatch.setenv(key, "synthetic")
    models = await discover()
    assert models and {m.model_type for m in models} == types
    assert all(m.name and m.provider == provider for m in models)
    boundary[0].get.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_missing_or_credential_only_provider_is_empty(
    monkeypatch, boundary
):
    assert await md.discover_provider_models("future-provider") == []
    assert await md.discover_provider_models("vertex") == []
    discover = AsyncMock(
        return_value=[md.DiscoveredModel("fixture", "fake", "language")]
    )
    monkeypatch.setattr(md, "PROVIDER_DISCOVERY_FUNCTIONS", {"fake": discover})
    assert (await md.discover_provider_models("fake"))[0].name == "fixture"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "auto,discovered",
    [(False, [md.DiscoveredModel("fixture", "fake", "language")]), (True, [])],
)
async def test_sync_preview_and_empty_catalog_never_touch_persistence(
    monkeypatch, boundary, auto, discovered
):
    monkeypatch.setattr(
        md, "discover_provider_models", AsyncMock(return_value=discovered)
    )
    assert await md.sync_provider_models("fake", auto) == (len(discovered), 0, 0)
    md.repo_query.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("read_fails", [False, True])
async def test_sync_counts_existing_saved_and_failed_without_aborting(
    monkeypatch, boundary, read_fails
):
    found = [
        md.DiscoveredModel(name, "FAKE", "language")
        for name in ["Existing", "New", "Bad"]
    ]
    monkeypatch.setattr(md, "discover_provider_models", AsyncMock(return_value=found))
    query = (
        AsyncMock(side_effect=RuntimeError("read failed"))
        if read_fails
        else AsyncMock(return_value=[{"name": "existing", "type": "language"}, {}])
    )
    monkeypatch.setattr(md, "repo_query", query)
    saved = []

    class Model:
        def __init__(self, **fields):
            self.fields = fields

        async def save(self):
            if self.fields["name"] == "Bad":
                raise RuntimeError("fixture write failed")
            saved.append(self.fields)

    monkeypatch.setattr(md, "Model", Model)
    assert await md.sync_provider_models("FAKE") == (
        (3, 2, 0) if read_fails else (3, 1, 1)
    )
    assert [row["name"] for row in saved] == (
        ["Existing", "New"] if read_fails else ["New"]
    )
    assert query.await_args.args[1] == {"provider": "fake"}


@pytest.mark.asyncio
async def test_sync_all_keeps_success_when_one_provider_raises(monkeypatch, boundary):
    monkeypatch.setattr(md, "PROVIDER_DISCOVERY_FUNCTIONS", {"good": None, "bad": None})

    async def sync(provider, auto_register):
        assert auto_register is True
        if provider == "bad":
            raise RuntimeError("fixture error")
        return (2, 1, 1)

    monkeypatch.setattr(md, "sync_provider_models", sync)
    assert await md.sync_all_providers() == {"good": (2, 1, 1), "bad": (0, 0, 0)}


@pytest.mark.asyncio
async def test_count_ignores_unknown_types_and_defaults_missing_counts(
    monkeypatch, boundary
):
    query = AsyncMock(
        return_value=[
            {"type": "language", "count": 4},
            {"type": "embedding"},
            {"type": "future", "count": 99},
        ]
    )
    monkeypatch.setattr(md, "repo_query", query)
    assert await md.get_provider_model_count("FAKE") == {
        "language": 4,
        "embedding": 0,
        "speech_to_text": 0,
        "text_to_speech": 0,
    }
    assert query.await_args.args[1] == {"provider": "FAKE"}


@pytest.mark.asyncio
async def test_registered_provider_override_is_pinned_not_raw(monkeypatch, boundary):
    spec = md.OPENAI_COMPAT_PROVIDERS["minimax"]
    monkeypatch.setenv(spec.env_var, "synthetic")
    monkeypatch.setenv(spec.base_url_env, "https://override.invalid/v1/")
    boundary[0].get.return_value = response({"data": [{}, {"id": "gpt-fixture"}]})
    models = await md.discover_openai_compatible_provider("minimax")
    assert [m.name for m in models] == ["gpt-fixture"]
    assert boundary[1].await_args.args == (
        "https://override.invalid/v1/models",
        "minimax",
    )
    assert boundary[0].get.await_args.args == (boundary[3].url,)
    assert boundary[0].get.await_args.kwargs["extensions"] == boundary[3].extensions


@pytest.mark.asyncio
async def test_cohere_sdk_failure_is_empty_without_http(monkeypatch, boundary):
    monkeypatch.setenv("COHERE_API_KEY", "synthetic")
    monkeypatch.setattr(
        md.asyncio, "to_thread", AsyncMock(side_effect=RuntimeError("SDK failed"))
    )
    assert await md.discover_cohere_models() == []
    boundary[0].get.assert_not_awaited()
