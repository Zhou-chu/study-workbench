"""Explicit credential bindings must never silently route through environment keys."""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from open_notebook.ai.models import Model, ModelManager
from open_notebook.domain.credential import Credential
from open_notebook.exceptions import (
    ConfigurationError,
    DatabaseOperationError,
    NotFoundError,
)
from open_notebook.podcasts.models import _resolve_model_config

FACTORIES = {
    "language": "create_language",
    "embedding": "create_embedding",
    "speech_to_text": "create_speech_to_text",
    "text_to_speech": "create_text_to_speech",
}
PATHS = [*FACTORIES, "podcast"]


def make_model(path, bound=True, provider="openai_compatible"):
    return Model(
        id="model:routing",
        name="routing-test",
        provider=provider,
        type="language" if path == "podcast" else path,
        credential="credential:bound" if bound else None,
    )


async def resolve(path):
    if path == "podcast":
        return await _resolve_model_config("model:routing")
    return await ModelManager().get_model("model:routing")


@pytest.fixture
def boundaries():
    with ExitStack() as stack:
        factories = {
            kind: stack.enter_context(
                patch(f"open_notebook.ai.models.AIFactory.{name}")
            )
            for kind, name in FACTORIES.items()
        }
        provision = stack.enter_context(
            patch(
                "open_notebook.ai.key_provider.provision_provider_keys",
                new_callable=AsyncMock,
            )
        )
        stack.enter_context(
            patch("open_notebook.ai.models.validate_url", new_callable=AsyncMock)
        )
        yield factories, provision


@pytest.mark.asyncio
@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("error_type", [NotFoundError, DatabaseOperationError])
async def test_bound_credential_failure_never_falls_back(path, error_type, boundaries):
    factories, provision = boundaries
    failure = error_type("lookup failed")
    expected = ConfigurationError if error_type is NotFoundError else error_type
    with (
        patch.object(Model, "get", AsyncMock(return_value=make_model(path))),
        patch.object(Credential, "get", AsyncMock(side_effect=failure)),
    ):
        with pytest.raises(expected) as raised:
            await resolve(path)
    if error_type is DatabaseOperationError:
        assert raised.value is failure
    else:
        assert raised.value.__cause__ is failure
    provision.assert_not_awaited()
    for factory in factories.values():
        factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("provider", ["openai_compatible", "ollama"])
async def test_bound_credential_success_uses_only_bound_config(
    path, provider, boundaries
):
    factories, provision = boundaries
    config = {"api_key": "fake-bound-key", "base_url": "https://bound.example.invalid"}
    if provider == "ollama":
        config.pop("api_key")  # Local providers do not require an API key.
    credential = Credential(name="bound", provider=provider, **config)
    with (
        patch.object(
            Model, "get", AsyncMock(return_value=make_model(path, provider=provider))
        ),
        patch.object(Credential, "get", AsyncMock(return_value=credential)),
    ):
        result = await resolve(path)
    provision.assert_not_awaited()
    if path == "podcast":
        assert result == (provider, "routing-test", config)
    else:
        factories[path].assert_called_once_with(
            model_name="routing-test",
            provider=provider.replace("_", "-"),
            config=config,
        )
        assert result is factories[path].return_value


@pytest.mark.asyncio
@pytest.mark.parametrize("path", PATHS)
async def test_unbound_legacy_models_keep_environment_provisioning(path, boundaries):
    factories, provision = boundaries
    with (
        patch.object(
            Model, "get", AsyncMock(return_value=make_model(path, bound=False))
        ),
        patch.object(Credential, "get", AsyncMock()) as lookup,
    ):
        result = await resolve(path)
    lookup.assert_not_awaited()
    provision.assert_awaited_once_with("openai_compatible")
    if path == "podcast":
        assert result == ("openai_compatible", "routing-test", {})
    else:
        factories[path].assert_called_once_with(
            model_name="routing-test", provider="openai-compatible", config={}
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [NotFoundError, DatabaseOperationError])
async def test_model_lookup_preserves_transient_error_classification(
    error_type, boundaries
):
    factories, provision = boundaries
    failure = error_type("lookup failed")
    expected = ConfigurationError if error_type is NotFoundError else error_type
    with patch.object(Model, "get", AsyncMock(side_effect=failure)):
        with pytest.raises(expected) as raised:
            await ModelManager().get_model("model:routing")
    if error_type is DatabaseOperationError:
        assert raised.value is failure
    else:
        assert raised.value.__cause__ is failure
    provision.assert_not_awaited()
    for factory in factories.values():
        factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["language", "podcast"])
@pytest.mark.parametrize("provider", ["openai_compatible", "anthropic_compatible"])
async def test_empty_bound_config_cannot_use_environment(
    path, provider, boundaries, monkeypatch
):
    factories, provision = boundaries
    monkeypatch.setenv("ANTHROPIC_COMPATIBLE_API_KEY", "fake-other-account")
    monkeypatch.setenv("ANTHROPIC_COMPATIBLE_BASE_URL", "https://other.example.invalid")
    credential = SimpleNamespace(
        name="empty", to_esperanto_config=Mock(return_value={})
    )
    with (
        patch.object(
            Model, "get", AsyncMock(return_value=make_model(path, provider=provider))
        ),
        patch.object(Credential, "get", AsyncMock(return_value=credential)),
    ):
        with pytest.raises(ConfigurationError):
            await resolve(path)
    provision.assert_not_awaited()
    for factory in factories.values():
        factory.assert_not_called()
