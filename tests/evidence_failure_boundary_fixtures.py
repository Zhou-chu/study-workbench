"""Synthetic evidence-store faults and ASGI HTTP fixture builders."""

import json
from types import SimpleNamespace

import httpx
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore

from open_notebook.exceptions import InvalidInputError

EXTRACTION_ERROR = "Source extraction could not be completed."
MAINTENANCE_ERROR = {
    "code": "EVIDENCE_MAINTENANCE_FAILED",
    "message": "Evidence maintenance could not be completed.",
}


def private_error(length, kind):
    """Both the first 500 characters and arbitrary type names are private data."""
    canaries = (
        "sk-synthetic-private-token",
        "/private/synthetic/document.txt",
        "SYNTHETIC_PRIVATE_DOCUMENT_CONTENT",
        "SyntheticPrivateExceptionName" + "X" * length,
    )
    error_type = (
        InvalidInputError if kind == "domain" else type(canaries[-1], (Exception,), {})
    )
    error = error_type(" | ".join(canaries[:3]) + "!" * length)
    error.__cause__ = RuntimeError("synthetic original cause")
    return error, canaries


class FaultStore(MemoryStore):
    """Fail a selected write once, before committing; later failure writes work."""

    def __init__(self):
        super().__init__()
        self.faults = {}
        self.writes = []

    async def put(self, kind, id, value, create_only=False):
        point = (kind, value.get("status", value.get("state")))
        self.writes.append((kind, id, point[1]))
        error = self.faults.pop(point, None)
        if error is not None:
            raise error
        return await super().put(kind, id, value, create_only)


def fail_parse_once(monkeypatch, error):
    import api.evidence_service as module

    original = module._bounded_parse
    calls = []

    def parse(*args):
        calls.append(args)
        if len(calls) == 1:
            raise error
        return original(*args)

    monkeypatch.setattr(module, "_bounded_parse", parse)
    return calls


def public_client(monkeypatch, evidence, maintenance=None):
    import api.evidence_maintenance as module
    from api.routers import evidence as evidence_routes
    from api.routers import notebooklm as job_routes

    monkeypatch.setattr(evidence_routes, "EvidenceService", lambda: evidence)
    if maintenance is not None:
        monkeypatch.setattr(module, "EvidenceMaintenanceService", lambda: maintenance)
    app = FastAPI()
    app.include_router(evidence_routes.router, prefix="/api")
    app.include_router(job_routes.router, prefix="/api")
    app.dependency_overrides[job_routes.get_notebooklm_service] = (
        lambda: SimpleNamespace(store=evidence.store)
    )
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def assert_private_absent(value, canaries):
    serialized = json.dumps(value)
    for canary in canaries:
        assert canary not in serialized
