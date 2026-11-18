"""Direct provider registry collision and credential payload validation."""

import pytest
from provider_validation_fixtures import KNOWN_GOOD_PROVIDERS
from pydantic import ValidationError

from api.models import CreateCredentialRequest


def test_registry_rejects_duplicate_provider_names():
    """A plain dict comprehension would silently drop the earlier spec
    on a name collision; the registry builder must raise instead."""
    from open_notebook.ai.provider_registry import (
        ProviderSpec,
        _build_registry,
    )

    duplicate = (
        ProviderSpec(name="dupe", display_name="Dupe A", modalities=("language",)),
        ProviderSpec(name="dupe", display_name="Dupe B", modalities=("language",)),
    )
    with pytest.raises(ValueError, match="Duplicate provider name"):
        _build_registry(duplicate)


class TestCreateCredentialRequestValidation:
    @pytest.mark.parametrize("provider", KNOWN_GOOD_PROVIDERS)
    def test_accepts_every_known_provider(self, provider):
        provider_fields = (
            {"api_key": "sk-test", "base_url": "https://api.example.com"}
            if provider == "anthropic_compatible"
            else {}
        )
        request = CreateCredentialRequest(
            name="Test", provider=provider, **provider_fields
        )
        assert request.provider == provider

    @pytest.mark.parametrize(
        "bad_provider",
        ["openai ", " openai", "OpenAI", "opnai", "not_a_real_provider", "", "sqlite"],
    )
    def test_rejects_unknown_or_malformed_provider(self, bad_provider):
        with pytest.raises(ValidationError):
            CreateCredentialRequest(name="Test", provider=bad_provider)

    @pytest.mark.parametrize(
        "api_key,base_url",
        [(None, "https://api.example.com"), ("sk-test", None), (" ", " ")],
    )
    def test_anthropic_compatible_requires_api_key_and_base_url(
        self, api_key, base_url
    ):
        with pytest.raises(ValidationError):
            CreateCredentialRequest(
                name="Test",
                provider="anthropic_compatible",
                api_key=api_key,
                base_url=base_url,
            )
