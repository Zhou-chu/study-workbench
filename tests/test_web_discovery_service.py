"""Durable web import behavior with in-memory persistence and no network."""

from unittest.mock import AsyncMock

import pytest
from test_v1_evidence_ingest import MemoryStore

from api.web_discovery_contracts import WebImportRequest
from api.web_discovery_service import WebDiscoveryService
from open_notebook.exceptions import ExternalServiceError, InvalidInputError


@pytest.fixture
def service(tmp_path):
    store = MemoryStore()
    provider = AsyncMock()
    provider.scrape.return_value = "# Retrieved article\n\nUseful evidence."
    evidence = AsyncMock()

    async def ingest(notebook_id, source_id, title, data, **kwargs):
        version = {
            "source_version_id": kwargs["source_version_id"],
            "notebook_id": notebook_id,
            "source_id": source_id,
            "provenance": kwargs["provenance"],
            "origin": kwargs["origin"],
            "original_status": kwargs["original_status"],
        }
        await store.put("version", version["source_version_id"], version)
        return version

    evidence.ingest.side_effect = ingest
    value = WebDiscoveryService(
        store=store,
        provider=provider,
        evidence=evidence,
        submit=AsyncMock(return_value="command:web"),
        ensure_source=AsyncMock(),
        source_available=AsyncMock(return_value=True),
        validate=AsyncMock(),
        data_root=tmp_path,
    )
    return value


def request(**changes):
    return WebImportRequest(
        **(
            {
                "url": "https://example.com/article",
                "title": "Article",
                "snippet": "Search snippet",
                "idempotency_key": "once",
            }
            | changes
        )
    )


@pytest.mark.asyncio
async def test_import_replay_has_one_provider_call_source_version_and_job(service):
    first = await service.import_source("notebook:a", request())
    second = await service.import_source("notebook:a", request())
    assert first == second
    assert first.state == "queued"
    assert service.provider.scrape.await_count == 1
    assert service.evidence.ingest.await_count == 1
    assert service.submit.await_count == 1
    version = await service.store.get("version", first.source_version_id)
    assert version["origin"] == "web_snapshot"
    assert version["original_status"] == "missing"
    assert version["provenance"]["source_url"] == "https://example.com/article"
    assert "query" not in version["provenance"]
    data = service.evidence.ingest.await_args.args[3]
    assert b"https://example.com/article" in data


@pytest.mark.asyncio
async def test_same_key_different_url_or_metadata_is_rejected(service):
    await service.import_source("notebook:a", request())
    for changes in ({"url": "https://example.com/other"}, {"title": "Other"}):
        with pytest.raises(InvalidInputError, match="WEB_IDEMPOTENCY_CONFLICT"):
            await service.import_source("notebook:a", request(**changes))
    assert service.provider.scrape.await_count == 1


@pytest.mark.asyncio
async def test_url_dedupe_is_notebook_scoped(service):
    first = await service.import_source("notebook:a", request())
    duplicate = await service.import_source(
        "notebook:a",
        request(idempotency_key="different", url="https://EXAMPLE.com/article#part"),
    )
    assert duplicate.state == "already_imported"
    assert duplicate.source_version_id == first.source_version_id
    assert service.provider.scrape.await_count == 1
    await service.import_source("notebook:b", request())
    assert service.provider.scrape.await_count == 2


