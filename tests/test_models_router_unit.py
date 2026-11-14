"""Direct function units: external persistence, SDK and provider services replaced."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from loguru import logger

from api.models import DefaultModelsResponse, ModelCreate
from api.routers import models as r
from open_notebook.database import repository
from open_notebook.exceptions import (
    ConfigurationError,
    InvalidInputError,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def boundaries(monkeypatch):
    r.DefaultModels.clear_instance()
    monkeypatch.setattr(r.os, "environ", {})
    monkeypatch.setattr(r, "provision_provider_keys", AsyncMock())
    monkeypatch.setattr(r.Credential, "get_by_provider", AsyncMock(return_value=[]))
    yield
    r.DefaultModels.clear_instance()


def defaults(**kw):
    return SimpleNamespace(
        **{**dict.fromkeys(DefaultModelsResponse.model_fields), **kw},
        update=AsyncMock(),
    )


CASES = [
    ("get_models", [None], r.Model, "get_all"),
    (
        "create_model",
        [ModelCreate(name="Synthetic", provider="openai", type="language")],
        repository,
        "repo_query",
    ),
    ("delete_model", ["model:x"], r.Model, "get"),
    ("get_default_models", [], r.DefaultModels, "get_instance"),
    (
        "update_default_models",
        [DefaultModelsResponse()],
        r.DefaultModels,
        "get_instance",
    ),
    ("get_provider_availability", [], r.AIFactory, "get_available_providers"),
    ("discover_models", ["openai"], r, "discover_provider_models"),
    ("sync_models", ["openai"], r, "sync_provider_models"),
    ("sync_all_models", [], r, "sync_all_providers"),
    ("get_model_count", ["openai"], r, "get_provider_model_count"),
    ("get_models_by_provider", ["openai"], repository, "repo_query"),
    ("auto_assign_defaults", [], r.DefaultModels, "get_instance"),
]


@pytest.mark.parametrize("name,args,owner,target", CASES)
@pytest.mark.parametrize("kind", ["http", "typed", "unexpected"])
async def test_error_contract_and_safe_log(
    monkeypatch, name, args, owner, target, kind
):
    error = {
        "http": HTTPException(409, "conflict"),
        "typed": ConfigurationError("configuration"),
        "unexpected": RuntimeError("synthetic-secret /private/key"),
    }[kind]
    if target == "get_available_providers":

        def fail():
            raise error

        monkeypatch.setattr(owner, target, fail)
    else:
        monkeypatch.setattr(owner, target, AsyncMock(side_effect=error))
    logs = []
    sink = logger.add(lambda message: logs.append(str(message)))
    try:
        with pytest.raises(
            HTTPException if kind != "typed" else ConfigurationError
        ) as caught:
            await getattr(r, name)(*args)
    finally:
        logger.remove(sink)
    if kind == "unexpected":
        assert caught.value.status_code == 500
        assert "synthetic-secret" not in str(caught.value.detail) + "".join(logs)
        assert "exception_type=RuntimeError" in "".join(logs)
    else:
        assert caught.value is error


@pytest.mark.parametrize("filtered", [False, True])
async def test_lists_real_response_and_filter(monkeypatch, filtered):
    item = r.Model(
        id="model:x",
        name="X",
        provider="openai",
        type="language",
        credential="credential:x",
    )
    query = AsyncMock(return_value=[item])
    monkeypatch.setattr(r.Model, "get_all", query)
    monkeypatch.setattr(r.Model, "get_models_by_type", query)
    result = await r.get_models("language" if filtered else None)
    assert result[0].credential == "credential:x"
    query.assert_awaited_once_with(*(["language"] if filtered else []))


async def test_create_validates_duplicate_and_persists_normalized_lookup(monkeypatch):
    query = AsyncMock(return_value=[])
    monkeypatch.setattr(repository, "repo_query", query)
    saved = []

    async def save(model):
        model.id = "model:new"
        saved.append(model)

    monkeypatch.setattr(r.Model, "save", save)
    data = ModelCreate(
        name="GPT", provider="OpenAI", type="language", credential="credential:x"
    )
    result = await r.create_model(data)
    assert result.id == "model:new" and saved[0].credential == "credential:x"
    assert query.await_args.args[1] == {
        "provider": "openai",
        "name": "gpt",
        "type": "language",
    }
    query.return_value = [{"id": "model:old"}]
    with pytest.raises(HTTPException) as duplicate:
        await r.create_model(data)
    assert duplicate.value.status_code == 400 and len(saved) == 1
    query.reset_mock()
    with pytest.raises(HTTPException) as invalid:
        await r.create_model(data.model_copy(update={"type": "invalid"}))
    assert invalid.value.status_code == 400
    query.assert_not_awaited()


async def test_create_typed_input_and_delete_notfound(monkeypatch):
    monkeypatch.setattr(
        repository, "repo_query", AsyncMock(side_effect=InvalidInputError("bad"))
    )
    with pytest.raises(HTTPException) as error:
        await r.create_model(ModelCreate(name="x", provider="openai", type="language"))
    assert error.value.status_code == 400
    monkeypatch.setattr(r.Model, "get", AsyncMock(side_effect=NotFoundError("absent")))
    with pytest.raises(HTTPException) as error:
        await r.delete_model("model:x")
    assert error.value.status_code == 404
    delete = AsyncMock()
    monkeypatch.setattr(
        r.Model, "get", AsyncMock(return_value=SimpleNamespace(delete=delete))
    )
    assert await r.delete_model("model:x") == {"message": "Model deleted successfully"}
    delete.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [
        None,
        RuntimeError("lookup"),
        HTTPException(409, "conflict"),
        ConfigurationError("bad"),
    ],
)
async def test_probe_lookup_never_dispatches(monkeypatch, error):
    monkeypatch.setattr(r.Model, "get", AsyncMock(return_value=None, side_effect=error))
    probe = AsyncMock()
    monkeypatch.setattr(r, "test_individual_model", probe)
    with pytest.raises((HTTPException, ConfigurationError)) as caught:
        await r.test_model("model:x")
    if isinstance(error, (HTTPException, ConfigurationError)):
        assert caught.value is error
    else:
        assert caught.value.status_code == 404
    probe.assert_not_awaited()


@pytest.mark.parametrize("outcome", [True, False, "error"])
async def test_probe_result(monkeypatch, outcome):
    model = object()
    monkeypatch.setattr(r.Model, "get", AsyncMock(return_value=model))
    probe = AsyncMock(
        return_value=(outcome, "provider result"),
        side_effect=RuntimeError("synthetic-secret") if outcome == "error" else None,
    )
    monkeypatch.setattr(r, "test_individual_model", probe)
    result = await r.test_model("model:x")
    assert result.success is (outcome is True)
    assert "synthetic-secret" not in result.message
    probe.assert_awaited_once_with(model)


async def test_defaults_presence_and_required_rejection(monkeypatch):
    value = defaults(
        default_chat_model="model:chat", default_transformation_model="model:transform"
    )
    monkeypatch.setattr(r.DefaultModels, "get_instance", AsyncMock(return_value=value))
    assert (await r.get_default_models()).default_chat_model == "model:chat"
    result = await r.update_default_models(
        DefaultModelsResponse(
            default_transformation_model=None, default_tools_model="model:tools"
        )
    )
    assert (
        result.default_transformation_model is None
        and result.default_chat_model == "model:chat"
    )
    assert result.default_tools_model == "model:tools"
    value.update.assert_awaited_once()
    with pytest.raises(InvalidInputError):
        await r.update_default_models(DefaultModelsResponse(default_chat_model=None))
    assert value.update.await_count == 1


async def test_discovery_sync_count_and_provider_records(monkeypatch):
    monkeypatch.setattr(
        r,
        "discover_provider_models",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    name="x", provider="p", model_type="language", description="D"
                )
            ]
        ),
    )
    assert (await r.discover_models("p"))[0].description == "D"
    monkeypatch.setattr(r, "sync_provider_models", AsyncMock(return_value=(3, 2, 1)))
    assert (await r.sync_models("p")).new == 2
    r.sync_provider_models.assert_awaited_once_with("p", auto_register=True)
    monkeypatch.setattr(
        r,
        "sync_all_providers",
        AsyncMock(return_value={"p": (3, 2, 1), "q": (1, 1, 0)}),
    )
    result = await r.sync_all_models()
    assert (result.total_discovered, result.total_new) == (4, 3)
    monkeypatch.setattr(
        r,
        "get_provider_model_count",
        AsyncMock(return_value={"language": 2, "embedding": 3}),
    )
    assert (await r.get_model_count("p")).total == 5
    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(
            return_value=[
                {
                    "id": "model:x",
                    "name": "X",
                    "provider": "p",
                    "type": "language",
                    "credential": "credential:x",
                }
            ]
        ),
    )
    assert (await r.get_models_by_provider("p"))[0].credential == "credential:x"


@pytest.mark.parametrize("mode", ["empty", "assigned", "existing"])
async def test_auto_assignment_preserves_optional_choices(monkeypatch, mode):
    value = defaults(
        default_chat_model="model:existing" if mode == "existing" else None
    )
    monkeypatch.setattr(r.DefaultModels, "get_instance", AsyncMock(return_value=value))
    models = [
        {
            "id": "model:chat",
            "name": "gpt-4o",
            "provider": "openai",
            "type": "language",
        },
        {
            "id": "model:embed",
            "name": "embed",
            "provider": "other",
            "type": "embedding",
        },
    ]
    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(return_value=models if mode != "empty" else [{"type": "invalid"}]),
    )
    result = await r.auto_assign_defaults()
    if mode == "empty":
        assert set(result.missing) == r.REQUIRED_DEFAULTS
        value.update.assert_not_awaited()
    else:
        assert result.assigned["default_embedding_model"] == "model:embed"
        assert result.skipped == (["default_chat_model"] if mode == "existing" else [])
        value.update.assert_awaited_once()
    assert value.default_transformation_model is None


@pytest.mark.parametrize(
    "records,priority,prefs,expected",
    [
        ([], ["a"], {}, None),
        ([{"id": "1", "provider": "a", "name": "normal"}], ["b"], {}, "1"),
        ([{"id": "1", "provider": "a", "name": "normal"}], ["a"], {}, "1"),
        (
            [
                {"id": "1", "provider": "a", "name": "normal"},
                {"id": "2", "provider": "a", "name": "preferred"},
            ],
            ["b", "a"],
            {"a": ["missing", "preferred"]},
            "2",
        ),
        (
            [{"id": "1", "provider": "a", "name": "normal"}],
            ["a"],
            {"a": ["missing"]},
            "1",
        ),
    ],
)
async def test_preference_order(records, priority, prefs, expected):
    result = r._get_preferred_model(records, priority, prefs)
    assert (result["id"] if result else None) == expected


@pytest.mark.parametrize(
    "kind", ["none", "db", "generic", "specific", "sparse", "gemini"]
)
async def test_availability_uses_only_configured_modes(monkeypatch, kind):
    if kind == "db":
        monkeypatch.setattr(
            r.Credential, "get_by_provider", AsyncMock(return_value=[object()])
        )
    if kind in {"generic", "specific", "sparse"}:
        suffix = "" if kind == "generic" else "_LLM"
        for key in ("API_KEY", "ENDPOINT", "API_VERSION"):
            r.os.environ["AZURE_OPENAI_" + key + suffix] = "synthetic"
        r.os.environ["OPENAI_COMPATIBLE_BASE_URL" + suffix] = "synthetic"
        r.os.environ["ANTHROPIC_COMPATIBLE_BASE_URL"] = "synthetic"
        r.os.environ["ANTHROPIC_COMPATIBLE_API_KEY"] = "synthetic"
    if kind == "gemini":
        r.os.environ["GEMINI_API_KEY"] = "synthetic"
    sdk = {
        m: ["azure", "openai-compatible", "openai", "anthropic", "google"]
        for m in ["language", "embedding", "speech_to_text", "text_to_speech"]
    }
    if kind == "sparse":
        sdk = {"embedding": ["other"]}
    monkeypatch.setattr(r.AIFactory, "get_available_providers", lambda: sdk)
    result = await r.get_provider_availability()
    if kind == "none":
        assert result.available == []
    elif kind == "gemini":
        assert result.available == ["google"]
    else:
        assert "azure" in result.available
        assert result.supported_types["azure"] == (
            []
            if kind == "sparse"
            else ["language"]
            if kind == "specific"
            else list(sdk)
        )
        assert result.supported_types["anthropic_compatible"] == (
            [] if kind == "sparse" else ["language"]
        )


async def test_credential_store_failure_is_not_availability(monkeypatch):
    monkeypatch.setattr(
        r.Credential,
        "get_by_provider",
        AsyncMock(side_effect=RuntimeError("unavailable")),
    )
    assert await r._check_provider_has_credential("p") is False
