"""Grounded acceptance collaboration using real file extraction and retrieval."""

import json

import pytest
from test_v1_model_acceptance_contract_unit import policy

from scripts.v1.model_acceptance_check import load_suite, run_acceptance


@pytest.mark.asyncio
async def test_real_grounded_service_public_fixtures_and_scope_switch(
    tmp_path, monkeypatch
):
    from test_v1_evidence_ingest import MemoryStore

    from api.evidence_service import EvidenceService
    from open_notebook.graphs.grounded_chat import GroundedChatService

    suite = load_suite()
    evidence = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    mapping = {}
    payloads = []
    for alias, content in suite["sources"].items():
        version = await evidence.ingest(
            "notebook:acceptance",
            "source:" + alias,
            alias,
            content.encode(),
            filename=f"{alias}.txt",
        )
        await evidence.extract(version["source_version_id"])
        mapping[alias] = version["source_version_id"]

    async def fake_model(messages):
        payload = json.loads(messages[-1]["content"])
        payloads.append(payload)
        hit = payload["evidence"][0]
        return {
            "answer": "Mock evidence echo, not a semantic answer. [c1]",
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": hit["evidence_id"],
                    "quote": hit["quote"],
                }
            ],
        }

    from workbench_scope_helpers import install_scope_database

    install_scope_database(monkeypatch, evidence.store, tmp_path, "notebook:acceptance")
    service = GroundedChatService(evidence_service=evidence, model=fake_model)
    report = await run_acceptance(service, mapping, **policy())
    assert report["status"] == "simulation_complete_review_pending"
    assert len(report["results"]) == 30
    assert all(row["scope_matches"] for row in report["results"])
    assert all(row["invalid_citations"] == 0 for row in report["results"])
    assert all(row["semantic_review"] == "pending" for row in report["results"])
    switched = [p for p in payloads if p["question"].startswith("仅根据当前B版")]
    assert len(switched) == 4
    assert all(p["previous_questions"] == [] for p in switched)
    assert all(
        {e["source_version_id"] for e in p["evidence"]} == {mapping["b"]}
        for p in switched
    )
