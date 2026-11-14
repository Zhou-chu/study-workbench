"""New stored failures are public-safe without rewriting retained evidence/history.

The real extraction, maintenance, read routes and HTTP serializers run against
owned files and a copy-on-read store. Only parser/DB/queue seams are synthetic.
"""

import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from test_v1_evidence_ingest import MemoryStore
from test_v1_evidence_revalidation import archive

from api.evidence_maintenance import EvidenceMaintenanceService
from api.evidence_service import EvidenceService
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


@pytest.mark.asyncio
@pytest.mark.parametrize("length", [0, 2000], ids=["short", "long"])
@pytest.mark.parametrize("kind", ["unknown", "domain"])
async def test_direct_failure_is_fixed_in_store_and_public_detail_but_reraises_original(
    tmp_path, monkeypatch, length, kind
):
    evidence = EvidenceService(FaultStore(), tmp_path)
    version = await evidence.ingest(
        "nb", "src", "Original", b"Original.", filename="a.txt"
    )
    version_id = version["source_version_id"]
    path = await evidence.resolve_file(version_id)
    original_bytes = path.read_bytes()
    error, canaries = private_error(length, kind)
    cause = error.__cause__
    calls = fail_parse_once(monkeypatch, error)
    with pytest.raises(type(error)) as caught:
        await evidence.extract(version_id, extraction_id="ex_failed")
    assert caught.value is error
    assert caught.value.__cause__ is cause
    stored = await evidence.store.get("extraction", "ex_failed")
    assert stored["status"] == "failed"
    async with public_client(monkeypatch, evidence) as client:
        response = await client.get(f"/api/personal/source-versions/{version_id}")
    assert response.status_code == 200
    assert response.json()["extraction"]["error"] == EXTRACTION_ERROR
    assert stored["error"] == EXTRACTION_ERROR
    assert stored["completed_at"]
    assert_private_absent(stored, canaries)
    assert response.json()["extraction"] == stored
    assert response.json()["version"]["status"] == "failed"
    assert_private_absent(response.json(), canaries)
    writes = deepcopy(evidence.store.writes)
    assert await evidence.extract(version_id, extraction_id="ex_failed") == stored
    assert evidence.store.writes == writes
    assert len(calls) == 1
    assert (await evidence.extract(version_id, extraction_id="ex_explicit"))[
        "status"
    ] == "ready"
    assert len(calls) == 2
    assert path.read_bytes() == original_bytes


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["reparse", "revalidate"])
@pytest.mark.parametrize("seam", ["parser", "database"])
@pytest.mark.parametrize("length", [0, 2000], ids=["short", "long"])
@pytest.mark.parametrize("kind", ["unknown", "domain"])
async def test_maintenance_failure_is_fixed_in_store_and_public_reads_without_losing_history(
    tmp_path, monkeypatch, operation, seam, length, kind
):
    store = FaultStore()
    evidence = EvidenceService(store, tmp_path)
    version, old = await archive(evidence)
    version_id = version["source_version_id"]
    original = await evidence.resolve_file(version_id)
    original_bytes = original.read_bytes()
    historical_evidence = await evidence.list_evidence(version_id)
    queue = []

    async def enqueue(command, args):
        queue.append((command, args))
        return "command:synthetic"

    service = EvidenceMaintenanceService(evidence, enqueue)
    async with public_client(monkeypatch, evidence, service) as client:
        before = await client.get(f"/api/personal/source-versions/{version_id}")
        error, canaries = private_error(length, kind)
        if seam == "parser":
            fail_parse_once(monkeypatch, error)
        else:
            # Blocks and all evidence writes precede this one-shot DB failure.
            store.faults[("extraction", "ready")] = error
        job = await service.submit(version_id, operation, "once", old["extraction_id"])
        result = await service.run(job["job_id"])
        fresh_id = job["fresh_extraction_id"]
        stored = await store.get("extraction", fresh_id)
        job_response = await client.get(f"/api/personal/jobs/{job['job_id']}")
        detail = await client.get(
            f"/api/personal/source-versions/{version_id}",
            params={"extraction_id": fresh_id},
        )
        assert job_response.status_code == detail.status_code == 200
        assert job_response.json()["error"] == MAINTENANCE_ERROR
        assert detail.json()["extraction"]["error"] == EXTRACTION_ERROR
        assert stored["status"] == "failed"
        assert stored["error"] == EXTRACTION_ERROR
        assert result["error"] == MAINTENANCE_ERROR
        assert result["state"] == "failed"
        assert result["attempts"] == 1
        assert result["completed_at"] and stored["completed_at"]
        assert await store.get("job", job["job_id"]) == result
        assert_private_absent({"job": result, "extraction": stored}, canaries)
        assert job_response.json() == result
        assert detail.json()["extraction"] == stored
        assert_private_absent([job_response.json(), detail.json()], canaries)
        after = await client.get(f"/api/personal/source-versions/{version_id}")
        assert after.status_code == before.status_code == 200
        assert after.json() == before.json()
        if seam == "database":
            assert stored["blocks"] == old["blocks"]
            assert len(stored["evidence_ids"]) == 2
            for identity in stored["evidence_ids"]:
                assert (await store.get("evidence", identity))[
                    "extraction_id"
                ] == fresh_id
        assert await store.get("extraction", old["extraction_id"]) == old
        assert await evidence.list_evidence(version_id) == historical_evidence
        assert original.read_bytes() == original_bytes
        writes = deepcopy(store.writes)
        assert await service.run(job["job_id"]) == result
        assert await service.dispatch(job["job_id"]) == result
        assert (
            await service.submit(version_id, operation, "once", old["extraction_id"])
            == result
        )
        assert store.writes == writes
        assert len(queue) == 1
        new = await service.submit(
            version_id, operation, "explicit-new", old["extraction_id"]
        )
        assert new["job_id"] != job["job_id"]
        assert new["fresh_extraction_id"] != fresh_id
        assert (await service.run(new["job_id"]))["state"] == "succeeded"
        assert len(queue) == 2


