"""Pin the static provider registry and its consuming declarations."""

from typing import get_args

from provider_validation_fixtures import KNOWN_GOOD_PROVIDERS

from api.models import SupportedProvider
from open_notebook.ai.provider_registry import PROVIDERS


class TestProviderRegistryIsTheSourceOfTruth:
    """The registry drives every backend surface; the Literal is the only
    manual copy and must match it."""

    def test_literal_matches_registry_keys(self):
        assert set(get_args(SupportedProvider)) == set(PROVIDERS.keys())

    def test_registry_matches_known_good_provider_list(self):
        assert set(PROVIDERS.keys()) == set(KNOWN_GOOD_PROVIDERS)

    def test_registry_specs_are_internally_consistent(self):
        for name, spec in PROVIDERS.items():
            assert spec.name == name
            assert spec.display_name
            assert spec.modalities, f"{name} has no modalities"
            assert spec.required_env or spec.required_any_env, (
                f"{name} has no env var configuration"
            )
            if spec.openai_compat_discovery_url:
                # The discovery table takes the API key from required_env[0]
                assert len(spec.required_env) == 1, (
                    f"{name} uses openai-compat discovery but does not have "
                    f"exactly one required env var"
                )

    def test_discovery_functions_cover_registry(self):
        from open_notebook.ai.model_discovery import PROVIDER_DISCOVERY_FUNCTIONS

        assert set(PROVIDER_DISCOVERY_FUNCTIONS.keys()) == set(PROVIDERS.keys())

    def test_openai_compat_discovery_urls_are_exactly_as_expected(self):
        """Pin the derived provider -> discovery URL mapping so a registry
        edit can't silently drop or misassign a URL (both the model_discovery
        table and the credentials_service url_map are built from these)."""
        from open_notebook.ai.model_discovery import OPENAI_COMPAT_PROVIDERS

        expected = {
            "openai": "https://api.openai.com/v1/models",
            "groq": "https://api.groq.com/openai/v1/models",
            "mistral": "https://api.mistral.ai/v1/models",
            "deepseek": "https://api.deepseek.com/models",
            "xai": "https://api.x.ai/v1/models",
            "openrouter": "https://openrouter.ai/api/v1/models",
            "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
            "minimax": "https://api.minimax.io/v1/models",
            "novita": "https://api.novita.ai/openai/models",
            "siliconflow": "https://api.siliconflow.com/v1/models",
            "zai": "https://api.z.ai/api/paas/v4/models",
            "ppq": "https://api.ppq.ai/v1/models?type=all",
        }
        assert {
            name: spec.openai_compat_discovery_url
            for name, spec in PROVIDERS.items()
            if spec.openai_compat_discovery_url
        } == expected
        assert {
            name: spec.url for name, spec in OPENAI_COMPAT_PROVIDERS.items()
        } == expected


class TestSupportedProviderMatchesOtherSourcesOfTruth:
    def test_matches_known_good_provider_list(self):
        assert set(get_args(SupportedProvider)) == set(KNOWN_GOOD_PROVIDERS)

    def test_matches_connection_tester_test_models_keys(self):
        from open_notebook.ai.connection_tester import TEST_MODELS

        assert set(get_args(SupportedProvider)) == set(TEST_MODELS.keys())

    def test_matches_credentials_service_provider_env_config_keys(self):
        from api.credentials_service import PROVIDER_ENV_CONFIG

        assert set(get_args(SupportedProvider)) == set(PROVIDER_ENV_CONFIG.keys())
