"""Durable local maintenance with no model or remote operation."""

import asyncio

import pytest
from test_v1_evidence_ingest import MemoryStore
from test_v1_evidence_revalidation import archive

from api.evidence_service import EvidenceService
from open_notebook.exceptions import InvalidInputError


def maintenance(service, submit):
    from api.evidence_maintenance import EvidenceMaintenanceService

    return EvidenceMaintenanceService(evidence=service, submit=submit)


@pytest.mark.asyncio
async def test_revalidation_job_idempotency_worker_replay_and_reader_status(tmp_path):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)
    queue = []

    async def submit(command, args):
        queue.append((command, args))
        return "command:one"

    service = maintenance(evidence, submit)
    args = (version["source_version_id"], "revalidate", "once", old["extraction_id"])
    a, b = await asyncio.gather(service.submit(*args), service.submit(*args))
    assert a["job_id"] == b["job_id"]
    assert len(queue) == 1
    first = await service.run(a["job_id"])
    assert first["state"] == "succeeded"
    assert first["result"]["verified_count"] == 2
    count = len(await evidence.store.list("extraction"))
    again = await service.run(a["job_id"])
    assert again["result"] == first["result"]
    assert len(await evidence.store.list("extraction")) == count
    assert again["worker_job_id"] == "command:one"
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await service.submit(
            version["source_version_id"], "revalidate", "once", "ex_other"
        )


@pytest.mark.asyncio
async def test_reparse_creates_new_extraction_and_does_not_mutate_history(tmp_path):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)

    async def submit(*_):
        return "command:one"

    service = maintenance(evidence, submit)
    job = await service.submit(version["source_version_id"], "reparse", "once")
    result = await service.run(job["job_id"])
    assert result["state"] == "succeeded"
    assert result["result"]["extraction_id"] != old["extraction_id"]
    assert await evidence.store.get("extraction", old["extraction_id"]) == old
    assert (await evidence.version(version["source_version_id"]))["status"] == "ready"


@pytest.mark.asyncio
async def test_cancelled_job_never_parses_and_failed_queue_can_be_explicitly_retried(
    tmp_path,
):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)

    async def fail(*_):
        raise RuntimeError("worker unavailable")

    service = maintenance(evidence, fail)
    job = await service.submit(version["source_version_id"], "reparse", "once")
    assert job["state"] == "failed"
    assert job["error"]["code"] == "WORKER_UNAVAILABLE"

    async def submit(*_):
        return "command:two"

    service = maintenance(evidence, submit)
    job = await service.submit(version["source_version_id"], "reparse", "twice")
    job.update(state="cancelled_local", cancel_requested=True)
    await evidence.store.put("job", job["job_id"], job)
    assert (await service.run(job["job_id"]))["state"] == "cancelled_local"
    assert len(await evidence.store.list("extraction")) == 1


@pytest.mark.asyncio
async def test_failed_parse_records_failure_and_new_key_can_retry(tmp_path):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)
    original = await evidence.resolve_file(version["source_version_id"])
    data = original.read_bytes()
    original.write_bytes(b"bad")

    async def submit(*_):
        return "command:one"

    service = maintenance(evidence, submit)
    job = await service.submit(version["source_version_id"], "reparse", "once")
    result = await service.run(job["job_id"])
    assert result["state"] == "failed"
    assert "integrity" in result["error"]["message"]
    original.write_bytes(data)
    assert (await service.run(job["job_id"]))["state"] == "failed"
    new = await service.submit(version["source_version_id"], "reparse", "new-key")
    assert (await service.run(new["job_id"]))["state"] == "succeeded"


@pytest.mark.asyncio
async def test_poll_dispatch_resumes_stale_maintenance_with_same_job_and_extraction(
    tmp_path,
):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)
    queue = []

    async def submit(command, args):
        queue.append((command, args))
        return f"command:{len(queue)}"

    service = maintenance(evidence, submit)
    job = await service.submit(version["source_version_id"], "reparse", "once")
    assert len(queue) == 1
    await service.dispatch(job["job_id"])
    assert len(queue) == 1
    job = await evidence.store.get("job", job["job_id"])
    job.update(state="running", next_dispatch_at="2000-01-01T00:00:00+00:00")
    await evidence.store.put("job", job["job_id"], job)
    await asyncio.gather(
        service.dispatch(job["job_id"]), service.dispatch(job["job_id"])
    )
    assert len(queue) == 2
    assert queue[0] == queue[1]
    assert (await service.run(job["job_id"]))["state"] == "succeeded"
    await service.dispatch(job["job_id"])
    assert len(queue) == 2
    assert len(await evidence.store.list("extraction")) == 2


@pytest.mark.asyncio
async def test_maintenance_never_dispatches_or_executes_restored_history(tmp_path):
    evidence = EvidenceService(MemoryStore(), tmp_path)
    version, old = await archive(evidence)
    queue = []

    async def submit(*args):
        queue.append(args)
        return "command:x"

    service = maintenance(evidence, submit)
    job = await service.submit(version["source_version_id"], "reparse", "once")
    job.update(
        state="queued",
        restored_history=True,
        replay_allowed=False,
        next_dispatch_at="2000-01-01T00:00:00+00:00",
    )
    await evidence.store.put("job", job["job_id"], job)
    await service.dispatch(job["job_id"])
    result = await service.run(job["job_id"])
    assert result["state"] == "cancelled_local"
    assert len(queue) == 1
    assert len(await evidence.store.list("extraction")) == 1
