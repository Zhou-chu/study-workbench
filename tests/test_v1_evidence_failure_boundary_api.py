"""Actual ASGI evidence failure envelopes against disposable on-disk evidence."""

from copy import deepcopy

import pytest
from evidence_failure_boundary_fixtures import (
    EXTRACTION_ERROR,
    MAINTENANCE_ERROR,
    FaultStore,
    assert_private_absent,
    fail_parse_once,
    private_error,
    public_client,
)
from test_v1_evidence_revalidation import archive

from api.evidence_maintenance import EvidenceMaintenanceService
from api.evidence_service import EvidenceService


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