@pytest.mark.asyncio
async def test_failed_extraction_error_write_propagates_without_claiming_a_durable_failure(
    tmp_path, monkeypatch
):
    store = FaultStore()
    evidence = EvidenceService(store, tmp_path)
    version = await evidence.ingest(
        "nb", "src", "Original", b"Original.", filename="a.txt"
    )
    error, _ = private_error(0, "unknown")
    persistence_error = OSError("synthetic failure-record write failed")
    calls = fail_parse_once(monkeypatch, error)
    store.faults[("extraction", "failed")] = persistence_error
    with pytest.raises(OSError) as caught:
        await evidence.extract(version["source_version_id"], extraction_id="ex_failed")
    assert caught.value is persistence_error
    assert caught.value.__context__ is error
    assert len(calls) == 1
    stored = await store.get("extraction", "ex_failed")
    assert stored["status"] == "running"
    assert not stored.get("error")
    assert (await evidence._version(version["source_version_id"]))[
        "status"
    ] == "extracting"
    assert [state for kind, _, state in store.writes if kind == "extraction"] == [
        "running",
        "failed",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["reparse", "revalidate"])
@pytest.mark.parametrize("failed_write", ["extraction", "job"])
async def test_maintenance_failed_error_write_keeps_original_write_and_propagation_policy(
    tmp_path, monkeypatch, operation, failed_write
):
    store = FaultStore()
    evidence = EvidenceService(store, tmp_path)
    version, old = await archive(evidence)
    version_id = version["source_version_id"]
    error, _ = private_error(0, "unknown")
    persistence_error = OSError("synthetic failure-record write failed")
    calls = fail_parse_once(monkeypatch, error)

    async def enqueue(*_):
        return "command:synthetic"

    service = EvidenceMaintenanceService(evidence, enqueue)
    job = await service.submit(version_id, operation, "once", old["extraction_id"])
    store.writes.clear()
    store.faults[(failed_write, "failed")] = persistence_error
    if failed_write == "job":
        with pytest.raises(OSError) as caught:
            await service.run(job["job_id"])
        assert caught.value is persistence_error
    else:
        result = await service.run(job["job_id"])
        assert result["state"] == "failed"
        assert result["error"] == MAINTENANCE_ERROR
    assert len(calls) == 1
    stored_job = await store.get("job", job["job_id"])
    stored_extraction = await store.get("extraction", job["fresh_extraction_id"])
    if failed_write == "job":
        assert stored_job["state"] == "running" and not stored_job.get("error")
        assert stored_extraction["status"] == "failed"
        assert stored_extraction["error"] == EXTRACTION_ERROR
        assert (await evidence._version(version_id))["status"] == "ready"
    else:
        assert stored_extraction["status"] == "running"
        assert not stored_extraction.get("error")
        assert persistence_error.__context__ is error
        assert (await evidence._version(version_id))["status"] == "extracting"
    assert stored_job["attempts"] == 1
    assert await store.get("extraction", old["extraction_id"]) == old
    assert (
        sum(
            kind == failed_write and state == "failed"
            for kind, _, state in store.writes
        )
        == 1
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["direct", "reparse", "revalidate"])
async def test_cancellation_is_not_swallowed_or_relabelled_as_a_failed_record(
    tmp_path, monkeypatch, operation
):
    store = FaultStore()
    evidence = EvidenceService(store, tmp_path)
    version, old = await archive(evidence)
    version_id = version["source_version_id"]
    cancellation = asyncio.CancelledError("synthetic cancellation")
    calls = fail_parse_once(monkeypatch, cancellation)

    async def enqueue(*_):
        return "command:synthetic"

    if operation == "direct":
        fresh_id = "ex_cancelled"
        action = evidence.extract(version_id, extraction_id=fresh_id)
    else:
        service = EvidenceMaintenanceService(evidence, enqueue)
        job = await service.submit(version_id, operation, "once", old["extraction_id"])
        fresh_id = job["fresh_extraction_id"]
        action = service.run(job["job_id"])
    store.writes.clear()
    with pytest.raises(asyncio.CancelledError) as caught:
        await action
    assert caught.value is cancellation
    assert len(calls) == 1
    assert (await evidence._version(version_id))["status"] == "extracting"
    stored = await store.get("extraction", fresh_id)
    assert stored["status"] == "running" and not stored.get("error")
    if operation != "direct":
        stored_job = await store.get("job", job["job_id"])
        assert stored_job["state"] == "running"
        assert stored_job["attempts"] == 1 and not stored_job.get("error")
    assert not any(state == "failed" for _, _, state in store.writes)
    assert await store.get("extraction", old["extraction_id"]) == old


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["reparse", "revalidate"])
async def test_mid_evidence_write_failure_keeps_partial_data_and_prior_readable_version(
    tmp_path, monkeypatch, operation
):
    store = FaultStore()
    evidence = EvidenceService(store, tmp_path)
    version, old = await archive(evidence)
    version_id = version["source_version_id"]
    original = await evidence.resolve_file(version_id)
    original_bytes = original.read_bytes()
    error, canaries = private_error(2000, "unknown")
    put = store.put
    evidence_writes = 0

    async def fail_second_evidence(kind, identity, value, create_only=False):
        nonlocal evidence_writes
        if kind == "evidence":
            evidence_writes += 1
            if evidence_writes == 2:
                raise error
        return await put(kind, identity, value, create_only)

    async def enqueue(*_):
        return "command:synthetic"

    monkeypatch.setattr(store, "put", fail_second_evidence)
    service = EvidenceMaintenanceService(evidence, enqueue)
    job = await service.submit(version_id, operation, "once", old["extraction_id"])
    async with public_client(monkeypatch, evidence, service) as client:
        before = await client.get(f"/api/personal/source-versions/{version_id}")
        result = await service.run(job["job_id"])
        stored = await store.get("extraction", job["fresh_extraction_id"])
        assert result["error"] == MAINTENANCE_ERROR
        assert stored["error"] == EXTRACTION_ERROR
        assert stored["blocks"] == old["blocks"]
        assert len(stored["evidence_ids"]) == 2
        assert await store.get("evidence", stored["evidence_ids"][0]) is not None
        assert await store.get("evidence", stored["evidence_ids"][1]) is None
        assert_private_absent([result, stored], canaries)
        after = await client.get(f"/api/personal/source-versions/{version_id}")
        assert before.status_code == after.status_code == 200
        assert before.json() == after.json()
    assert await store.get("extraction", old["extraction_id"]) == old
    assert original.read_bytes() == original_bytes


