"""Direct podcast/chat provider config resolution with no real SDK or network call."""

from unittest.mock import AsyncMock, patch

import pytest
from pydantic import SecretStr

from open_notebook.ai.models import Model
from open_notebook.domain.credential import Credential
from open_notebook.exceptions import ConfigurationError
from open_notebook.podcasts.models import _resolve_model_config


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["api_key", "base_url"])
async def test_incomplete_compatible_config_cannot_fall_back_to_anthropic(
    monkeypatch, missing
):
    values = {
        "api_key": "test-compatible-key",
        "base_url": "https://podcast.example.invalid",
    }
    values.pop(missing)
    credential = Credential(
        name="Incomplete", provider="anthropic_compatible", **values
    )
    model = Model(
        id="model:incomplete",
        name="compatible-model",
        provider="anthropic_compatible",
        type="language",
        credential="credential:incomplete",
    )
    monkeypatch.setenv("ANTHROPIC_API_KEY", "unrelated-official-key")
    with (
        patch.object(Model, "get", AsyncMock(return_value=model)),
        patch.object(Model, "get_credential_obj", AsyncMock(return_value=credential)),
        patch("open_notebook.ai.key_provider.provision_provider_keys", AsyncMock()),
        patch("open_notebook.ai.models.validate_url", AsyncMock()),
        pytest.raises(ConfigurationError, match="require a base URL and API key"),
    ):
        await _resolve_model_config("model:incomplete")


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openai", "openai_compatible", "anthropic"])
async def test_other_podcast_providers_keep_existing_config(provider):
    credential = Credential(
        name="Existing",
        provider=provider,
        api_key=SecretStr("test-existing-key"),
        base_url="https://existing.example.invalid/v1",
    )
    model = Model(
        id="model:existing",
        name="existing-model",
        provider=provider,
        type="language",
        credential="credential:existing",
    )
    with (
        patch.object(Model, "get", AsyncMock(return_value=model)),
        patch.object(Model, "get_credential_obj", AsyncMock(return_value=credential)),
    ):
        assert await _resolve_model_config("model:existing") == (
            provider,
            "existing-model",
            credential.to_esperanto_config(),
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["chat", "podcast"])
@pytest.mark.parametrize("invalid", ["missing_key", "missing_url", "rejected_url"])
async def test_both_paths_reject_invalid_compatible_environment(
    monkeypatch, path, invalid
):
    from open_notebook.ai.models import ModelManager

    monkeypatch.setenv(
        "ANTHROPIC_COMPATIBLE_API_KEY", "" if invalid == "missing_key" else "test-key"
    )
    monkeypatch.setenv(
        "ANTHROPIC_COMPATIBLE_BASE_URL",
        "" if invalid == "missing_url" else "https://rejected.example.invalid",
    )
    monkeypatch.setenv("ANTHROPIC_API_KEY", "unrelated-official-key")
    model = Model(
        id="model:environment",
        name="compatible-model",
        provider="anthropic_compatible",
        type="language",
    )
    validator = AsyncMock(
        side_effect=ValueError("URL rejected") if invalid == "rejected_url" else None
    )
    with (
        patch.object(Model, "get", AsyncMock(return_value=model)),
        patch("open_notebook.ai.key_provider.provision_provider_keys", AsyncMock()),
        patch("open_notebook.ai.models.validate_url", validator),
        patch("open_notebook.ai.models.AIFactory.create_language") as factory,
    ):
        with pytest.raises(ConfigurationError):
            if path == "chat":
                await ModelManager().get_model("model:environment", max_tokens=2048)
            else:
                await _resolve_model_config("model:environment", max_tokens=2048)
    factory.assert_not_called()
    if invalid == "rejected_url":
        validator.assert_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["api_key", "base_url"])
@pytest.mark.parametrize("via_override", [False, True], ids=["config", "override"])
async def test_compatible_config_rejects_explicit_none(field, via_override):
    from open_notebook.ai.models import resolve_anthropic_compatible_config

    config: dict[str, str | None] = {
        "api_key": "test-compatible-key",
        "base_url": "https://podcast.example.invalid",
    }
    overrides: dict[str, str | None] = {}
    if via_override:
        overrides[field] = None
    else:
        config[field] = None

    with (
        patch("open_notebook.ai.models.validate_url", AsyncMock()) as validator,
        pytest.raises(ConfigurationError, match="require a base URL and API key"),
    ):
        await resolve_anthropic_compatible_config(config, **overrides)
    validator.assert_not_awaited()
