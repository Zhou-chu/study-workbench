"""Shared actual route JSON consumed unchanged by the frontend transport tests."""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from test_workbench_hybrid_contracts import h as _h_fixture

from api.routers import evidence as routes
from open_notebook.ai.evidence_embeddings import EmbeddingOutcomeUnknown

h = _h_fixture
FIXTURE = Path("contracts/v1/fixtures/hybrid-search.json")


@pytest.mark.asyncio
async def test_actual_serialized_search_envelopes(h, monkeypatch):
    monkeypatch.setattr(routes, "EvidenceService", lambda: h.evidence)
    app = FastAPI()
    app.include_router(routes.router)
    profile = h.provider.profile
    body = dict(
        query="Solar",
        notebook_id="notebook:allowed",
        source_version_ids=["v1"],
        retrieval_mode="hybrid",
        embedding_profile_id=profile.profile_id,
        disclosed_profile_fingerprint=profile.fingerprint,
        destination_descriptor_version=profile.destination_descriptor_version,
        acknowledge_query_processing=True,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://offline.test"
    ) as client:

        async def search(value):
            response = await client.post("/personal/search", json=value)
            assert response.status_code == 200
            return response.json()

        cases = {"hybrid": await search(body)}
        h.provider.error = EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")
        cases["unknown"] = await search(body)
        cases["empty_unknown"] = await search({**body, "query": "unrelated-no-match"})
        h.provider.error = None
        h.db.manifests = []
        cases["not_ready"] = await search(body)
        cases["lexical"] = await search(
            dict(
                query="Solar",
                notebook_id="notebook:allowed",
                source_version_ids=["v1"],
                retrieval_mode="lexical",
            )
        )
        cases["legacy"] = await search(dict(query="Solar", source_version_ids=["v1"]))
    assert cases["hybrid"]["retrieval"]["retrieval_method"] == "hybrid"
    assert cases["unknown"]["retrieval"]["warnings"] == ["EMBEDDING_OUTCOME_UNKNOWN"]
    assert cases["empty_unknown"]["hits"] == []
    assert set(cases["legacy"]) == {"hits"}
    assert cases == json.loads(FIXTURE.read_text())
