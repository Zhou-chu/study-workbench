"""New stored failures are public-safe without rewriting retained evidence/history.

The real extraction, maintenance, read routes and HTTP serializers run against
owned files and a copy-on-read store. Only parser/DB/queue seams are synthetic.
"""

import asyncio

import pytest
from evidence_failure_boundary_fixtures import (
    EXTRACTION_ERROR,
    MAINTENANCE_ERROR,
    FaultStore,
    fail_parse_once,
    private_error,
)
from test_v1_evidence_revalidation import archive

from api.evidence_maintenance import EvidenceMaintenanceService
from api.evidence_service import EvidenceService


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
