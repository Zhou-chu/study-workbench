"""Offline service behavior; only persistence and provider IO are replaced."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from api import credentials_service as service
from open_notebook.ai import connection_tester
from open_notebook.domain.credential import Credential


@pytest.mark.asyncio
async def test_missing_credential_maps_lookup_failure_without_unbound_handler(
    monkeypatch,
):
    monkeypatch.setattr(
        Credential, "get", AsyncMock(side_effect=ValueError("not found"))
    )
    result = await service.test_credential("credential:absent")
    assert result["provider"] == "unknown"
    assert result["success"] is False
    assert isinstance(result["message"], str)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,config,helper",
    [
        ("ollama", {}, "_test_ollama_connection"),
        ("omlx", {}, "_test_openai_compatible_connection"),
        (
            "openai_compatible",
            {"base_url": "http://fixture.invalid/v1"},
            "_test_openai_compatible_connection",
        ),
        (
            "anthropic_compatible",
            {"base_url": "http://fixture.invalid"},
            "_test_anthropic_compatible_connection",
        ),
        (
            "azure",
            {"endpoint": "https://fixture.invalid", "api_version": "test"},
            "_test_azure_connection",
        ),
    ],
)
async def test_special_provider_dispatch_preserves_result(
    monkeypatch, provider, config, helper
):
    credential = SimpleNamespace(provider=provider, to_esperanto_config=lambda: config)
    monkeypatch.setattr(Credential, "get", AsyncMock(return_value=credential))
    requests = []

    async def transport(*args, **kwargs):
        requests.append((args, kwargs))
        return False, "synthetic provider refusal"

    monkeypatch.setattr(connection_tester, helper, transport)
    assert await service.test_credential("credential:synthetic") == {
        "provider": provider,
        "success": False,
        "message": "synthetic provider refusal",
    }
    assert len(requests) == 1
    if provider == "omlx":
        assert requests[0][0][0] == "http://localhost:11435/v1"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai_compatible", "anthropic_compatible"])
async def test_missing_base_url_returns_actionable_failure(monkeypatch, provider):
    monkeypatch.setattr(
        Credential,
        "get",
        AsyncMock(
            return_value=SimpleNamespace(
                provider=provider, to_esperanto_config=lambda: {}
            )
        ),
    )
    assert (await service.test_credential("credential:synthetic"))[
        "message"
    ] == "No base URL configured"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind",
    ["language", "embedding", "text_to_speech", "unsupported", "empty", "unknown"],
)
async def test_standard_provider_probe_modes(monkeypatch, kind):
    from esperanto.factory import AIFactory

    monkeypatch.setattr(
        Credential,
        "get",
        AsyncMock(
            return_value=SimpleNamespace(
                provider="synthetic",
                to_esperanto_config=lambda: {"api_key": "synthetic-only"},
            )
        ),
    )
    monkeypatch.setattr(
        connection_tester,
        "TEST_MODELS",
        {}
        if kind == "unknown"
        else {"synthetic": (None if kind == "empty" else "fixture", kind)},
    )
    calls = []

    async def invoke(value):
        calls.append(value)

    monkeypatch.setattr(
        AIFactory,
        "create_language",
        lambda **kw: SimpleNamespace(
            to_langchain=lambda: SimpleNamespace(ainvoke=invoke)
        ),
    )
    monkeypatch.setattr(
        AIFactory, "create_embedding", lambda **kw: SimpleNamespace(aembed=invoke)
    )
    monkeypatch.setattr(
        AIFactory, "create_text_to_speech", lambda **kw: calls.append(kw)
    )
    result = await service.test_credential("credential:synthetic")
    assert result["success"] == (kind in {"language", "embedding", "text_to_speech"})
    if kind == "language":
        assert calls == ["Hi"]
    if kind == "embedding":
        assert calls == [["test"]]
    if kind in {"unknown", "empty", "unsupported"}:
        assert calls == []


@pytest.mark.asyncio
async def test_status_prioritizes_database_and_handles_unavailable_store(monkeypatch):
    monkeypatch.setattr(
        service,
        "PROVIDER_ENV_CONFIG",
        {
            "openai": {"required": ["SYNTHETIC_KEY"]},
            "google": {"required_any": ["SYNTHETIC_OTHER"]},
            "missing": {},
        },
    )
    monkeypatch.setenv("SYNTHETIC_KEY", "synthetic")
    monkeypatch.setenv("SYNTHETIC_OTHER", "synthetic")
    monkeypatch.setattr(service, "get_secret_from_env", lambda name: "synthetic")

    async def lookup(provider):
        if provider == "openai":
            return [object()]
        raise RuntimeError("synthetic store unavailable")

    monkeypatch.setattr(Credential, "get_by_provider", lookup)
    result = await service.get_provider_status()
    assert result["source"] == {
        "openai": "database",
        "google": "environment",
        "missing": "none",
    }
    assert result["configured"] == {"openai": True, "google": True, "missing": False}
    assert await service.get_env_status() == {
        "openai": True,
        "google": True,
        "missing": False,
    }
    assert service.check_env_configured("notregistered") is False


@pytest.mark.parametrize(
    "provider,env,field,expected",
    [
        (
            "ollama",
            {"OLLAMA_API_BASE": "http://fixture.invalid"},
            "base_url",
            "http://fixture.invalid",
        ),
        (
            "omlx",
            {"OMLX_API_BASE": "http://fixture.invalid", "OMLX_API_KEY": "synthetic"},
            "base_url",
            "http://fixture.invalid",
        ),
        (
            "vertex",
            {"VERTEX_PROJECT": "fixture-project", "VERTEX_LOCATION": "test"},
            "project",
            "fixture-project",
        ),
        (
            "azure",
            {
                "AZURE_OPENAI_API_KEY": "synthetic",
                "AZURE_OPENAI_ENDPOINT": "https://fixture.invalid",
            },
            "endpoint",
            "https://fixture.invalid",
        ),
        (
            "openai_compatible",
            {"OPENAI_COMPATIBLE_BASE_URL": "http://fixture.invalid"},
            "base_url",
            "http://fixture.invalid",
        ),
        (
            "anthropic_compatible",
            {
                "ANTHROPIC_COMPATIBLE_BASE_URL": "http://fixture.invalid",
                "ANTHROPIC_COMPATIBLE_API_KEY": "synthetic",
            },
            "base_url",
            "http://fixture.invalid",
        ),
        ("google", {"GEMINI_API_KEY": "synthetic"}, "provider", "google"),
    ],
)
def test_env_migration_constructs_real_domain_values(
    monkeypatch, provider, env, field, expected
):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    cred = service.create_credential_from_env(provider)
    assert getattr(cred, field) == expected
    assert cred.name == "Default (Migrated from env)"
    response = service.credential_to_response(cred, 3)
    assert response.model_count == 3
    assert "api_key" not in response.model_dump()
    assert response.has_api_key == (cred.api_key is not None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider", ["voyage", "elevenlabs", "deepgram", "vertex", "anthropic"]
)
async def test_static_and_anthropic_discovery_fallback(monkeypatch, provider):
    monkeypatch.setattr(
        service,
        "fetch_anthropic_model_ids",
        AsyncMock(side_effect=RuntimeError("synthetic unavailable")),
    )
    models = await service.discover_with_config(provider, {"api_key": "synthetic"})
    assert models and all(row["provider"] == provider and row["name"] for row in models)
    if provider != "vertex":
        assert await service.discover_with_config(provider, {}) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider",
    [
        "ollama",
        "openai_compatible",
        "anthropic_compatible",
        "omlx",
        "azure",
        "google",
        "openai",
    ],
)
@pytest.mark.parametrize("failure", [False, True])
async def test_discovery_parses_payload_and_handles_transport_failure(
    monkeypatch, provider, failure
):
    import httpx

    requests = []
    pinned = []

    async def pin(url, provider):
        pinned.append(url)
        return SimpleNamespace(
            url="http://127.0.0.1/synthetic",
            headers={"Host": "fixture.invalid"},
            extensions={},
        )

    monkeypatch.setattr(service, "prepare_pinned_http_target", pin)

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, **kwargs):
            requests.append((url, kwargs))
            if failure:
                raise httpx.ConnectError("synthetic unavailable")
            return httpx.Response(
                200,
                request=httpx.Request("GET", url),
                json={
                    "models": [
                        {"name": "models/fixture", "displayName": "Fixture"},
                        {},
                    ],
                    "data": [{"id": "fixture", "name": "Fixture"}, {}],
                },
            )

    monkeypatch.setattr(service.httpx, "AsyncClient", Client)
    config = {
        "api_key": "synthetic",
        "base_url": "https://fixture.invalid/v1/models",
        "endpoint": "https://fixture.invalid",
    }
    result = await service.discover_with_config(provider, config)
    assert len(requests) == 1
    if failure:
        assert result == []
    else:
        assert result and all(item["provider"] == provider for item in result)
        assert all(item["name"] for item in result)
    if provider not in {"google"}:
        assert pinned
    if provider == "openai_compatible":
        assert pinned == ["https://fixture.invalid/v1/models"]
        assert requests[0][1]["headers"]["Authorization"] == "Bearer synthetic"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider",
    [
        "openai_compatible",
        "anthropic_compatible",
        "azure",
        "cohere",
        "unknown",
        "openai",
    ],
)
async def test_discovery_missing_config_never_opens_client(monkeypatch, provider):
    def forbidden(**kwargs):
        pytest.fail("incomplete config opened network client")

    monkeypatch.setattr(service.httpx, "AsyncClient", forbidden)
    assert await service.discover_with_config(provider, {}) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_cohere_discovery_filters_non_llm_modalities(monkeypatch, failure):
    from esperanto import AIFactory

    def fetch(*args, **kwargs):
        if failure:
            raise RuntimeError("synthetic unavailable")
        return [
            SimpleNamespace(id="chat", type="language"),
            SimpleNamespace(id="embed", type="embedding"),
            SimpleNamespace(id="voice", type="text_to_speech"),
        ]

    monkeypatch.setattr(AIFactory, "get_provider_models", fetch)
    result = await service.discover_with_config("cohere", {"api_key": "synthetic"})
    assert result == (
        []
        if failure
        else [
            {"name": "chat", "provider": "cohere"},
            {"name": "embed", "provider": "cohere"},
        ]
    )


@pytest.mark.asyncio
async def test_registration_preserves_existing_and_links_new_real_model(monkeypatch):
    from open_notebook.ai.models import Model
    from open_notebook.database import repository

    cred = Credential(
        id="credential:synthetic",
        name="Synthetic",
        provider="openai",
        modalities=["language"],
    )
    monkeypatch.setattr(Credential, "get", AsyncMock(return_value=cred))
    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(return_value=[{"name": "existing", "type": "language"}]),
    )
    saved = []

    async def persist(self):
        saved.append(self.model_dump())

    monkeypatch.setattr(Model, "save", persist)
    result = await service.register_models(
        cred.id,
        [
            SimpleNamespace(name="EXISTING", model_type="language", provider=None),
            SimpleNamespace(name="new", model_type="embedding", provider=None),
        ],
    )
    assert result == {"created": 1, "existing": 1}
    assert saved[0]["name"] == "new" and saved[0]["credential"] == cred.id
    assert saved[0]["provider"] == "openai"


@pytest.mark.asyncio
@pytest.mark.parametrize("linked", [False, True])
async def test_env_migration_reports_success_skip_unconfigured_and_failure(
    monkeypatch, linked
):
    from open_notebook.ai.models import Model
    from open_notebook.database import repository

    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "synthetic-test-only")
    monkeypatch.setattr(
        service,
        "PROVIDER_ENV_CONFIG",
        {
            "openai": {"required": ["SYNTHETIC_OPENAI"]},
            "google": {"required": ["SYNTHETIC_GOOGLE"]},
            "ollama": {"required": ["SYNTHETIC_OLLAMA"]},
            "missing": {"required": ["SYNTHETIC_MISSING"]},
        },
    )
    for name in ("OPENAI", "GOOGLE", "OLLAMA"):
        monkeypatch.setenv("SYNTHETIC_" + name, "synthetic")
    monkeypatch.setenv("OLLAMA_API_BASE", "http://fixture.invalid")

    async def get(provider):
        if provider == "google":
            return [object()]
        if provider == "ollama":
            raise RuntimeError("synthetic read failure")
        return []

    monkeypatch.setattr(Credential, "get_by_provider", get)
    saved = []

    async def save_credential(self):
        self.id = "credential:created"
        saved.append(self.provider)

    monkeypatch.setattr(Credential, "save", save_credential)
    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(
            return_value=[
                {
                    "id": "model:existing",
                    "name": "fixture",
                    "provider": "openai",
                    "type": "language",
                }
            ]
            if linked
            else []
        ),
    )
    models = []

    async def save_model(self):
        models.append((self.id, self.credential))

    monkeypatch.setattr(Model, "save", save_model)
    result = await service.migrate_from_env()
    assert result["migrated"] == ["openai"]
    assert result["skipped"] == ["google"]
    assert result["not_configured"] == ["missing"]
    assert result["errors"] == ["ollama: synthetic read failure"]
    assert saved == ["openai"]
    assert models == ([("model:existing", "credential:created")] if linked else [])


@pytest.mark.asyncio
@pytest.mark.parametrize("linked", [False, True])
async def test_legacy_provider_config_migration_keeps_skip_and_failure_boundaries(
    monkeypatch, linked
):
    from open_notebook.ai.models import Model
    from open_notebook.database import repository
    from open_notebook.domain.provider_config import ProviderConfig

    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "synthetic-test-only")
    old = [
        Credential(
            name=name,
            provider="openai",
            modalities=["language"],
            api_key=SecretStr("synthetic"),
        )
        for name in ("existing", "new", "failure")
    ]
    monkeypatch.setattr(
        ProviderConfig,
        "get_instance",
        AsyncMock(return_value=SimpleNamespace(credentials={"openai": old})),
    )
    monkeypatch.setattr(Credential, "get_by_provider", AsyncMock(return_value=[old[0]]))
    saved = []

    async def save_credential(self):
        if self.name == "failure":
            raise RuntimeError("synthetic save failed")
        self.id = "credential:new"
        saved.append(self.model_dump())

    monkeypatch.setattr(Credential, "save", save_credential)
    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(
            return_value=[
                {
                    "id": "model:existing",
                    "name": "fixture",
                    "provider": "openai",
                    "type": "language",
                }
            ]
            if linked
            else []
        ),
    )
    models = []

    async def save_model(self):
        models.append((self.id, self.credential))

    monkeypatch.setattr(Model, "save", save_model)
    result = await service.migrate_from_provider_config()
    assert result["migrated"] == ["openai/new"]
    assert result["skipped"] == ["openai/existing"]
    assert result["errors"] == ["openai/failure: synthetic save failed"]
    assert saved[0]["name"] == "new"
    assert models == ([("model:existing", "credential:new")] if linked else [])


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["lookup", "configuration"])
async def test_pre_dispatch_failures_are_redacted_and_never_call_provider(
    monkeypatch, stage
):
    sensitive = "not found synthetic-private-token /private/config.json"

    def failed_config():
        raise ValueError(sensitive)

    lookup = AsyncMock(
        side_effect=ValueError(sensitive) if stage == "lookup" else None,
        return_value=SimpleNamespace(
            provider="openai", to_esperanto_config=failed_config
        ),
    )
    monkeypatch.setattr(Credential, "get", lookup)

    def forbidden(*args, **kwargs):
        pytest.fail("pre-dispatch failure reached provider/classifier")

    for name in (
        "_test_ollama_connection",
        "_test_openai_compatible_connection",
        "_test_anthropic_compatible_connection",
        "_test_azure_connection",
        "classify_provider_test_error",
    ):
        monkeypatch.setattr(connection_tester, name, forbidden)
    from esperanto.factory import AIFactory

    for name in ("create_language", "create_embedding", "create_text_to_speech"):
        monkeypatch.setattr(AIFactory, name, forbidden)
    result = await service.test_credential("credential:synthetic")
    assert result == {
        "provider": "unknown",
        "success": False,
        "message": "Credential configuration could not be loaded",
    }
    assert sensitive not in str(result)
