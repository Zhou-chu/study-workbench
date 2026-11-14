"""Route/request tests with synthetic persistence; not live provider or auth E2E."""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr

from api.routers import credentials as router
from open_notebook.domain.credential import Credential
from open_notebook.exceptions import NotFoundError


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@pytest.fixture
def cred(monkeypatch):
    value = Credential(
        id="credential:synthetic",
        name="Synthetic",
        provider="openai",
        modalities=["language"],
        api_key=SecretStr("synthetic-private-key"),
    )
    monkeypatch.setattr(Credential, "get", AsyncMock(return_value=value))
    monkeypatch.setattr(Credential, "get_linked_models", AsyncMock(return_value=[]))
    return value


@pytest.mark.parametrize(
    "path", ["", "?provider=openai", "/by-provider/OPENAI", "/credential:synthetic"]
)
def test_read_routes_count_models_and_never_return_secret(
    client, monkeypatch, cred, path
):
    monkeypatch.setattr(Credential, "get_all", AsyncMock(return_value=[cred]))
    monkeypatch.setattr(Credential, "get_by_provider", AsyncMock(return_value=[cred]))
    monkeypatch.setattr(
        Credential, "get_linked_models", AsyncMock(return_value=[object(), object()])
    )
    response = client.get("/api/credentials" + path)
    assert response.status_code == 200
    rows = response.json()
    row = rows[0] if isinstance(rows, list) else rows
    assert row["model_count"] == 2 and row["has_api_key"]
    assert "api_key" not in row and "synthetic-private-key" not in response.text


CASES = [
    ("get", "/status", "get_provider_status", None),
    ("get", "/env-status", "svc_get_env_status", None),
    ("get", "", "get_all", None),
    ("get", "/by-provider/openai", "get_by_provider", None),
    ("get", "/credential:synthetic", "get", None),
    ("post", "/credential:synthetic/discover", "get", None),
    (
        "post",
        "/credential:synthetic/register-models",
        "register_models",
        {"models": []},
    ),
    ("post", "/migrate-from-env", "svc_migrate_from_env", None),
    ("post", "/migrate-from-provider-config", "svc_migrate_from_provider_config", None),
    ("post", "/migrate-encryption", "svc_migrate_encryption_scheme", None),
]


@pytest.mark.parametrize("method,path,target,payload", CASES)
@pytest.mark.parametrize("failure", ["http", "domain", "unexpected"])
def test_router_error_mapping_keeps_typed_errors_and_redacts_unexpected(
    client, monkeypatch, method, path, target, payload, failure
):
    exception = {
        "http": HTTPException(409, "synthetic conflict"),
        "domain": NotFoundError("synthetic absent"),
        "unexpected": RuntimeError("synthetic-private-internal"),
    }[failure]
    owner = Credential if target in {"get", "get_all", "get_by_provider"} else router
    monkeypatch.setattr(owner, target, AsyncMock(side_effect=exception))
    response = client.request(method, "/api/credentials" + path, json=payload)
    expected = {
        "http": 409,
        "domain": 404,
        "unexpected": 404 if path == "/credential:synthetic" else 500,
    }[failure]
    assert response.status_code == expected
    if failure == "unexpected":
        assert "synthetic-private-internal" not in response.text


@pytest.mark.parametrize(
    "target,path",
    [
        ("get_provider_status", "/status"),
        ("svc_get_env_status", "/env-status"),
        ("svc_test_credential", "/credential:synthetic/test"),
        ("svc_migrate_from_env", "/migrate-from-env"),
        ("svc_migrate_from_provider_config", "/migrate-from-provider-config"),
        ("svc_migrate_encryption_scheme", "/migrate-encryption"),
    ],
)
def test_service_result_routes_preserve_structured_result(
    client, monkeypatch, target, path
):
    result = {"synthetic": "result"}
    monkeypatch.setattr(router, target, AsyncMock(return_value=result))
    response = client.request(
        "get" if path in {"/status", "/env-status"} else "post",
        "/api/credentials" + path,
    )
    assert response.status_code == 200 and response.json() == result


@pytest.mark.parametrize(
    "path,target",
    [
        ("/migrate-from-env", "svc_migrate_from_env"),
        ("/migrate-from-provider-config", "svc_migrate_from_provider_config"),
        ("/migrate-encryption", "svc_migrate_encryption_scheme"),
    ],
)
def test_migration_validation_is_bounded(client, monkeypatch, path, target):
    monkeypatch.setattr(router, target, AsyncMock(side_effect=ValueError("x" * 300)))
    response = client.post("/api/credentials" + path)
    assert response.status_code == 400
    assert len(response.json()["detail"]) == 200


