"""Direct malformed citation validation without evidence reads or parsing."""

import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService


@pytest.mark.asyncio
async def test_malformed_model_citation_is_invalid_without_throwing(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    citation = await service.validate_citation(
        {"evidence_id": {"forged": True}, "quote": ["not text"]}, ["sv_valid"]
    )
    assert citation["reference_validity"] == "invalid"
    assert citation["evidence_id"] is None
