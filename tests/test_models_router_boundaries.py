"""Offline route semantics with synthetic persistence/provider boundaries."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.routers import models as router
from open_notebook.ai.models import DefaultModels, Model
from open_notebook.database import repository
from open_notebook.exceptions import NotFoundError


@pytest.fixture(autouse=True)
def isolated_default_singleton():
    DefaultModels.clear_instance()
    yield
    DefaultModels.clear_instance()


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@pytest.fixture
def failure_logs():
    from loguru import logger

    messages = []
    sink = logger.add(
        lambda message: messages.append(str(message)), level="ERROR", format="{message}"
    )
    try:
        yield messages
    finally:
        logger.remove(sink)


CASES = [
    ("get", "", Model, "get_all", None),
    (
        "post",
        "",
        repository,
        "repo_query",
        {"name": "fixture", "provider": "openai", "type": "language"},
    ),
    ("delete", "/model:synthetic", Model, "get", None),
    ("get", "/defaults", DefaultModels, "get_instance", None),
    ("put", "/defaults", DefaultModels, "get_instance", {}),
    ("get", "/discover/openai", router, "discover_provider_models", None),
    ("post", "/sync/openai", router, "sync_provider_models", None),
    ("post", "/sync", router, "sync_all_providers", None),
    ("get", "/count/openai", router, "get_provider_model_count", None),
    ("get", "/by-provider/openai", repository, "repo_query", None),
]


@pytest.mark.parametrize("method,path,owner,target,payload", CASES)
@pytest.mark.parametrize("failure", ["http", "domain", "unexpected"])
def test_model_error_status_and_private_detail_boundary(
    client, monkeypatch, method, path, owner, target, payload, failure, failure_logs
):
    monkeypatch.setattr(router, "provision_provider_keys", AsyncMock())
    error = {
        "http": HTTPException(409, "synthetic conflict"),
        "domain": NotFoundError("synthetic absent"),
        "unexpected": RuntimeError("synthetic-secret /private/connection"),
    }[failure]
    monkeypatch.setattr(owner, target, AsyncMock(side_effect=error))
    response = client.request(method, "/api/models" + path, json=payload)
    assert (
        response.status_code == {"http": 409, "domain": 404, "unexpected": 500}[failure]
    )
    if failure == "unexpected":
        assert "synthetic-secret" not in response.text
        assert "/private/connection" not in response.text
        assert "synthetic-secret" not in "".join(failure_logs)
        assert "/private/connection" not in "".join(failure_logs)
        assert "Boundary operation failed:" in "".join(failure_logs)
        assert "operation=unknown" not in "".join(failure_logs)
        assert "exception_type=RuntimeError" in "".join(failure_logs)


@pytest.fixture
def model(monkeypatch):
    value = Model(
        id="model:synthetic",
        name="Fixture",
        provider="openai",
        type="language",
        credential="credential:synthetic",
    )
    monkeypatch.setattr(Model, "get", AsyncMock(return_value=value))
    return value


@pytest.mark.parametrize("path", ["", "?type=language", "/by-provider/openai"])
def test_model_list_response_preserves_credential_link(
    client, monkeypatch, model, path
):
    monkeypatch.setattr(Model, "get_all", AsyncMock(return_value=[model]))
    monkeypatch.setattr(Model, "get_models_by_type", AsyncMock(return_value=[model]))
    monkeypatch.setattr(
        repository, "repo_query", AsyncMock(return_value=[model.model_dump()])
    )
    response = client.get("/api/models" + path)
    assert response.status_code == 200
    assert response.json()[0]["credential"] == "credential:synthetic"
    assert response.json()[0]["name"] == "Fixture"


def test_delete_deletes_selected_model(client, monkeypatch, model):
    deleted = []

    async def delete(self):
        deleted.append(self.id)

    monkeypatch.setattr(Model, "delete", delete)
    response = client.delete("/api/models/model:synthetic")
    assert response.status_code == 200 and deleted == ["model:synthetic"]


@pytest.mark.parametrize(
    "result", [(True, "synthetic success"), (False, "synthetic refusal")]
)
def test_probe_preserves_provider_result(client, monkeypatch, model, result):
    monkeypatch.setattr(router, "test_individual_model", AsyncMock(return_value=result))
    response = client.post("/api/models/model:synthetic/test")
    assert response.status_code == 200
    assert response.json() == {
        "success": result[0],
        "message": result[1],
        "details": None,
    }


@pytest.mark.parametrize("kind", ["none", "lookup", "http", "domain"])
def test_probe_missing_model_never_dispatches(client, monkeypatch, kind):
    errors = {
        "lookup": RuntimeError("synthetic"),
        "http": HTTPException(409, "conflict"),
        "domain": NotFoundError("absent"),
    }
    monkeypatch.setattr(
        Model, "get", AsyncMock(return_value=None, side_effect=errors.get(kind))
    )

    async def forbidden(*args):
        pytest.fail("missing model dispatched")

    monkeypatch.setattr(router, "test_individual_model", forbidden)
    response = client.post("/api/models/model:synthetic/test")
    assert response.status_code == (409 if kind == "http" else 404)


def test_get_defaults_returns_real_domain_fields(client, monkeypatch):
    defaults = DefaultModels(
        default_chat_model="model:chat", default_embedding_model="model:embed"
    )
    monkeypatch.setattr(DefaultModels, "get_instance", AsyncMock(return_value=defaults))
    response = client.get("/api/models/defaults")
    assert response.status_code == 200
    assert response.json()["default_chat_model"] == "model:chat"


def test_discovery_sync_and_counts_aggregate_real_responses(client, monkeypatch):
    monkeypatch.setattr(router, "provision_provider_keys", AsyncMock())
    monkeypatch.setattr(
        router,
        "discover_provider_models",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    name="fixture",
                    provider="openai",
                    model_type="language",
                    description=None,
                )
            ]
        ),
    )
    response = client.get("/api/models/discover/openai")
    assert response.status_code == 200 and response.json()[0]["name"] == "fixture"
    monkeypatch.setattr(
        router, "sync_provider_models", AsyncMock(return_value=(5, 3, 2))
    )
    response = client.post("/api/models/sync/openai")
    assert response.json() == {
        "provider": "openai",
        "discovered": 5,
        "new": 3,
        "existing": 2,
    }
    monkeypatch.setattr(
        router,
        "sync_all_providers",
        AsyncMock(return_value={"openai": (5, 3, 2), "google": (2, 1, 1)}),
    )
    response = client.post("/api/models/sync")
    assert response.status_code == 200
    assert (
        response.json()["total_discovered"] == 7 and response.json()["total_new"] == 4
    )
    monkeypatch.setattr(
        router,
        "get_provider_model_count",
        AsyncMock(return_value={"language": 2, "embedding": 3}),
    )
    response = client.get("/api/models/count/openai")
    assert response.json()["total"] == 5


def test_create_invalid_type_stops_before_query(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        pytest.fail("invalid type reached DB")

    monkeypatch.setattr(repository, "repo_query", forbidden)
    response = client.post(
        "/api/models", json={"name": "fixture", "provider": "openai", "type": "invalid"}
    )
    assert response.status_code == 400


@pytest.mark.parametrize("db", [False, True])
def test_azure_compatible_modalities_follow_real_availability_rules(
    client, monkeypatch, db
):
    from open_notebook.domain.credential import Credential

    async def credentials(provider):
        return (
            [object()]
            if db and provider in {"azure", "openai_compatible", "anthropic_compatible"}
            else []
        )

    monkeypatch.setattr(Credential, "get_by_provider", credentials)
    if not db:
        for key in (
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_ENDPOINT",
            "AZURE_OPENAI_API_VERSION",
            "OPENAI_COMPATIBLE_BASE_URL",
            "ANTHROPIC_COMPATIBLE_BASE_URL",
            "ANTHROPIC_COMPATIBLE_API_KEY",
        ):
            monkeypatch.setenv(key, "synthetic")
    monkeypatch.setattr(
        router.AIFactory,
        "get_available_providers",
        lambda: {
            "language": ["azure", "openai-compatible", "anthropic"],
            "embedding": ["azure", "openai-compatible"],
        },
    )
    response = client.get("/api/models/providers")
    assert response.status_code == 200
    result = response.json()
    assert result["supported_types"]["azure"] == ["language", "embedding"]
    assert result["supported_types"]["openai_compatible"] == ["language", "embedding"]
    assert result["supported_types"]["anthropic_compatible"] == ["language"]


@pytest.mark.parametrize(
    "error",
    [
        HTTPException(409, "conflict"),
        NotFoundError("absent"),
        RuntimeError("synthetic-secret"),
    ],
)
def test_availability_exception_is_safe(client, monkeypatch, error, failure_logs):
    from open_notebook.domain.credential import Credential

    monkeypatch.setattr(Credential, "get_by_provider", AsyncMock(return_value=[]))

    def fail():
        raise error

    monkeypatch.setattr(router.AIFactory, "get_available_providers", fail)
    response = client.get("/api/models/providers")
    assert response.status_code == (
        409
        if isinstance(error, HTTPException)
        else 404
        if isinstance(error, NotFoundError)
        else 500
    )
    assert "synthetic-secret" not in response.text
    assert "synthetic-secret" not in "".join(failure_logs)


def test_provider_store_unavailability_is_not_a_configured_credential(monkeypatch):
    import asyncio

    from open_notebook.domain.credential import Credential

    monkeypatch.setattr(
        Credential, "get_by_provider", AsyncMock(side_effect=RuntimeError("synthetic"))
    )
    assert asyncio.run(router._check_provider_has_credential("openai")) is False


@pytest.mark.parametrize(
    "records,priority,preferences,expected",
    [
        ([], ["openai"], {}, None),
        ([{"id": "a", "provider": "other", "name": "x"}], ["openai"], {}, "a"),
        (
            [
                {"id": "a", "provider": "openai", "name": "ordinary"},
                {"id": "b", "provider": "openai", "name": "preferred"},
            ],
            ["openai"],
            {"openai": ["unavailable", "preferred"]},
            "b",
        ),
        (
            [{"id": "a", "provider": "openai", "name": "ordinary"}],
            ["openai"],
            {"openai": ["unavailable"]},
            "a",
        ),
    ],
)
def test_preferred_model_real_fallback_order(records, priority, preferences, expected):
    result = router._get_preferred_model(records, priority, preferences)
    assert (result["id"] if result else None) == expected


def test_auto_assign_missing_models_keeps_defaults_and_does_not_write(
    client, monkeypatch
):
    defaults = DefaultModels()
    monkeypatch.setattr(DefaultModels, "get_instance", AsyncMock(return_value=defaults))
    monkeypatch.setattr(
        repository, "repo_query", AsyncMock(return_value=[{"type": "unsupported"}])
    )

    async def forbidden(self):
        pytest.fail("missing model set caused default write")

    monkeypatch.setattr(DefaultModels, "update", forbidden)
    response = client.post("/api/models/auto-assign")
    assert response.status_code == 200
    assert response.json()["assigned"] == {}
    assert set(response.json()["missing"]) == {
        "default_chat_model",
        "default_embedding_model",
    }


@pytest.mark.parametrize(
    "error",
    [
        HTTPException(409, "conflict"),
        NotFoundError("absent"),
        RuntimeError("synthetic-secret"),
    ],
)
def test_auto_assign_error_status_and_private_boundary(
    client, monkeypatch, error, failure_logs
):
    monkeypatch.setattr(DefaultModels, "get_instance", AsyncMock(side_effect=error))
    response = client.post("/api/models/auto-assign")
    assert response.status_code == (
        409
        if isinstance(error, HTTPException)
        else 404
        if isinstance(error, NotFoundError)
        else 500
    )
    assert "synthetic-secret" not in response.text
    assert "synthetic-secret" not in "".join(failure_logs)


def test_unexpected_probe_exception_never_returns_private_detail(
    client, monkeypatch, model, failure_logs
):
    monkeypatch.setattr(
        router,
        "test_individual_model",
        AsyncMock(side_effect=RuntimeError("synthetic-secret")),
    )
    response = client.post("/api/models/model:synthetic/test")
    assert response.status_code == 200 and response.json()["success"] is False
    assert "synthetic-secret" not in response.text
    assert "synthetic-secret" not in "".join(failure_logs)


def test_sparse_sdk_and_mode_config_do_not_invent_supported_modalities(
    client, monkeypatch
):
    from open_notebook.domain.credential import Credential

    monkeypatch.setattr(Credential, "get_by_provider", AsyncMock(return_value=[]))
    for name in (
        "AZURE_OPENAI_API_KEY_LLM",
        "AZURE_OPENAI_ENDPOINT_LLM",
        "AZURE_OPENAI_API_VERSION_LLM",
        "OPENAI_COMPATIBLE_BASE_URL_LLM",
        "OPENAI_API_KEY",
        "GOOGLE_API_KEY",
    ):
        monkeypatch.setenv(name, "synthetic")
    monkeypatch.setattr(
        router.AIFactory,
        "get_available_providers",
        lambda: {
            "language": ["azure", "openai-compatible"],
            "embedding": ["azure", "openai-compatible"],
            "unsupported": ["other"],
        },
    )
    response = client.get("/api/models/providers")
    assert response.status_code == 200
    supported = response.json()["supported_types"]
    assert supported["azure"] == ["language"]
    assert supported["openai_compatible"] == ["language"]
    assert supported["openai"] == []


def test_preferred_provider_without_preferences_uses_first():
    first = {"id": "first", "provider": "openai", "name": "a"}
    second = {"id": "second", "provider": "openai", "name": "b"}
    assert router._get_preferred_model([first, second], ["openai"], {}) == first


def test_create_domain_input_error_is_a_client_error(client, monkeypatch):
    from open_notebook.exceptions import InvalidInputError

    monkeypatch.setattr(
        repository,
        "repo_query",
        AsyncMock(side_effect=InvalidInputError("invalid model input")),
    )
    response = client.post(
        "/api/models",
        json={"name": "fixture", "provider": "openai", "type": "language"},
    )
    assert response.status_code == 400


def test_delete_preserves_non_notfound_domain_error(client, monkeypatch):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setattr(
        Model, "get", AsyncMock(side_effect=ConfigurationError("synthetic"))
    )
    assert client.delete("/api/models/model:synthetic").status_code == 422