@pytest.mark.parametrize(
    "method,path", [("post", ""), ("put", "/credential:synthetic")]
)
def test_write_requires_encryption_before_persistence(
    client, monkeypatch, method, path
):
    monkeypatch.setattr(
        router,
        "require_encryption_key",
        lambda: (_ for _ in ()).throw(ValueError("encryption required")),
    )

    async def forbidden(*args, **kwargs):
        pytest.fail("persisted without encryption")

    monkeypatch.setattr(Credential, "save", forbidden)
    response = client.request(
        method,
        "/api/credentials" + path,
        json={"name": "Synthetic", "provider": "openai", "modalities": ["language"]},
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "method,path", [("post", ""), ("put", "/credential:synthetic")]
)
def test_url_validation_rejects_before_persistence(client, monkeypatch, method, path):
    monkeypatch.setattr(router, "require_encryption_key", lambda: None)
    monkeypatch.setattr(
        router, "validate_url", AsyncMock(side_effect=ValueError("URL rejected"))
    )

    async def forbidden(*args, **kwargs):
        pytest.fail("persisted invalid URL")

    monkeypatch.setattr(Credential, "save", forbidden)
    response = client.request(
        method,
        "/api/credentials" + path,
        json={
            "name": "Synthetic",
            "provider": "openai",
            "modalities": ["language"],
            "base_url": "http://fixture.invalid",
        },
    )
    assert response.status_code == 400


def test_create_real_model_serializes_metadata_only(client, monkeypatch):
    monkeypatch.setattr(router, "require_encryption_key", lambda: None)
    saved = []

    async def save(self):
        self.id = "credential:created"
        saved.append(self.model_dump())

    monkeypatch.setattr(Credential, "save", save)
    response = client.post(
        "/api/credentials",
        json={
            "name": "Created",
            "provider": "openai",
            "modalities": ["language"],
            "api_key": "synthetic-secret",
        },
    )
    assert response.status_code == 201
    assert saved[0]["provider"] == "openai"
    assert response.json()["id"] == "credential:created"
    assert "synthetic-secret" not in response.text


@pytest.mark.parametrize(
    "method,path", [("post", ""), ("put", "/credential:synthetic")]
)
@pytest.mark.parametrize("failure", ["http", "domain", "unexpected"])
def test_write_persistence_failure_mapping(
    client, monkeypatch, cred, method, path, failure
):
    monkeypatch.setattr(router, "require_encryption_key", lambda: None)
    exception = {
        "http": HTTPException(409, "conflict"),
        "domain": NotFoundError("absent"),
        "unexpected": RuntimeError("synthetic-secret"),
    }[failure]
    monkeypatch.setattr(Credential, "save", AsyncMock(side_effect=exception))
    response = client.request(
        method,
        "/api/credentials" + path,
        json={"name": "Synthetic", "provider": "openai", "modalities": ["language"]},
    )
    assert (
        response.status_code == {"http": 409, "domain": 404, "unexpected": 500}[failure]
    )
    assert "synthetic-secret" not in response.text


@pytest.mark.parametrize("fallback", [False, True])
@pytest.mark.parametrize("migrate", [False, True])
def test_delete_preserves_reassignment_or_cascade_boundary(
    client, monkeypatch, cred, fallback, migrate
):
    target = Credential(
        id="credential:target",
        name="Target",
        provider="openai",
        modalities=["language"],
    )
    saves = []
    deletes = []
    queries = []

    async def save_model(self):
        saves.append(self.credential)

    async def delete_model(self):
        deletes.append(self.id)

    from open_notebook.ai.models import Model

    model = Model(
        id="model:linked",
        name="model",
        provider="openai",
        type="language",
        credential=cred.id,
    )
    monkeypatch.setattr(Model, "save", save_model)
    monkeypatch.setattr(Model, "delete", delete_model)

    async def get(identifier):
        if identifier == "credential:target":
            return target
        if fallback:
            raise ValueError("synthetic decryption failure")
        return cred

    monkeypatch.setattr(Credential, "get", get)
    monkeypatch.setattr(
        Credential, "get_linked_models", AsyncMock(return_value=[model])
    )

    async def delete(self):
        deletes.append(self.id)

    monkeypatch.setattr(Credential, "delete", delete)

    async def query(sql, params):
        queries.append((sql, params))
        return [{"id": "model:linked"}, {}] if sql.startswith("SELECT") else []

    monkeypatch.setattr(router, "repo_query", query)

    async def raw_delete(identifier):
        deletes.append(identifier)

    monkeypatch.setattr(router, "repo_delete", raw_delete)
    response = client.delete(
        "/api/credentials/credential:synthetic"
        + ("?migrate_to=credential:target" if migrate else "")
    )
    assert response.status_code == 200
    assert response.json()["deleted_models"] == (0 if migrate else 1)
    assert deletes == (
        ["credential:synthetic"]
        if migrate
        else ["model:linked", "credential:synthetic"]
    )
    if migrate:
        if fallback:
            assert str(queries[1][1]["target_id"]) == "credential:target"
        else:
            assert saves == ["credential:target"]