@pytest.mark.asyncio
async def test_successful_reads_preserve_historical_diagnostics_without_rewriting_them(
    tmp_path, monkeypatch
):
    evidence = EvidenceService(FaultStore(), tmp_path)
    version, old = await archive(evidence)
    version_id = version["source_version_id"]
    historical = {
        **old,
        "extraction_id": "ex_historical",
        "status": "failed",
        "evidence_ids": [],
        "error": "synthetic historical extraction diagnostic",
    }
    await evidence.store.put("extraction", historical["extraction_id"], historical)

    async def enqueue(*_):
        return "command:synthetic"

    service = EvidenceMaintenanceService(evidence, enqueue)
    job = await service.submit(version_id, "reparse", "historical")
    job.update(
        state="failed",
        restored_history=True,
        replay_allowed=False,
        error={
            "code": "HistoricalType",
            "message": "synthetic historical job diagnostic",
        },
    )
    await evidence.store.put("job", job["job_id"], job)
    writes = deepcopy(evidence.store.writes)
    async with public_client(monkeypatch, evidence, service) as client:
        detail = await client.get(
            f"/api/personal/source-versions/{version_id}",
            params={"extraction_id": historical["extraction_id"]},
        )
        status = await client.get(f"/api/personal/jobs/{job['job_id']}")
    assert detail.status_code == status.status_code == 200
    assert detail.json()["extraction"] == historical
    assert status.json() == job
    assert evidence.store.writes == writes
    assert (
        await evidence.store.get("extraction", historical["extraction_id"])
        == historical
    )
    assert await evidence.store.get("job", job["job_id"]) == job