@pytest.mark.asyncio
async def test_failed_paid_call_not_automatically_replayed(service):
    service.provider.scrape.side_effect = ExternalServiceError("WEB_PROVIDER_ERROR")
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        await service.import_source("notebook:a", request())
    for key in ["once", "new-browser-key"]:
        with pytest.raises(InvalidInputError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
            await service.import_source("notebook:a", request(idempotency_key=key))
    assert service.provider.scrape.await_count == 1
    assert service.evidence.ingest.await_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("retry_key", ["once", "new-browser-key"])
async def test_worker_failure_preserves_snapshot_and_reports_not_queued(
    service, retry_key
):
    service.submit.side_effect = RuntimeError("private worker internals")
    response = await service.import_source("notebook:a", request())
    assert response.state == "saved"
    assert response.warning == "WEB_EXTRACTION_NOT_QUEUED"
    assert await service.store.get("version", response.source_version_id)
    assert "private" not in str(response)
    service.submit.side_effect = None
    restored = await service.import_source(
        "notebook:a", request(idempotency_key=retry_key)
    )
    assert restored.state == "queued"
    assert service.provider.scrape.await_count == 1
    assert service.submit.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("retry_key", ["once", "other"])
async def test_inflight_dedupe_does_not_double_charge(service, retry_key):
    import asyncio

    started = asyncio.Event()
    release = asyncio.Event()

    async def scrape(url):
        started.set()
        await release.wait()
        return "Snapshot"

    service.provider.scrape.side_effect = scrape
    first = asyncio.create_task(service.import_source("notebook:a", request()))
    await started.wait()
    with pytest.raises(InvalidInputError, match="WEB_IMPORT_IN_PROGRESS"):
        await service.import_source("notebook:a", request(idempotency_key=retry_key))
    release.set()
    await first
    assert service.provider.scrape.await_count == 1


@pytest.mark.asyncio
async def test_version_commit_ack_loss_recovers_from_disk_without_paid_refetch(service):
    real_put = service.store.put
    lost = False

    async def put(kind, identity, value, **kwargs):
        nonlocal lost
        result = await real_put(kind, identity, value, **kwargs)
        if kind == "version" and not lost:
            lost = True
            raise RuntimeError("Acknowledgement lost after commit")
        return result

    # Keep deterministic IDs in this test to model the real ingest contract.
    async def ingest(notebook_id, source_id, title, data, **kwargs):
        version = {
            "source_version_id": kwargs["source_version_id"],
            "source_id": source_id,
            "notebook_id": notebook_id,
        }
        await service.store.put("version", version["source_version_id"], version)
        return version

    service.evidence.ingest.side_effect = ingest
    service.store.put = put
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        await service.import_source("notebook:a", request())
    # New service instance simulates loss of process memory, retaining DB/files.
    recovered = WebDiscoveryService(
        store=service.store,
        provider=service.provider,
        evidence=service.evidence,
        submit=service.submit,
        ensure_source=service.ensure_source,
        source_available=service.source_available,
        validate=service.validate,
        data_root=service.data_root,
    )
    result = await recovered.import_source("notebook:a", request())
    assert result.state == "queued"
    assert service.provider.scrape.await_count == 1
    assert service.evidence.ingest.await_count == 1
    service.evidence.resolve_file.assert_awaited_once()


@pytest.mark.asyncio
async def test_browser_restart_new_key_can_finish_checkpoint_without_rescraping(
    service,
):
    service.ensure_source.side_effect = RuntimeError("Local write acknowledgement lost")
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        await service.import_source("notebook:a", request())
    service.ensure_source.side_effect = None
    result = await service.import_source(
        "notebook:a", request(idempotency_key="after-browser-restart")
    )
    assert result.state == "queued"
    assert service.provider.scrape.await_count == 1


@pytest.mark.asyncio
async def test_dispatch_ack_loss_does_not_contact_provider(service):
    real_put = service.store.put

    async def put(kind, identity, value, **kwargs):
        result = await real_put(kind, identity, value, **kwargs)
        if identity.startswith("web-url:"):
            raise RuntimeError("Acknowledgement lost")
        return result

    service.store.put = put
    with pytest.raises(RuntimeError):
        await service.import_source("notebook:a", request())
    service.store.put = real_put
    with pytest.raises(InvalidInputError, match="WEB_IMPORT_IN_PROGRESS"):
        await service.import_source("notebook:a", request())
    assert service.provider.scrape.await_count == 0


@pytest.mark.asyncio
async def test_native_source_creation_uses_explicit_create_not_update(monkeypatch):
    from api.web_discovery_service import _ensure_native_source
    from open_notebook.exceptions import NotFoundError

    query = AsyncMock(return_value=[])
    relate = AsyncMock()
    monkeypatch.setattr("open_notebook.domain.notebook.Notebook.get", AsyncMock())
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Source.get",
        AsyncMock(side_effect=NotFoundError("absent")),
    )
    monkeypatch.setattr("open_notebook.database.repository.repo_query", query)
    monkeypatch.setattr("open_notebook.database.repository.repo_relate", relate)
    await _ensure_native_source(
        "notebook:a", "source:web_test", "Title", "https://example.com/"
    )
    assert query.await_args_list[0].args[0].startswith("CREATE $source")
    relate.assert_awaited_once()


@pytest.mark.asyncio
async def test_receipts_have_portable_identities_in_every_state(service):
    from api.portable_service import _identity

    await service.import_source("notebook:a", request())
    for value in await service.store.list("import_report"):
        assert _identity("import_report", value)


def test_checkpoint_symlinks_and_invalid_schema_are_rejected(service, tmp_path):
    path = service._snapshot_path("checkpoint")
    path.parent.mkdir(parents=True)
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    path.symlink_to(outside)
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        service._read_checkpoint("checkpoint", "https://example.com")
    path.unlink()
    path.write_text('{"url":"https://example.com", "content":42}')
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        service._read_checkpoint("checkpoint", "https://example.com")


