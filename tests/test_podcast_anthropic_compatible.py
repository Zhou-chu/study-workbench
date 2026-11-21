"""Podcast model resolution must retain Anthropic-compatible endpoints (#1347)."""

from unittest.mock import AsyncMock, patch

import pytest
from esperanto import AIFactory
from pydantic import SecretStr

from open_notebook.ai.models import Model
from open_notebook.domain.credential import Credential
from open_notebook.podcasts.models import EpisodeProfile


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "resolver", ["resolve_outline_config", "resolve_transcript_config"]
)
@pytest.mark.parametrize("linked", [True, False], ids=["credential", "environment"])
async def test_compatible_podcast_model_reaches_its_endpoint(
    monkeypatch, resolver, linked
):
    base_url = "https://podcast.example.invalid/anthropic"
    api_key = "test-podcast-compatible-key"
    credential = Credential(
        name="Compatible podcast endpoint",
        provider="anthropic_compatible",
        api_key=SecretStr(api_key),
        base_url=base_url,
    )
    model = Model(
        id="model:podcast",
        name="compatible-podcast-model",
        provider="anthropic_compatible",
        type="language",
        credential="credential:podcast" if linked else None,
    )
    profile = EpisodeProfile(
        name="Compatible podcast",
        default_briefing="Discuss the source",
        outline_llm="model:podcast",
        transcript_llm="model:podcast",
        max_tokens=2048,
    )
    monkeypatch.setenv(
        "ANTHROPIC_COMPATIBLE_API_KEY", "other-env-key" if linked else api_key
    )
    monkeypatch.setenv(
        "ANTHROPIC_COMPATIBLE_BASE_URL",
        "https://other.example.invalid" if linked else base_url,
    )
    with (
        patch.object(Model, "get", AsyncMock(return_value=model)),
        patch.object(Model, "get_credential_obj", AsyncMock(return_value=credential)),
        patch("open_notebook.ai.key_provider.provision_provider_keys", AsyncMock()),
        patch("open_notebook.ai.models.validate_url", AsyncMock()),
    ):
        provider, name, config = await getattr(profile, resolver)()

    # Exercise the real factory boundary used by podcast-creator. Construction
    # performs no model request; the endpoint must not become api.anthropic.com.
    language_model = AIFactory.create_language(provider, name, config=config)
    assert provider == "anthropic"
    assert language_model.base_url == base_url + "/v1"
    assert config == {
        "api_key": api_key,
        "base_url": base_url + "/v1",
        "max_tokens": 2048,
    }
    assert model.provider == "anthropic_compatible"
