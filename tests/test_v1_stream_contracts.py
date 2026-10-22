"""Public synthetic SSE bytes exercise the actual generator without providers."""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore

from api.routers import evidence, notebooklm, portable

FIXTURES = Path(__file__).resolve().parents[1] / "contracts/v1/fixtures"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", json.loads((FIXTURES / "stream.json").read_text()))
async def test_exact_sse_wire(case, monkeypatch):
    store = MemoryStore()
    for kind in ("job", "turn"):
        for value in case.get(kind, []):
            await store.put(kind, value[kind + "_id"], value)
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(evidence.asyncio, "sleep", sleep)
    response = await evidence.turn_events("turn_synthetic")
    wire = "".join([part async for part in response.body_iterator])
    assert wire == case["wire"]
    assert len(sleeps) == case.get("sleeps", 0)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"


def test_transport_schema_has_no_fake_json_success():
    app = FastAPI()
    for router in (evidence.router, notebooklm.router, portable.router):
        app.include_router(router, prefix="/api")
    paths = app.openapi()["paths"]
    for suffix, media in {
        "turns/{turn_id}/events": {"text/event-stream"},
        "source-versions/{source_version_id}/download": {
            "application/pdf",
            "text/plain",
            "text/markdown",
        },
        "exports/{export_id}/download": {"application/zip"},
        "artifacts/{artifact_id}/download": {"*/*"},
    }.items():
        responses = paths["/api/personal/" + suffix]["get"]["responses"]
        assert set(responses["200"]["content"]) == media
        for mime, value in responses["200"]["content"].items():
            assert value["schema"]["type"] == "string"
            assert value["schema"].get("format") == (
                None if mime == "text/event-stream" else "binary"
            )
        assert "anyOf" in responses["422"]["content"]["application/json"]["schema"]
        assert "default" in responses
        assert "text/plain" in responses["default"]["content"]
        if media != {"text/event-stream"}:
            assert set(responses["206"]["content"]) == media | {"multipart/byteranges"}
            assert set(responses["400"]["content"]) == {
                "application/json",
                "text/plain",
            }
            assert "Content-Range" in responses["416"]["headers"]


@pytest.mark.asyncio
async def test_job_stages_repeat_and_transition_to_final(monkeypatch):
    store = MemoryStore()
    job = {"job_id": "job_synthetic", "turn_id": "turn_synthetic", "state": "running"}
    await store.put("job", job["job_id"], job)
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    calls = 0

    async def sleep(_):
        nonlocal calls
        calls += 1
        if calls == 2:
            await store.put(
                "turn",
                "turn_synthetic",
                {"turn_id": "turn_synthetic", "status": "succeeded", "answer": "done"},
            )

    monkeypatch.setattr(evidence.asyncio, "sleep", sleep)
    response = await evidence.turn_events("turn_synthetic")
    chunks = [part async for part in response.body_iterator]
    assert len(chunks) == 3
    assert chunks[0] == chunks[1]
    assert chunks[0].startswith("event: stage\n")
    assert chunks[2].startswith("event: final\n")
