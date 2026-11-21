"""Legacy provider configuration used by the credential migration."""

from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import SecretStr

from open_notebook.domain import provider_config
from open_notebook.domain.provider_config import ProviderConfig, ProviderCredential


@pytest.fixture(autouse=True)
def isolate_singleton_registry(monkeypatch):
    monkeypatch.setattr(ProviderConfig, "_instances", {})


def credential(identifier, *, default=False, api_key=None):
    return ProviderCredential(
        id=identifier,
        name=f"Configuration {identifier}",
        provider="sample",
        is_default=default,
        api_key=api_key,
        base_url="https://provider.invalid/v1",
        model="synthetic-model",
        created="2026-01-02 03:04:05",
        updated="2026-01-03 03:04:05",
    )


def test_first_and_subsequent_additions_choose_one_default_per_provider():
    config = ProviderConfig()
    first, second, separate = credential("a"), credential("b"), credential("c")

    config.add_config("OPENAI", first)
    assert first.is_default
    config.add_config("OpenAI", second)
    config.add_config("OTHER", separate)

    assert first.provider == second.provider == "openai"
    assert not first.is_default
    assert config.get_default_config("OPENAI") is second
    assert config.get_default_config("Other") is separate
    assert config.get_config("OpenAi", "a") is first
    assert config.get_config("openai", "missing") is None


def test_default_can_be_switched_but_not_deleted_while_an_alternative_remains():
    first, second = credential("a"), credential("b")
    config = ProviderConfig(credentials={"sample": [first, second]})
    assert config.get_default_config("SAMPLE") is first  # legacy rows without flags
    assert config.get_default_config("absent") is None

    assert config.set_default_config("Sample", "b")
    assert not first.is_default and second.is_default
    assert second.updated != "2026-01-03 03:04:05"
    assert not config.set_default_config("sample", "missing")
    assert not config.delete_config("sample", "b")
    assert not config.delete_config("sample", "missing")
    assert config.delete_config("sample", "a")
    assert config.delete_config("sample", "b")
    assert config.get_default_config("sample") is None


@pytest.mark.parametrize("wrapped", [False, True])
@pytest.mark.parametrize("decrypted", [False, True])
def test_credential_mapping_preserves_fields_and_masks_key(wrapped, decrypted):
    supplied = SecretStr("synthetic-key") if wrapped else "synthetic-key"
    fields = credential("a", default=True).to_dict() | {"api_key": supplied}
    instance = ProviderCredential.from_dict(fields, decrypted=decrypted)

    assert isinstance(instance.api_key, SecretStr)
    assert str(instance.api_key) != "synthetic-key"
    assert instance.to_dict() == fields | {"api_key": "synthetic-key"}


def test_credential_mapping_omits_missing_key():
    fields = credential("a").to_dict()
    assert "api_key" not in fields
    assert ProviderCredential.from_dict(fields | {"api_key": ""}).to_dict() == fields


@pytest.mark.asyncio
@pytest.mark.parametrize("list_result", [True, False])
async def test_loading_fetches_fresh_rows_and_keeps_valid_configurations(
    monkeypatch, list_result
):
    def result(record):
        return [record] if list_result else record

    backend = AsyncMock(
        side_effect=[
            result(
                {
                    "credentials": {
                        "sample": [
                            {"id": "first", "api_key": "opaque-stored-value"},
                            None,
                            {"id": "no-key", "name": "Local configuration"},
                        ],
                        "obsolete": "ignored non-list",
                    }
                }
            ),
            result({"credentials": {"sample": [{"id": "next", "is_default": True}]}}),
        ]
    )
    decrypt = Mock(return_value="synthetic-clear-value")
    monkeypatch.setattr(provider_config, "repo_query", backend)
    monkeypatch.setattr(provider_config, "decrypt_value", decrypt)

    first = await ProviderConfig.get_instance()
    assert set(first.credentials) == {"sample"}
    assert [row.id for row in first.credentials["sample"]] == ["first", "no-key"]
    assert first.credentials["sample"][0].name == "Default"
    assert first.credentials["sample"][0].api_key == SecretStr("synthetic-clear-value")
    assert first.credentials["sample"][1].api_key is None

    second = await ProviderConfig.get_instance()
    default = second.get_default_config("sample")
    assert default is not None
    assert default.id == "next"
    assert [row.id for row in second.credentials["sample"]] == ["next"]
    decrypt.assert_called_once_with("opaque-stored-value")
    assert backend.await_count == 2
    assert all(
        call.args[0] == "SELECT * FROM ONLY $record_id"
        and str(call.args[1]["record_id"]) == ProviderConfig.record_id
        for call in backend.await_args_list
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("backend_value", [None, [], True, {"credentials": "old"}])
async def test_loading_no_usable_rows_creates_empty_configuration(
    monkeypatch, backend_value
):
    monkeypatch.setattr(
        provider_config, "repo_query", AsyncMock(return_value=backend_value)
    )
    assert (await ProviderConfig.get_instance()).credentials == {}


@pytest.mark.asyncio
async def test_saving_upserts_only_the_encrypted_storage_projection(monkeypatch):
    persist = AsyncMock()
    encrypt = Mock(return_value="encrypted-synthetic-value")
    monkeypatch.setattr(provider_config, "repo_upsert", persist)
    monkeypatch.setattr(provider_config, "encrypt_value", encrypt)
    secure = credential("keyed", default=True, api_key=SecretStr("synthetic-key"))
    local = credential("local")
    state = ProviderConfig(credentials={"sample": [secure, local]})

    assert await state.save() is state
    persist.assert_awaited_once_with(
        "open_notebook",
        ProviderConfig.record_id,
        {
            "credentials": {
                "sample": [
                    secure.to_dict() | {"api_key": "encrypted-synthetic-value"},
                    local.to_dict(),
                ]
            }
        },
    )
    assert secure.api_key == SecretStr("synthetic-key")
    encrypt.assert_called_once_with("synthetic-key")
