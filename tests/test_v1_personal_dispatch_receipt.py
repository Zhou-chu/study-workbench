"""Dispatch ACK evidence is additive, lossless and never execution authority."""

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore
from test_v1_personal_enqueue_reconciliation import MemoryStore as SnapshotStore

from api.personal_service import PersonalService
from api.routers import evidence
from open_notebook.exceptions import InvalidInputError

FIXTURE = json.loads(
    (
        Path(__file__).parents[1] / "contracts/v1/fixtures/dispatch-unknown.json"
    ).read_text()
)
ABSENT = object()
RETAINED = [
    ABSENT,
    None,
    "legacy receipt",
    [False, {"future": "retained"}],
    False,
    17,
    {},
    {"dispatch_ack": "rejected", "retry_safe": True},
    {
        "dispatch_ack": "unknown",
        "job_id": "job_conflicting",
        "turn_id": "turn_conflicting",
        "retry_safe": True,
        "future": [None, {"opaque": True}],
    },
]


def routed_app(monkeypatch, service):
    from api.main import app as actual_app

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    monkeypatch.setattr(evidence.Notebook, "get", notebook_get)
    monkeypatch.setattr(evidence, "PersonalService", lambda: service)
    app = FastAPI()
    # Use the registered application handler, not a test-only error mapper.
    app.exception_handler(InvalidInputError)(
        actual_app.exception_handlers[InvalidInputError]
    )
    app.include_router(evidence.router, prefix="/api")
    return app


@pytest.mark.asyncio
async def test_dispatch_unknown_fixture_matches_real_service_and_registered_handler(
    monkeypatch,
):
    async def submit(command, args):
        raise TimeoutError("SYNTHETIC_PRIVATE_QUEUE_CAUSE")

    service = PersonalService(store=MemoryStore(), submit=submit)
    app = routed_app(monkeypatch, service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=FIXTURE["request"]
        )
        assert first.status_code == FIXTURE["status"] == 400
        assert first.json() == FIXTURE["body"]
        repeated = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=FIXTURE["request"]
        )
    assert repeated.status_code == 200
    assert repeated.json() == FIXTURE["same_key_response"]


@pytest.mark.asyncio
@pytest.mark.parametrize("receipt", RETAINED)
async def test_same_key_preserves_any_retained_receipt_without_dispatch(
    monkeypatch, receipt
):
    store = MemoryStore()

    async def no_dispatch(*_):
        pytest.fail("Retained receipts must never authorize enqueue")

    service = PersonalService(store=store, submit=no_dispatch)
    request = evidence.TurnRequest(**FIXTURE["request"]).dispatch_payload()

    # Seed the exact existing identity/request hash through the real service,
    # with only the external queue seam replaced.
    async def initial_dispatch(*_):
        return "command:synthetic"

    initial = await PersonalService(store=store, submit=initial_dispatch).submit_turn(
        "chat:synthetic", request
    )
    retained = {**initial, "state": "failed"}
    if receipt is not ABSENT:
        retained["dispatch_receipt"] = receipt
    await store.put("job", retained["job_id"], retained)
    app = routed_app(monkeypatch, service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/personal/chats/chat:synthetic/turns", json=FIXTURE["request"]
        )
    assert response.status_code == 200
    expected = {
        "job_id": retained["job_id"],
        "turn_id": retained["turn_id"],
        "state": "failed",
    }
    if receipt is not ABSENT:
        expected["dispatch_receipt"] = receipt
    assert response.json() == expected
    assert await service.run_turn(retained["job_id"]) == retained
    assert await store.get("job", retained["job_id"]) == retained


@pytest.mark.asyncio
async def test_dispatch_handler_allowlists_fixed_fields_and_retains_cors(monkeypatch):
    import api.main as main

    store = MemoryStore()

    async def submit(*_):
        raise TimeoutError("SYNTHETIC_PRIVATE_CAUSE")

    with pytest.raises(InvalidInputError) as caught:
        await PersonalService(store=store, submit=submit).submit_turn(
            "chat:synthetic", FIXTURE["request"]
        )
    caught.value.__dict__.update(
        private="SYNTHETIC_PRIVATE_EXTRA",
        dispatch_receipt={"retry_safe": True, "private": "SYNTHETIC_PRIVATE_DICT"},
    )
    app = routed_app(monkeypatch, None)
    monkeypatch.setattr(main, "CORS_ALLOWED_ORIGINS", ["https://synthetic.example"])
    monkeypatch.setattr(main, "CORS_ALLOW_CREDENTIALS", True)

    @app.get("/synthetic-error/{kind}")
    async def raise_error(kind: str):
        if kind == "dispatch":
            raise caught.value
        raise InvalidInputError("ORDINARY_INVALID_INPUT")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for kind, expected in [
            ("dispatch", FIXTURE["body"]),
            ("ordinary", {"detail": "ORDINARY_INVALID_INPUT"}),
        ]:
            response = await client.get(
                f"/synthetic-error/{kind}",
                headers={"Origin": "https://synthetic.example"},
            )
            assert response.status_code == 400
            assert response.json() == expected
            assert "SYNTHETIC_PRIVATE" not in response.text
            assert response.headers["access-control-allow-origin"] == (
                "https://synthetic.example"
            )
            assert response.headers["access-control-allow-credentials"] == "true"