def test_update_applies_present_fields_without_returning_key(client, monkeypatch, cred):
    monkeypatch.setattr(router, "require_encryption_key", lambda: None)
    monkeypatch.setattr(router, "validate_url", AsyncMock())
    saved = []

    async def save(self):
        saved.append(self.model_dump())

    monkeypatch.setattr(Credential, "save", save)
    payload = {
        "name": "Updated",
        "modalities": ["embedding"],
        "api_key": "synthetic-updated",
        "base_url": "https://fixture.invalid",
        "endpoint": "https://fixture.invalid",
        "api_version": "test",
        "endpoint_llm": "https://fixture.invalid",
        "endpoint_embedding": "https://fixture.invalid",
        "endpoint_stt": "https://fixture.invalid",
        "endpoint_tts": "https://fixture.invalid",
        "project": "project",
        "location": "location",
        "credentials_path": "synthetic-path",
        "num_ctx": 4096,
    }
    response = client.put("/api/credentials/credential:synthetic", json=payload)
    assert response.status_code == 200
    assert saved[0]["name"] == "Updated" and saved[0]["num_ctx"] == 4096
    assert saved[0]["api_key"].get_secret_value() == "synthetic-updated"
    assert "synthetic-updated" not in response.text


def test_discover_and_register_response_contracts(client, monkeypatch, cred):
    monkeypatch.setattr(
        router,
        "discover_with_config",
        AsyncMock(
            return_value=[
                {
                    "name": "fixture",
                    "provider": "openai",
                    "description": "Synthetic model",
                }
            ]
        ),
    )
    response = client.post("/api/credentials/credential:synthetic/discover")
    assert response.status_code == 200
    assert response.json()["discovered"] == [
        {
            "name": "fixture",
            "provider": "openai",
            "description": "Synthetic model",
            "model_type": None,
        }
    ]
    monkeypatch.setattr(
        router, "register_models", AsyncMock(return_value={"created": 1, "existing": 0})
    )
    response = client.post(
        "/api/credentials/credential:synthetic/register-models",
        json={
            "models": [
                {"name": "fixture", "provider": "openai", "model_type": "language"}
            ]
        },
    )
    assert response.status_code == 200
    assert response.json() == {"created": 1, "existing": 0}


@pytest.mark.parametrize("failure", ["http", "domain", "unexpected"])
def test_delete_failure_response_does_not_disclose_internal_error(
    client, monkeypatch, failure
):
    exception = {
        "http": HTTPException(409, "conflict"),
        "domain": NotFoundError("absent"),
        "unexpected": RuntimeError("synthetic-secret"),
    }[failure]
    monkeypatch.setattr(Credential, "get", AsyncMock(side_effect=exception))
    response = client.delete("/api/credentials/credential:synthetic")
    assert (
        response.status_code == {"http": 409, "domain": 404, "unexpected": 500}[failure]
    )
    assert "synthetic-secret" not in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "Missing provider"},
        {"provider": "not-a-provider", "name": "Invalid"},
        {"provider": "openai", "name": "Synthetic", "modalities": {"not": "a list"}},
    ],
)
def test_invalid_create_request_fails_before_domain_write(client, monkeypatch, payload):
    async def forbidden(*args, **kwargs):
        pytest.fail("invalid request entered domain write")

    monkeypatch.setattr(Credential, "save", forbidden)
    response = client.post("/api/credentials", json=payload)
    assert response.status_code == 422


def test_update_cannot_clear_required_compatible_url(client, monkeypatch, cred):
    cred.provider = "anthropic_compatible"
    cred.base_url = "https://fixture.invalid"
    monkeypatch.setattr(router, "require_encryption_key", lambda: None)

    async def forbidden(*args, **kwargs):
        pytest.fail("invalid merged credential persisted")

    monkeypatch.setattr(Credential, "save", forbidden)
    response = client.put(
        "/api/credentials/credential:synthetic", json={"base_url": None}
    )
    assert response.status_code == 400


@pytest.mark.parametrize("method", ["put", "delete"])
def test_mutation_preserves_configuration_error_status(client, monkeypatch, method):
    from open_notebook.exceptions import ConfigurationError

    monkeypatch.setattr(router, "require_encryption_key", lambda: None)
    monkeypatch.setattr(
        Credential, "get", AsyncMock(side_effect=ConfigurationError("synthetic config"))
    )
    response = client.request(method, "/api/credentials/credential:synthetic", json={})
    assert response.status_code == 422


def test_undecryptable_credential_without_models_only_deletes_itself(
    client, monkeypatch
):
    monkeypatch.setattr(
        Credential,
        "get",
        AsyncMock(side_effect=ValueError("synthetic encrypted record")),
    )
    monkeypatch.setattr(router, "repo_query", AsyncMock(return_value=[]))
    deleted = []

    async def delete(identifier):
        deleted.append(identifier)

    monkeypatch.setattr(router, "repo_delete", delete)
    response = client.delete("/api/credentials/credential:synthetic")
    assert response.status_code == 200
    assert response.json()["deleted_models"] == 0
    assert deleted == ["credential:synthetic"]
