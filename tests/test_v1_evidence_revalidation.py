"""Revalidate archive claims using independently parsed original bytes, not archive text."""

import hashlib

import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from open_notebook.exceptions import InvalidInputError


async def archive(service, data=b"Original evidence.\n\nSecond paragraph."):
    version = await service.ingest(
        "nb", "source:one", "Original", data, filename="a.txt"
    )
    extraction = await service.extract(version["source_version_id"])
    extraction["verification_origin"] = "restored_archive"
    await service.store.put("extraction", extraction["extraction_id"], extraction)
    for record in await service.list_evidence(version["source_version_id"]):
        record["verification_origin"] = "restored_archive"
        await service.store.put("evidence", record["evidence_id"], record)
    return version, extraction


@pytest.mark.asyncio
async def test_revalidate_preserves_historical_evidence_and_checks_fresh_original(
    tmp_path,
):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service)
    before = await service.list_evidence(version["source_version_id"])
    report = await service.revalidate(
        version["source_version_id"], old["extraction_id"], "ex_fresh"
    )
    assert report["verified_count"] == len(before) == 2
    assert report["unverified_count"] == 0
    assert report["fresh_extraction_id"] == "ex_fresh"
    assert (
        await service.list_evidence(version["source_version_id"], old["extraction_id"])
        == before
    )
    checked = await service.validate_citation(
        {"evidence_id": before[0]["evidence_id"], "quote": "evidence"},
        [version["source_version_id"]],
    )
    assert checked["reference_validity"] == "verified"
    assert checked["locator"]["start_offset"] == 9
    assert checked["evidence_id"] == before[0]["evidence_id"]
    assert (await service.version(version["source_version_id"]))[
        "current_extraction_id"
    ] == "ex_fresh"


@pytest.mark.asyncio
async def test_self_consistent_forged_archive_remains_unverified_after_revalidation(
    tmp_path,
):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service, b"Original evidence.")
    record = (await service.list_evidence(version["source_version_id"]))[0]
    record["quote"] = "Invented evidence."
    record["quote_hash"] = hashlib.sha256(record["quote"].encode()).hexdigest()
    old["blocks"][0]["text"] = record["quote"]
    record["locator"]["end_offset"] = len(record["quote"])
    await service.store.put("extraction", old["extraction_id"], old)
    await service.store.put("evidence", record["evidence_id"], record)
    report = await service.revalidate(
        version["source_version_id"], old["extraction_id"], "ex_fresh"
    )
    assert report["verified_count"] == 0
    assert report["unverified_count"] == 1
    checked = await service.validate_citation(
        {"evidence_id": record["evidence_id"]}, [version["source_version_id"]]
    )
    assert checked["reference_validity"] == "unverified"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    ["restored_fresh", "wrong_page", "wrong_bbox", "wrong_label", "wrong_version"],
)
async def test_revalidation_certificate_cannot_bypass_fresh_locator_checks(
    tmp_path, change
):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service)
    await service.revalidate(
        version["source_version_id"], old["extraction_id"], "ex_fresh"
    )
    record = (
        await service.list_evidence(version["source_version_id"], old["extraction_id"])
    )[0]
    fresh = await service.store.get("extraction", "ex_fresh")
    if change == "restored_fresh":
        fresh["verification_origin"] = "restored_archive"
    elif change == "wrong_version":
        fresh["source_version_id"] = "another"
    elif change == "wrong_page":
        record["locator"]["page_index"] = 99
    elif change == "wrong_bbox":
        record["locator"]["bbox"] = [1, 2, 3, 4]
    else:
        record["locator"]["page_label"] = "999"
    await service.store.put("extraction", "ex_fresh", fresh)
    await service.store.put("evidence", record["evidence_id"], record)
    checked = await service.validate_citation(
        {"evidence_id": record["evidence_id"]}, [version["source_version_id"]]
    )
    assert checked["reference_validity"] != "verified"


@pytest.mark.asyncio
async def test_revalidation_rejects_missing_original_and_wrong_extraction(tmp_path):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service)
    other, other_ex = await archive(service)
    with pytest.raises(InvalidInputError, match="EXTRACTION_VERSION_MISMATCH"):
        await service.revalidate(
            version["source_version_id"], other_ex["extraction_id"], "ex_fresh"
        )
    version["original_status"] = "missing"
    await service.store.put("version", version["source_version_id"], version)
    with pytest.raises(InvalidInputError, match="ORIGINAL_UNAVAILABLE"):
        await service.revalidate(
            version["source_version_id"], old["extraction_id"], "ex_fresh"
        )


@pytest.mark.asyncio
async def test_reparse_failure_retains_prior_readable_extraction(tmp_path):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service)
    path = await service.resolve_file(version["source_version_id"])
    path.write_bytes(b"tampered")
    with pytest.raises(InvalidInputError, match="integrity"):
        await service.extract(version["source_version_id"], extraction_id="ex_retry")
    current = await service.version(version["source_version_id"])
    assert current["current_extraction_id"] == old["extraction_id"]
    assert current["status"] == "ready"
    assert (await service.store.get("extraction", "ex_retry"))["status"] == "failed"


@pytest.mark.asyncio
async def test_recovered_failed_reparse_restores_durable_previous_status(tmp_path):
    service = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(service)
    current = await service._version(version["source_version_id"])
    current["status"] = "extracting"
    await service.store.put("version", version["source_version_id"], current)
    interrupted = {**old, "extraction_id": "ex_interrupted", "status": "running"}
    await service.store.put("extraction", "ex_interrupted", interrupted)
    path = await service.resolve_file(version["source_version_id"])
    path.write_bytes(b"broken")
    with pytest.raises(InvalidInputError):
        await service.extract(
            version["source_version_id"], extraction_id="ex_interrupted"
        )
    current = await service.version(version["source_version_id"])
    assert current["status"] == "ready"
    assert current["current_extraction_id"] == old["extraction_id"]
