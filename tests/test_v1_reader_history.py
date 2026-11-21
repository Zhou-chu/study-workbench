from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers.evidence import router


def test_reader_returns_citation_historical_extraction(monkeypatch):
    from types import SimpleNamespace

    import api.routers.evidence as module

    service = SimpleNamespace(
        version=AsyncMock(
            return_value={
                "source_version_id": "sv",
                "mime_type": "text/plain",
                "extraction": {"extraction_id": "ex_new"},
            }
        ),
        evidence=AsyncMock(
            return_value={
                "evidence_id": "ev_old",
                "source_version_id": "sv",
                "extraction_id": "ex_old",
            }
        ),
        list_evidence=AsyncMock(return_value=[]),
        store=SimpleNamespace(
            get=AsyncMock(
                return_value={
                    "extraction_id": "ex_old",
                    "source_version_id": "sv",
                    "blocks": [{"block_id": "old", "text": "old text"}],
                }
            )
        ),
    )
    monkeypatch.setattr(module, "EvidenceService", lambda: service)
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).get("/personal/source-versions/sv?evidence_id=ev_old")
    assert response.status_code == 200
    assert response.json()["extraction"]["extraction_id"] == "ex_old"