@pytest.mark.asyncio
@pytest.mark.parametrize("write_committed", [False, True])
async def test_receipt_persistence_error_is_not_a_durable_dispatch_receipt(
    monkeypatch,
    write_committed,
):
    store = SnapshotStore()
    queue_failure = TimeoutError("SYNTHETIC_QUEUE_ACK_UNKNOWN")
    storage_failure = RuntimeError("SYNTHETIC_STORAGE_ACK_UNKNOWN")
    put = store.put

    async def uncertain_put(kind, identity, value, create_only=False):
        if create_only:
            return await put(kind, identity, value, create_only=True)
        if write_committed:
            await put(kind, identity, value)
        raise storage_failure

    monkeypatch.setattr(store, "put", uncertain_put)

    async def submit(*_):
        raise queue_failure

    with pytest.raises(RuntimeError) as caught:
        await PersonalService(store=store, submit=submit).submit_turn(
            "chat:synthetic", FIXTURE["request"]
        )
    assert caught.value is storage_failure
    assert caught.value.__context__ is queue_failure
    initial = store.writes[0][1]
    persisted = await store.get("job", initial["job_id"])
    if write_committed:
        assert persisted["dispatch_receipt"] == FIXTURE["body"]["dispatch_receipt"]
    else:
        assert persisted == initial
        assert "dispatch_receipt" not in persisted


def test_turn_error_schema_documents_strict_generation_not_retained_data():
    from api.main import app

    schema = app.openapi()
    operation = schema["paths"]["/api/personal/chats/{chat_session_id}/turns"]["post"]
    assert "400" in operation["responses"]
    from pydantic import ValidationError

    from api.personal_contracts import PersonalTurnDispatchUnknownResponse

    error = PersonalTurnDispatchUnknownResponse.model_validate(FIXTURE["body"])
    assert error.model_dump() == FIXTURE["body"]
    for bad in [
        {**FIXTURE["body"]["dispatch_receipt"], "retry_safe": True},
        {**FIXTURE["body"]["dispatch_receipt"], "dispatch_ack": "rejected"},
        {**FIXTURE["body"]["dispatch_receipt"], "private": "not_public"},
    ]:
        with pytest.raises(ValidationError):
            PersonalTurnDispatchUnknownResponse.model_validate(
                {"detail": "WORKER_UNAVAILABLE", "dispatch_receipt": bad}
            )
    retained = schema["components"]["schemas"]["TurnSubmissionResponse"]
    assert "dispatch_receipt" in retained["properties"]
    assert "dispatch_receipt" not in retained["required"]
    assert "$ref" not in retained["properties"]["dispatch_receipt"]
    generated = schema["components"]["schemas"]["PersonalTurnDispatchReceipt"]
    assert generated["additionalProperties"] is False
    assert generated["properties"]["retry_safe"]["const"] is False


@pytest.mark.asyncio
async def test_archive_remaps_nested_receipt_ids_without_replay(tmp_path):
    from pydantic import TypeAdapter

    from api.personal_contracts import PersonalJobResponse
    from api.portable_service import FILES, PortableService

    project: dict[str, Any] = {kind: [] for kind in FILES}
    project["notebook"] = {"id": "notebook:synthetic"}
    project["turn"] = [{"turn_id": "turn_old", "notebook_id": "notebook:synthetic"}]
    receipt = {
        "dispatch_ack": "unknown",
        "job_id": "job_old",
        "turn_id": "turn_old",
        "retry_safe": False,
        "future": ["retained"],
    }
    project["job"] = [
        {
            "job_id": "job_old",
            "turn_id": "turn_old",
            "notebook_id": "notebook:synthetic",
            "state": "failed",
            "dispatch_receipt": deepcopy(receipt),
        }
    ]
    store = MemoryStore()
    restored, mapping = PortableService(store=store, data_root=tmp_path)._remap(
        project, "restored/synthetic"
    )
    job = restored["job"][0]
    assert job["dispatch_receipt"] == {
        **receipt,
        "job_id": mapping["job_old"],
        "turn_id": mapping["turn_old"],
    }
    assert job["historical_state"] == "failed"
    assert job["restored_history"] is True
    assert job["replay_allowed"] is False
    adapter: TypeAdapter[Any] = TypeAdapter(PersonalJobResponse)
    assert (
        adapter.dump_python(
            adapter.validate_python(job), mode="json", exclude_unset=True
        )
        == job
    )
    await store.put("job", job["job_id"], job)
    assert await PersonalService(store=store).run_turn(job["job_id"]) == job
