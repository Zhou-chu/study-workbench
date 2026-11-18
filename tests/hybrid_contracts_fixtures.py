"""Real disposable indexing fixture with transport, provider and SQL seams doubled."""

import pytest_asyncio
from test_v1_evidence_ingest import MemoryStore
from test_workbench_hybrid_retrieval import NB, Harness

from api.routers import evidence as routes


def hybrid(h, **changes):
    return {
        "notebook_id": NB,
        "engine": "independent",
        "message": "quasar",
        "query": "quasar",
        "selection_origin": "local",
        "source_version_ids": ["v1"],
        "idempotency_key": "same",
        "retrieval_mode": "hybrid",
        "embedding_profile_id": h.provider.profile.profile_id,
        "acknowledge_query_processing": True,
        "disclosed_profile_fingerprint": h.provider.profile.fingerprint,
        "destination_descriptor_version": h.provider.profile.destination_descriptor_version,
        **changes,
    }


@pytest_asyncio.fixture
async def h(tmp_path, monkeypatch):
    value = Harness(tmp_path, monkeypatch)
    await value.add("v1", ["Solar electricity.", "Wind energy."])
    await value.index(["v1"])

    # Grounded history/jobs may list their own records; content listing stays forbidden.
    async def listing(kind, *args, **kwargs):
        assert kind in {"turn", "job"}
        return await MemoryStore.list(value.store, kind, *args, **kwargs)

    monkeypatch.setattr(value.store, "list", listing)
    monkeypatch.setattr(
        routes, "EvidenceRetrievalService", lambda: value.service, raising=False
    )
    return value