def test_control_character_checkpoint_round_trips_with_bounded_json(service):
    from api.web_discovery_service import _digest

    content = "\x01" * (1024 * 1024)
    checkpoint = {
        "url": "https://example.com/",
        "content": content,
        "sha256": _digest(content),
        "retrieved_at": "2026-10-22T00:00:00+00:00",
        "title": "Title",
        "snippet": "",
    }
    service._write_checkpoint("checkpoint", checkpoint)
    assert service._read_checkpoint("checkpoint", checkpoint["url"]) == checkpoint


def test_checkpoint_rejects_symlink_directory_before_any_write(service, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (service.data_root / "web-imports").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        service._write_checkpoint("checkpoint", {})
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        service._read_checkpoint("checkpoint", "https://example.com/")
    assert list(outside.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "oversized", "empty"])
async def test_ambiguous_paid_outcomes_block_new_key_refetch(service, failure):
    from open_notebook.exceptions import NetworkError

    service.provider.scrape.side_effect = {
        "timeout": NetworkError("WEB_PROVIDER_TIMEOUT"),
        "oversized": InvalidInputError("WEB_RESPONSE_TOO_LARGE"),
        "empty": InvalidInputError("WEB_EMPTY_CONTENT"),
    }[failure]
    with pytest.raises(ExternalServiceError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
        await service.import_source("notebook:a", request())
    for key in ["once", "new-deliberate-attempt"]:
        with pytest.raises(InvalidInputError, match="WEB_IMPORT_OUTCOME_UNKNOWN"):
            await service.import_source("notebook:a", request(idempotency_key=key))
    assert service.provider.scrape.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["native_source_or_relation", "version"])
async def test_cached_receipts_never_recreate_deleted_sources(service, missing):
    first = await service.import_source("notebook:a", request())
    if missing == "version":
        await service.store.delete("version", first.source_version_id)
    else:
        service.source_available.return_value = False
    for key in ["once", "another"]:
        with pytest.raises(InvalidInputError, match="WEB_IMPORTED_SOURCE_UNAVAILABLE"):
            await service.import_source("notebook:a", request(idempotency_key=key))
    assert service.provider.scrape.await_count == 1
    assert service.ensure_source.await_count == 1
    assert service.evidence.ingest.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["succeeded", "cancelled_local", "running"])
async def test_worker_ack_loss_preserves_fresher_job_state(service, state):
    async def submit(operation, payload):
        job = await service.store.get("job", payload["job_id"])
        await service.store.put(
            "job",
            payload["job_id"],
            job | {"state": state, "result": {"worker_result": True}},
        )
        raise RuntimeError("worker submission acknowledgement lost")

    service.submit.side_effect = submit
    first = await service.import_source("notebook:a", request())
    job = await service.store.get("job", first.job_id)
    assert job["state"] == state
    assert job["result"] == {"worker_result": True}
    await service.import_source("notebook:a", request())
    assert service.submit.await_count == 1
    assert service.provider.scrape.await_count == 1


@pytest.mark.asyncio
async def test_known_quota_rejection_requires_explicit_new_key(service):
    from open_notebook.exceptions import RateLimitError

    service.provider.scrape.side_effect = RateLimitError("WEB_PROVIDER_RATE_LIMIT")
    for _ in range(2):
        with pytest.raises(RateLimitError):
            await service.import_source("notebook:a", request())
    service.provider.scrape.side_effect = None
    await service.import_source("notebook:a", request(idempotency_key="explicit-retry"))
    assert service.provider.scrape.await_count == 2


@pytest.mark.asyncio
async def test_real_evidence_pipeline_retains_web_provenance_and_model_free_extract(
    service,
):
    from api.evidence_service import EvidenceService

    service.evidence = EvidenceService(store=service.store, data_root=service.data_root)
    result = await service.import_source("notebook:a", request())
    extraction = await service.evidence.extract(result.source_version_id)
    assert extraction["status"] == "ready"
    records = await service.evidence.list_evidence(result.source_version_id)
    assert records and all(
        row["evidence_kind"] == "remote_text_snapshot" for row in records
    )
    version = await service.evidence.version(result.source_version_id)
    assert version["origin"] == "web_snapshot"
    assert version["provenance"]["source_url"] == request().url
    duplicate = await service.import_source("notebook:a", request())
    assert duplicate.source_version_id == result.source_version_id
    assert service.provider.scrape.await_count == 1
