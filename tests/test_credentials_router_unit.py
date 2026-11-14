"""Direct credential route units; no HTTP stack, storage, provider or migration I/O."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError

from api.models import (
    CreateCredentialRequest,
    RegisterModelsRequest,
    UpdateCredentialRequest,
)
from api.routers import credentials as r
from open_notebook.exceptions import ConfigurationError, NotFoundError

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def boundaries(monkeypatch):
    monkeypatch.setattr(r, "require_encryption_key", Mock())
    monkeypatch.setattr(r, "validate_url", AsyncMock())
    # Projection is a separate service unit. Preserve observable fields in this stub.
    monkeypatch.setattr(
        r,
        "credential_to_response",
        lambda c, n: {"id": c.id, "name": c.name, "model_count": n},
    )


def credential(**changes):
    fields = dict(
        id="credential:x",
        name="Synthetic",
        provider="OpenAI",
        modalities=[],
        api_key=SecretStr("synthetic-only"),
        get_linked_models=AsyncMock(return_value=[]),
        save=AsyncMock(),
        delete=AsyncMock(),
        to_esperanto_config=Mock(return_value={"synthetic": True}),
    )
    fields.update({k: "old" for k in CLEARABLE})
    fields.update(changes)
    return SimpleNamespace(**fields)


CLEARABLE = [
    "base_url",
    "endpoint",
    "api_version",
    "endpoint_llm",
    "endpoint_embedding",
    "endpoint_stt",
    "endpoint_tts",
    "project",
    "location",
    "credentials_path",
    "num_ctx",
]
URLS = [
    "base_url",
    "endpoint",
    "endpoint_llm",
    "endpoint_embedding",
    "endpoint_stt",
    "endpoint_tts",
]

CASES = [
    ("get_status", [], r, "get_provider_status", 500),
    ("get_env_status", [], r, "svc_get_env_status", 500),
    ("list_credentials", [None], r.Credential, "get_all", 500),
    ("list_credentials_by_provider", ["OPENAI"], r.Credential, "get_by_provider", 500),
    (
        "create_credential",
        [CreateCredentialRequest(name="X", provider="openai")],
        r.Credential,
        "save",
        500,
    ),
    ("get_credential", ["credential:x"], r.Credential, "get", 404),
    (
        "update_credential",
        ["credential:x", UpdateCredentialRequest()],
        r.Credential,
        "get",
        500,
    ),
    ("delete_credential", ["credential:x", None], r.Credential, "get", 500),
    ("discover_models_for_credential", ["credential:x"], r.Credential, "get", 500),
    (
        "register_models_for_credential",
        ["credential:x", RegisterModelsRequest(models=[])],
        r,
        "register_models",
        500,
    ),
    ("migrate_from_provider_config", [], r, "svc_migrate_from_provider_config", 500),
    ("migrate_encryption", [], r, "svc_migrate_encryption_scheme", 500),
    ("migrate_from_env", [], r, "svc_migrate_from_env", 500),
]


@pytest.mark.parametrize("name,args,owner,target,status", CASES)
@pytest.mark.parametrize("kind", ["http", "typed", "unexpected"])
async def test_error_mapping(monkeypatch, name, args, owner, target, status, kind):
    error = {
        "http": HTTPException(403, "denied"),
        "typed": ConfigurationError("configuration"),
        "unexpected": RuntimeError("synthetic failure"),
    }[kind]
    monkeypatch.setattr(owner, target, AsyncMock(side_effect=error))
    with pytest.raises(
        ConfigurationError if kind == "typed" else HTTPException
    ) as caught:
        await getattr(r, name)(*args)
    if kind == "unexpected":
        assert caught.value.status_code == status
        assert "synthetic failure" not in caught.value.detail
    else:
        assert caught.value is error


@pytest.mark.parametrize(
    "name,target",
    [
        ("get_status", "get_provider_status"),
        ("get_env_status", "svc_get_env_status"),
        ("migrate_from_provider_config", "svc_migrate_from_provider_config"),
        ("migrate_encryption", "svc_migrate_encryption_scheme"),
        ("migrate_from_env", "svc_migrate_from_env"),
    ],
)
async def test_delegated_status_or_migration(monkeypatch, name, target):
    payload = {"synthetic": True}
    service = AsyncMock(return_value=payload)
    monkeypatch.setattr(r, target, service)
    assert await getattr(r, name)() is payload
    service.assert_awaited_once_with()
    if name.startswith("migrate"):
        service.side_effect = ValueError("x" * 250)
        with pytest.raises(HTTPException) as caught:
            await getattr(r, name)()
        assert caught.value.status_code == 400 and caught.value.detail == "x" * 200


@pytest.mark.parametrize("mode", ["all", "filter", "provider", "one"])
async def test_read_credential_metadata(monkeypatch, mode):
    c = credential(get_linked_models=AsyncMock(return_value=[object(), object()]))
    query = AsyncMock(return_value=c if mode == "one" else [c])
    target = {
        "all": "get_all",
        "filter": "get_by_provider",
        "provider": "get_by_provider",
        "one": "get",
    }[mode]
    monkeypatch.setattr(r.Credential, target, query)
    if mode == "one":
        result = [await r.get_credential("credential:x")]
        query.assert_awaited_once_with("credential:x")
    elif mode == "provider":
        result = await r.list_credentials_by_provider("OPENAI")
        query.assert_awaited_once_with("openai")
    else:
        result = await r.list_credentials("openai" if mode == "filter" else None)
        if mode == "all":
            query.assert_awaited_once_with(order_by="provider, created")
        else:
            query.assert_awaited_once_with("openai")
    assert result == [{"id": "credential:x", "name": "Synthetic", "model_count": 2}]


@pytest.mark.parametrize("has_key", [False, True])
async def test_create_real_domain_values(monkeypatch, has_key):
    saved = []

    async def save(c):
        c.id = "credential:new"
        saved.append(c)

    monkeypatch.setattr(r.Credential, "save", save)
    values = {k: "https://synthetic.example/" + k for k in URLS}
    req = CreateCredentialRequest(
        name="New",
        provider="openai",
        api_key="synthetic" if has_key else None,
        modalities=["language"],
        api_version="v1",
        project="p",
        location="l",
        credentials_path="not-read",
        num_ctx=4096,
        **values,
    )
    result = await r.create_credential(req)
    assert result["id"] == "credential:new" and result["model_count"] == 0
    c = saved[0]
    assert c.provider == "openai" and c.modalities == ["language"] and c.num_ctx == 4096
    assert (c.api_key.get_secret_value() if c.api_key else None) == (
        "synthetic" if has_key else None
    )
    assert c.project == "p" and c.location == "l" and c.credentials_path == "not-read"
    assert r.validate_url.await_count == 6
    for k, v in values.items():
        assert getattr(c, k) == v
        r.validate_url.assert_any_await(v, "openai")


@pytest.mark.parametrize("operation", ["create", "update"])
@pytest.mark.parametrize("boundary", ["key", "url"])
async def test_preflight_refuses_before_persistence(monkeypatch, operation, boundary):
    lookup = AsyncMock()
    save = AsyncMock()
    monkeypatch.setattr(r.Credential, "get", lookup)
    monkeypatch.setattr(r.Credential, "save", save)
    if boundary == "key":
        r.require_encryption_key.side_effect = ValueError("missing setup")
    else:
        r.validate_url.side_effect = ValueError("invalid URL")
    request = (
        CreateCredentialRequest(
            name="X", provider="openai", base_url="https://synthetic.example"
        )
        if operation == "create"
        else UpdateCredentialRequest(base_url="https://synthetic.example")
    )
    with pytest.raises(HTTPException) as caught:
        if operation == "create":
            await r.create_credential(request)
        else:
            await r.update_credential("credential:x", request)
    assert caught.value.status_code == 400
    lookup.assert_not_awaited()
    save.assert_not_awaited()


@pytest.mark.parametrize("mode", ["absent", "set", "null", "empty"])
async def test_update_field_presence(monkeypatch, mode):
    c = credential()
    monkeypatch.setattr(r.Credential, "get", AsyncMock(return_value=c))
    check = Mock()
    monkeypatch.setattr(r, "ensure_provider_required_fields", check)
    data = {}
    if mode != "absent":
        data = {
            k: (
                None
                if mode == "null"
                else (0 if k == "num_ctx" else "")
                if mode == "empty"
                else 8192
                if k == "num_ctx"
                else "https://synthetic.example"
            )
            for k in CLEARABLE
        }
    if mode == "set":
        data.update(
            name="Changed", modalities=["embedding"], api_key="replacement-synthetic"
        )
    response = await r.update_credential(
        "credential:x", UpdateCredentialRequest(**data)
    )
    for k in CLEARABLE:
        expected = "old" if mode == "absent" else data[k] or None
        assert getattr(c, k) == expected
    assert c.name == ("Changed" if mode == "set" else "Synthetic")
    if mode == "set":
        assert (
            c.modalities == ["embedding"]
            and c.api_key.get_secret_value() == "replacement-synthetic"
        )
        assert r.validate_url.await_count == 6
        r.validate_url.assert_any_await("https://synthetic.example", "update")
    check.assert_called_once_with(c)
    c.save.assert_awaited_once_with()
    assert response["model_count"] == 0


async def test_required_update_and_missing_records(monkeypatch):
    c = credential()
    monkeypatch.setattr(r.Credential, "get", AsyncMock(return_value=c))
    monkeypatch.setattr(
        r,
        "ensure_provider_required_fields",
        Mock(side_effect=ValueError("required field")),
    )
    with pytest.raises(HTTPException) as caught:
        await r.update_credential(
            "credential:x", UpdateCredentialRequest(base_url=None)
        )
    assert caught.value.status_code == 400
    c.save.assert_not_awaited()
    monkeypatch.setattr(
        r.Credential, "get", AsyncMock(side_effect=NotFoundError("absent"))
    )
    for fn, args in [
        (r.update_credential, ["credential:x", UpdateCredentialRequest()]),
        (r.delete_credential, ["credential:x", None]),
    ]:
        with pytest.raises(HTTPException) as missing:
            await fn(*args)
        assert missing.value.status_code == 404


@pytest.mark.parametrize("mode", ["empty", "cascade", "migrate"])
async def test_delete_normal_objects(monkeypatch, mode):
    model = SimpleNamespace(
        credential="credential:x", save=AsyncMock(), delete=AsyncMock()
    )
    c = credential(
        get_linked_models=AsyncMock(return_value=[] if mode == "empty" else [model])
    )
    target = credential(id="credential:target")
    lookup = AsyncMock(side_effect=[c, target])
    monkeypatch.setattr(r.Credential, "get", lookup)
    result = await r.delete_credential(
        "credential:x", "credential:target" if mode == "migrate" else None
    )
    c.delete.assert_awaited_once_with()
    assert result.deleted_models == int(mode == "cascade")
    if mode == "migrate":
        assert model.credential == "credential:target"
        model.save.assert_awaited_once_with()
        model.delete.assert_not_awaited()
    elif mode == "cascade":
        model.delete.assert_awaited_once_with()
    else:
        model.save.assert_not_awaited()
        model.delete.assert_not_awaited()


@pytest.mark.parametrize("mode", ["empty", "cascade", "migrate", "fallback_id"])
async def test_delete_undecryptable_uses_bound_repository_stubs(monkeypatch, mode):
    target = credential(id=None if mode == "fallback_id" else "credential:target")
    monkeypatch.setattr(
        r.Credential,
        "get",
        AsyncMock(side_effect=[ValueError("synthetic unreadable"), target]),
    )
    linked = [] if mode == "empty" else [{"id": "model:x"}, {}]
    query = AsyncMock(return_value=linked)
    delete = AsyncMock()
    monkeypatch.setattr(r, "repo_query", query)
    monkeypatch.setattr(r, "repo_delete", delete)
    destination = "credential:target" if mode in ["migrate", "fallback_id"] else None
    result = await r.delete_credential("credential:x", destination)
    assert result.deleted_models == int(mode == "cascade")
    assert str(query.await_args_list[0].args[1]["cred_id"]) == "credential:x"
    if destination:
        assert query.await_count == 2
        sql, params = query.await_args_list[1].args
        assert sql == "UPDATE $model_id SET credential = $target_id"
        assert (
            str(params["target_id"]) == destination
            and str(params["model_id"]) == "model:x"
        )
        delete.assert_awaited_once_with("credential:x")
    elif mode == "cascade":
        assert [x.args for x in delete.await_args_list] == [
            ("model:x",),
            ("credential:x",),
        ]
    else:
        delete.assert_awaited_once_with("credential:x")


async def test_probe_delegates_without_provider(monkeypatch):
    probe = AsyncMock(return_value={"success": False, "message": "synthetic refusal"})
    monkeypatch.setattr(r, "svc_test_credential", probe)
    assert (await r.test_credential("credential:x"))["success"] is False
    probe.assert_awaited_once_with("credential:x")


@pytest.mark.parametrize("identifier", [None, "credential:x"])
async def test_discovery_builds_response(monkeypatch, identifier):
    c = credential(id=identifier)
    monkeypatch.setattr(r.Credential, "get", AsyncMock(return_value=c))
    discover = AsyncMock(
        return_value=[
            {"name": "one", "provider": "openai", "description": "Synthetic"},
            {"name": "two", "provider": "openai"},
        ]
    )
    monkeypatch.setattr(r, "discover_with_config", discover)
    result = await r.discover_models_for_credential("credential:x")
    assert result.credential_id == (identifier or "") and result.provider == "openai"
    assert [m.description for m in result.discovered] == ["Synthetic", None]
    c.to_esperanto_config.assert_called_once_with()
    discover.assert_awaited_once_with("openai", {"synthetic": True})


async def test_registration_preserves_request_models(monkeypatch):
    request = RegisterModelsRequest(
        models=[{"name": "one", "provider": "openai", "model_type": "language"}]
    )
    service = AsyncMock(return_value={"created": 1, "existing": 2})
    monkeypatch.setattr(r, "register_models", service)
    result = await r.register_models_for_credential("credential:x", request)
    assert result.created == 1 and result.existing == 2
    service.assert_awaited_once_with("credential:x", request.models)


async def test_actual_request_provider_validation():
    with pytest.raises(ValidationError):
        CreateCredentialRequest(name="X", provider="not-supported")
    with pytest.raises(ValidationError):
        CreateCredentialRequest(name="X", provider="anthropic_compatible")
