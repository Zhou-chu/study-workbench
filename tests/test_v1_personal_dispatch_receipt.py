"""Dispatch ACK evidence is additive, lossless and never execution authority."""

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from personal_dispatch_receipt_fixtures import FIXTURE
from test_v1_evidence_ingest import MemoryStore

from api.personal_service import PersonalService
from api.routers import evidence
from open_notebook.exceptions import InvalidInputError

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
