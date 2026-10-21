import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from commands.evidence_commands import EvidenceExtractionInput, extract_evidence_command


@pytest.mark.asyncio
async def test_worker_command_extracts_and_can_be_replayed(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from open_notebook.domain.notebook import Source

    async def save():
        pass

    async def get(id):
        return SimpleNamespace(full_text=None, save=save)

    monkeypatch.setattr(Source, "get", get)
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "src", "queued", b"Worker evidence", filename="a.txt"
    )
    monkeypatch.setattr("commands.evidence_commands.EvidenceService", lambda: service)
    request = EvidenceExtractionInput(source_version_id=version["source_version_id"])
    first = await extract_evidence_command(request)
    again = await extract_evidence_command(request)
    assert first.success
    assert first.extraction_id == again.extraction_id
    assert first.evidence_count == 1


@pytest.mark.asyncio
async def test_worker_updates_durable_job_and_upstream_source_without_embedding(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from open_notebook.domain.notebook import Source

    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "source:one", "queued", b"Worker evidence", filename="a.txt"
    )
    await service.store.put(
        "job", "job_one", {"job_id": "job_one", "notebook_id": "nb", "state": "queued"}
    )
    saved = []
    source = SimpleNamespace(full_text=None)

    async def save():
        saved.append(source.full_text)

    source.save = save

    async def get(id):
        return source

    monkeypatch.setattr(Source, "get", get)
    monkeypatch.setattr("commands.evidence_commands.EvidenceService", lambda: service)
    result = await extract_evidence_command(
        EvidenceExtractionInput(
            source_version_id=version["source_version_id"], job_id="job_one"
        )
    )
    assert result.success
    assert saved == ["Worker evidence"]
    job = await service.store.get("job", "job_one")
    assert job["state"] == "succeeded"
    assert job["result"]["extraction_id"] == result.extraction_id


@pytest.mark.asyncio
async def test_late_old_version_job_does_not_replace_new_source_text(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from open_notebook.domain.notebook import Source

    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    old = await service.ingest("nb", "source:one", "old", b"Old text", filename="a.txt")
    new = await service.ingest("nb", "source:one", "new", b"New text", filename="a.txt")
    source = SimpleNamespace(full_text=None)

    async def save():
        pass

    source.save = save

    async def get(id):
        return source

    monkeypatch.setattr(Source, "get", get)
    monkeypatch.setattr("commands.evidence_commands.EvidenceService", lambda: service)
    await extract_evidence_command(
        EvidenceExtractionInput(source_version_id=new["source_version_id"])
    )
    await extract_evidence_command(
        EvidenceExtractionInput(source_version_id=old["source_version_id"])
    )
    assert source.full_text == "New text"


@pytest.mark.asyncio
async def test_cancelled_extraction_is_not_started(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock

    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest("nb", "source:x", "x", b"original", filename="x.txt")
    await service.store.put(
        "job",
        "job_cancel",
        {
            "job_id": "job_cancel",
            "notebook_id": "nb",
            "state": "cancelled_local",
            "cancel_requested": True,
        },
    )
    extract = AsyncMock()
    monkeypatch.setattr(service, "extract", extract)
    monkeypatch.setattr("commands.evidence_commands.EvidenceService", lambda: service)
    result = await extract_evidence_command(
        EvidenceExtractionInput(
            source_version_id=version["source_version_id"], job_id="job_cancel"
        )
    )
    assert result.status == "cancelled_local"
    extract.assert_not_awaited()
    assert (await service.store.get("job", "job_cancel"))["state"] == "cancelled_local"


@pytest.mark.asyncio
async def test_extraction_completion_preserves_late_worker_metadata(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from open_notebook.domain.notebook import Source

    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest("nb", "source:x", "x", b"original", filename="x.txt")
    await service.store.put(
        "job",
        "job_meta",
        {"job_id": "job_meta", "notebook_id": "nb", "state": "queued"},
    )
    original = service.extract

    async def extract(*a, **kw):
        result = await original(*a, **kw)
        current = await service.store.get("job", "job_meta")
        current["worker_job_id"] = "command:late"
        await service.store.put("job", "job_meta", current)
        return result

    monkeypatch.setattr(service, "extract", extract)
    monkeypatch.setattr(
        Source,
        "get",
        AsyncMock(return_value=SimpleNamespace(full_text="", save=AsyncMock())),
    )
    monkeypatch.setattr("commands.evidence_commands.EvidenceService", lambda: service)
    await extract_evidence_command(
        EvidenceExtractionInput(
            source_version_id=version["source_version_id"], job_id="job_meta"
        )
    )
    assert (await service.store.get("job", "job_meta"))[
        "worker_job_id"
    ] == "command:late"


@pytest.mark.asyncio
async def test_maintenance_worker_runs_durable_operation(tmp_path, monkeypatch):
    from api.evidence_maintenance import EvidenceMaintenanceService
    from commands.evidence_commands import (
        EvidenceMaintenanceInput,
        maintain_evidence_command,
    )

    service = EvidenceService(MemoryStore(), tmp_path)
    version = await service.ingest(
        "nb", "src", "Original", b"Worker reparse", filename="a.txt"
    )

    async def submit(*_):
        return "command:maintenance"

    maintenance = EvidenceMaintenanceService(evidence=service, submit=submit)
    job = await maintenance.submit(version["source_version_id"], "reparse", "once")
    monkeypatch.setattr(
        "commands.evidence_commands.EvidenceMaintenanceService", lambda: maintenance
    )
    result = await maintain_evidence_command(
        EvidenceMaintenanceInput(job_id=job["job_id"])
    )
    assert result.state == "succeeded"
    assert result.job_id == job["job_id"]
    assert len(await service.list_evidence(version["source_version_id"])) == 1
