"""Offline indexing contracts through real repository/ACK boundaries, not services."""

import asyncio
import hashlib
import importlib
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace

import pytest
from test_evidence_embedding_repository import FakeDatabase, profile
from v1_notebooklm_helpers import MemoryStore

from api.evidence_indexing import EvidenceIndexingService, IndexRequest
from open_notebook.ai.evidence_embeddings import EmbeddingOutcomeUnknown
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

NB = "notebook:allowed"
PRIVATE = "SYNTHETIC_PRIVATE_PROVIDER_BODY"


class IndexDatabase(FakeDatabase):
    def __init__(self, store):
        super().__init__()
        self.store = store
        self.quotes = {"ev1": "first exact paragraph", "ev2": "第二段原文"}
        self.fail_operation = None
        self.fail_ack = False
        self.commit_hook = None
        self.publish_fail = False

    async def query(self, sql, params=None):
        params = params or {}
        if "index-input-membership" in sql:
            self.calls.append((sql, deepcopy(params)))
            return [
                {"id": target, **deepcopy(self.extractions[eid])}
                for target, eid in zip(params["targets"], params["extraction_ids"])
            ]
        if "index-input-content" in sql:
            self.calls.append((sql, deepcopy(params)))
            return [
                {
                    "id": target,
                    "evidence_id": eid,
                    "version_id": vid,
                    "extraction_id": ext["extraction_id"],
                    "notebook_id": NB,
                    "quote": self.quotes[eid],
                    "quote_hash": hashlib.sha256(self.quotes[eid].encode()).hexdigest(),
                }
                for target, eid in zip(params["targets"], params["evidence_ids"])
                for vid in params["version_ids"]
                for ext in [
                    self.extractions[self.versions[vid]["current_extraction_id"]]
                ]
                if eid in ext["evidence_ids"]
            ]
        if "index-jobs-status" in sql:
            return [
                {"payload": deepcopy(row)}
                for (kind, _), row in self.store.rows.items()
                if kind == "job"
                and row.get("notebook_id") == params["notebook_id"]
                and row.get("operation") == "index_evidence"
                and row.get("source_version_id") in params["version_ids"]
            ]
        rows = await super().query(sql, params)
        if "canonical-evidence" in sql:
            for row in rows:
                row["quote_hash"] = hashlib.sha256(
                    self.quotes[row["evidence_id"]].encode()
                ).hexdigest()
        if "publication-rows" in sql:
            rows = [r for r in rows if r["attempt_id"] == params["attempt_id"]]
        if "index-manifests" in sql:
            rows = [
                r
                for r in rows
                if r["version_id"] in params["version_ids"]
                and r["namespace"] == params["namespace"]
            ]
        return rows

    async def query_raw(self, sql, params):
        if "index-job-commit" in sql:
            self.calls.append((sql, deepcopy(params)))
            if self.commit_hook:
                await self.commit_hook(params)
            code = None
            if params.get("dispatch_group_target"):
                group = next(
                    (
                        v
                        for (kind, _), v in self.store.rows.items()
                        if kind == "job"
                        and str(params["dispatch_group_target"])
                        == "v1_job:" + hashlib.sha256(v["job_id"].encode()).hexdigest()
                    ),
                    None,
                )
                if not group or group.get("dispatch_stopped"):
                    code = "ATTEMPT_CANCELLED"
            if params.get("entries") and any(
                self.epochs.get(e["version_id"], 0) != e["scope_epoch"]
                for e in params["entries"]
            ):
                code = "SCOPE_CHANGED"
            if "ATTEMPT_CANCELLED" in sql and self.attempts.get(
                params.get("attempt_id")
            ):
                code = "ATTEMPT_CANCELLED"
            if code:
                return {
                    "result": [
                        {"status": "ERR", "result": code},
                        {"status": "OK", "result": params["receipt"]},
                    ]
                }
            for write in params["job_writes"]:
                old = await self.store.get("job", write["identity"])
                expected = write["expected_revision"]
                if (expected is None and old is not None) or (
                    expected is not None
                    and (old is None or old.get("revision") != expected)
                ):
                    return {
                        "result": [
                            {"status": "ERR", "result": "INDEX_INTEGRITY"},
                            {"status": "OK", "result": params["receipt"]},
                        ]
                    }
            for write in params["job_writes"]:
                await self.store.put("job", write["identity"], write["value"])
            if self.fail_operation == params["receipt"]["operation"]:
                if self.fail_ack:
                    return {"result": [{"status": "OK", "result": params["receipt"]}]}
                raise RuntimeError(PRIVATE)
            return {"result": [{"status": "OK", "result": params["receipt"]}] * 2}
        if "vector-write" in sql:
            self.vectors.extend(deepcopy(params["rows"]))
        if "manifest-publish" in sql and self.publish_fail:
            raise RuntimeError(PRIVATE)
        if "manifest-publish" in sql:
            old = self.manifests
            result = await super().query_raw(sql, params)
            if not any(r["status"] == "ERR" for r in result["result"]):
                current_ids = {m["version_id"] for m in self.manifests}
                self.manifests.extend(
                    m for m in old if m["version_id"] not in current_ids
                )
            return result
        return await super().query_raw(sql, params)


class IndexProvider:
    def __init__(self):
        self.profile = profile()
        self.calls = []
        self.error = None
        self.on_call = None

    def resolve_profile(self, identity):
        assert identity == self.profile.profile_id
        return self.profile

    async def embed_documents(self, chosen, texts, *, dispatch_admission=None):
        if dispatch_admission is not None:
            await dispatch_admission()
        assert chosen == self.profile
        self.calls.append(list(texts))
        if self.on_call:
            await self.on_call()
        if self.error:
            raise self.error
        return [[1.0, 0.0] for _ in texts]


@pytest.fixture
def indexing(monkeypatch, tmp_path):
    module = importlib.import_module(
        "open_notebook.database.evidence_embedding_repository"
    )
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STUDY_WORKBENCH_HYBRID_ENABLED", "true")
    store = MemoryStore()
    db = IndexDatabase(store)
    monkeypatch.setattr(module, "repo_query", db.query)

    @asynccontextmanager
    async def connection():
        yield db

    monkeypatch.setattr(module, "db_connection", connection)
    provider = IndexProvider()
    queued = []

    async def enqueue(command, args):
        queued.append((command, deepcopy(args)))
        return "command:" + args["job_id"]

    service = EvidenceIndexingService(
        store=store,
        repository=module.EvidenceEmbeddingRepository(),
        embeddings=provider,
        submit=enqueue,
        profiles=lambda: {"chosen": provider.profile},
    )
    return SimpleNamespace(
        service=service, store=store, db=db, provider=provider, queued=queued
    )


async def request_for(f, ids=None, key="initial", **changes):
    preview = await f.service.preview(NB, ids or ["v1"], "chosen")
    return IndexRequest(
        source_version_ids=ids or ["v1"],
        profile_id="chosen",
        preview_hash=preview.preview_hash,
        acknowledge_external_processing=True,
        idempotency_key=key,
        **changes,
    )


@pytest.mark.asyncio
async def test_preview_and_status_do_not_embed_and_preview_counts_exact_utf8(indexing):
    f = indexing
    preview = await f.service.preview(NB, ["v2", "v1"], "chosen")
    assert preview.evidence_count == 2
    assert preview.input_bytes == sum(len(q.encode()) for q in f.db.quotes.values())
    assert preview.profile.fingerprint == f.provider.profile.fingerprint
    assert await f.service.status(NB, ["v1", "v2"])
    assert f.provider.calls == []
    assert f.queued == []


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["foreign", "not_ready", "missing", "unlinked"])
async def test_complete_scope_preflight_precedes_any_content_or_admission(
    indexing, invalid
):
    f = indexing
    if invalid == "foreign":
        f.db.versions["v2"]["notebook_id"] = "notebook:foreign"
    elif invalid == "not_ready":
        f.db.versions["v2"]["status"] = "extracting"
    elif invalid == "missing":
        del f.db.versions["v2"]
    else:
        f.db.members.remove("source:two")
    with pytest.raises(InvalidInputError):
        await f.service.preview(NB, ["v1", "v2"], "chosen")
    assert not any("index-input-content" in sql for sql, _ in f.db.calls)
    assert f.provider.calls == f.queued == []


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["quote", "extraction", "profile", "descriptor"])
async def test_changed_preview_or_disclosure_rejects_before_admission(indexing, change):
    f = indexing
    request = await request_for(f)
    if change == "quote":
        f.db.quotes["ev1"] += " changed"
    elif change == "extraction":
        f.db.versions["v1"]["current_extraction_id"] = "missing"
    else:
        f.provider.profile = f.provider.profile.model_copy(
            update={
                "endpoint"
                if change == "profile"
                else "destination_descriptor_version": "https://changed.example"
                if change == "profile"
                else "v2"
            }
        )
    with pytest.raises(
        InvalidInputError,
        match="EMBEDDING_DISCLOSURE_STALE"
        if change in ("profile", "descriptor")
        else "SCOPE_CHANGED|PREVIEW_CHANGED",
    ):
        await f.service.submit(NB, request)
    assert f.provider.calls == f.queued == []


@pytest.mark.asyncio
async def test_acknowledgment_required_and_same_key_is_immutable_receipt(indexing):
    f = indexing
    request = await request_for(f)
    with pytest.raises(InvalidInputError, match="ACKNOWLEDGMENT"):
        await f.service.submit(
            NB, request.model_copy(update={"acknowledge_external_processing": False})
        )
    receipt = await f.service.submit(NB, request)
    assert await f.service.submit(NB, request) == receipt
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await f.service.submit(
            NB,
            request.model_copy(update={"acknowledge_duplicate_embedding_cost": True}),
        )
    assert len(f.queued) == 1
    assert receipt.jobs[0].job_id == receipt.job_ids[0]
    assert receipt.group_id
    assert all(
        command == "index_evidence" and set(args) == {"job_id"}
        for command, args in f.queued
    )


@pytest.mark.asyncio
async def test_all_children_acknowledged_before_any_queue_admission(indexing):
    f = indexing
    request = await request_for(f, ["v1", "v2"])
    original = f.service.enqueue

    async def enqueue(command, args):
        group = next(
            v
            for v in f.store.rows.values()
            if v.get("operation") == "index_evidence_group"
        )
        assert len(group["job_ids"]) == 2
        assert all([await f.store.get("job", jid) for jid in group["job_ids"]])
        return await original(command, args)

    f.service.enqueue = enqueue
    receipt = await f.service.submit(NB, request)
    assert len(receipt.jobs) == 2
    assert len(f.queued) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("lost_ack", [False, True])
async def test_unknown_group_commit_never_dispatches_or_fills_children(
    indexing, lost_ack
):
    f = indexing
    request = await request_for(f, ["v1", "v2"])
    f.db.fail_operation = "index_admit"
    f.db.fail_ack = lost_ack
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.submit(NB, request)
    f.db.fail_operation = None
    receipt = await f.service.submit(NB, request)
    assert receipt.state == "submission_unknown"
    assert len(receipt.job_ids) == 2
    assert f.queued == []
    await f.store.delete("job", receipt.job_ids[1])
    reconciled = await f.service.reconcile(receipt.group_id)
    assert len(reconciled["jobs"]) == 2
    assert reconciled["jobs"][1]["state"] == "submission_unknown"
    assert reconciled["state"] != "succeeded"
    assert f.queued == []


@pytest.mark.asyncio
async def test_queue_unknown_keeps_every_child_and_never_reenqueues(indexing):
    f = indexing
    request = await request_for(f, ["v1", "v2"])
    calls = []

    async def enqueue(command, args):
        calls.append(args)
        raise TimeoutError(PRIVATE)

    f.service.enqueue = enqueue
    receipt = await f.service.submit(NB, request)
    assert receipt.state == "submission_unknown"
    assert len(receipt.jobs) == len(calls) == 2
    assert all(j.state == "submission_unknown" for j in receipt.jobs)
    assert await f.service.submit(NB, request) == receipt
    await f.service.status(NB, ["v1", "v2"])
    assert len(calls) == 2
    assert PRIVATE not in str(receipt)


@pytest.mark.asyncio
async def test_cancel_rebuild_preserves_scope_epoch_and_last_good_manifest(indexing):
    f = indexing
    first = await f.service.submit(NB, await request_for(f))
    assert (await f.service.run(first.job_ids[0]))["state"] == "succeeded"
    old = deepcopy(f.db.manifests)
    epoch = deepcopy(f.db.epochs)
    rebuild = await f.service.submit(NB, await request_for(f, key="rebuild"))
    cancelled = await f.service.cancel(rebuild.job_ids[0])
    assert cancelled["state"] == "cancelled_local"
    assert cancelled["remote_cancel_confirmed"] is False
    assert await f.service.run(rebuild.job_ids[0]) == cancelled
    assert f.db.epochs == epoch
    assert f.db.manifests == old
    status = await f.service.status(NB, ["v1"])
    assert status["profiles"][0]["index"]["state"] == "ready"
    assert (
        status["profiles"][0]["index"]["manifests"][0]["attempt_id"] == first.job_ids[0]
    )


def add_many(f, count=18):
    f.db.extractions["ex1"]["evidence_ids"] = [f"many{i}" for i in range(count)]
    f.db.quotes.update({f"many{i}": f"exact text {i}" for i in range(count)})


@pytest.mark.asyncio
async def test_explicit_retry_rebuilds_all_batches_with_duplicate_cost_ack(indexing):
    f = indexing
    add_many(f)
    first = await f.service.submit(NB, await request_for(f))

    async def cancel_during_first_batch():
        f.provider.on_call = None
        await f.service.cancel(first.job_ids[0])

    f.provider.on_call = cancel_during_first_batch
    cancelled = await f.service.run(first.job_ids[0])
    assert cancelled["state"] == "cancelled_local"
    assert cancelled["completed_evidence"] == 0
    assert len(f.provider.calls) == 1
    retry = await request_for(
        f,
        key="retry",
        retry_of_job_id=first.job_ids[0],
        acknowledge_duplicate_embedding_cost=True,
    )
    result = await f.service.submit(NB, retry)
    assert result.job_ids != first.job_ids
    assert (await f.service.run(result.job_ids[0]))["state"] == "succeeded"
    assert list(map(len, f.provider.calls)) == [16, 16, 2]
    assert f.db.attempts[first.job_ids[0]] is True
    assert (await f.store.get("job", first.job_ids[0]))["state"] == "cancelled_local"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reason",
    [
        "no_ack",
        "same_key",
        "wrong_notebook",
        "wrong_profile",
        "wrong_version",
        "not_failed",
        "flag_alone",
    ],
)
async def test_retry_requires_exact_prior_attempt_and_new_explicit_intent(
    indexing, reason
):
    f = indexing
    original = await f.service.submit(NB, await request_for(f))
    await f.service.cancel(original.job_ids[0])
    old = await f.store.get("job", original.job_ids[0])
    if reason.startswith("wrong_") or reason == "not_failed":
        field, value = {
            "wrong_notebook": ("notebook_id", "other"),
            "wrong_profile": ("profile_id", "other"),
            "wrong_version": ("source_version_id", "v2"),
            "not_failed": ("state", "succeeded"),
        }[reason]
        old[field] = value
        await f.store.put("job", old["job_id"], old)
    changes = {
        "retry_of_job_id": original.job_ids[0],
        "acknowledge_duplicate_embedding_cost": True,
    }
    if reason == "no_ack":
        changes["acknowledge_duplicate_embedding_cost"] = False
    if reason == "flag_alone":
        changes["retry_of_job_id"] = None
    request = await request_for(
        f, key="initial" if reason == "same_key" else "retry", **changes
    )
    with pytest.raises(InvalidInputError):
        await f.service.submit(NB, request)
    assert len(f.queued) == 1
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_restart_after_dispatch_started_never_replays(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    job = await f.store.get("job", receipt.job_ids[0])
    job.update(state="running", dispatch_started=True, stage="embedding", attempts=1)
    await f.store.put("job", job["job_id"], job)
    restarted = await f.service.run(job["job_id"])
    assert restarted["state"] == "submission_unknown"
    assert f.provider.calls == []
    assert (await f.service.run(job["job_id"])) == restarted


@pytest.mark.asyncio
async def test_queued_disclosure_rotation_rejects_with_zero_provider_calls(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    f.provider.profile = f.provider.profile.model_copy(
        update={"endpoint": "https://rotated.example"}
    )
    failed = await f.service.run(receipt.job_ids[0])
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == "EMBEDDING_DISCLOSURE_STALE"
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_failed_final_publish_not_ready_and_no_provider_replay(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    f.db.publish_fail = True
    failed = await f.service.run(receipt.job_ids[0])
    assert failed["state"] == "submission_unknown"
    assert failed["completed_evidence"] == failed["total_evidence"] == 1
    assert f.db.manifests == []
    assert (await f.service.status(NB, ["v1"]))["profiles"][0]["index"][
        "state"
    ] != "ready"
    assert await f.service.run(receipt.job_ids[0]) == failed
    assert len(f.provider.calls) == 1
    assert PRIVATE not in str(failed)


@pytest.mark.asyncio
async def test_unknown_provider_no_progress_and_no_replay(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    f.provider.error = EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")
    failed = await f.service.run(receipt.job_ids[0])
    assert failed["state"] == "submission_unknown"
    assert failed["completed_evidence"] == 0
    assert f.db.manifests == []
    await f.service.reconcile(receipt.job_ids[0])
    await f.service.run(receipt.job_ids[0])
    assert len(f.provider.calls) == 1


@pytest.mark.asyncio
async def test_progress_only_after_acknowledged_batch_and_cancel_between_batches(
    indexing,
):
    f = indexing
    add_many(f)
    receipt = await f.service.submit(NB, await request_for(f))
    jid = receipt.job_ids[0]

    async def commit_hook(params):
        for write in params["job_writes"]:
            if (
                write["identity"] == jid
                and write["value"].get("completed_evidence") == 16
            ):
                assert len(f.db.vectors) == 16
                # Durable cancellation races after the first acknowledged batch.
                f.provider.on_call = lambda: asyncio.sleep(0)

    f.db.commit_hook = commit_hook
    original_write = f.service.repository.write_batch

    async def write(*args):
        await original_write(*args)
        await f.service.cancel(jid)

    f.service.repository.write_batch = write
    cancelled = await f.service.run(jid)
    assert cancelled["state"] == "cancelled_local"
    assert len(f.provider.calls) == 1
    assert f.db.manifests == []


@pytest.mark.asyncio
async def test_read_only_reconciliation_proves_only_own_completed_manifest(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    jid = receipt.job_ids[0]
    assert (await f.service.run(jid))["state"] == "succeeded"
    job = await f.store.get("job", jid)
    job.update(state="submission_unknown", submission_state="unknown")
    await f.store.put("job", jid, job)
    assert (await f.service.reconcile(jid))["state"] == "succeeded"
    assert len(f.provider.calls) == len(f.queued) == 1


@pytest.mark.asyncio
async def test_group_and_unsupported_jobs_never_enter_worker(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    with pytest.raises(InvalidInputError, match="INVALID_INDEX_OPERATION"):
        await f.service.run(receipt.group_id)
    await f.store.put(
        "job",
        "other",
        {"job_id": "other", "notebook_id": NB, "operation": "chat", "state": "queued"},
    )
    with pytest.raises(InvalidInputError, match="INVALID_INDEX_OPERATION"):
        await f.service.run("other")
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_unconfirmed_admission_child_cannot_run_even_if_record_exists(indexing):
    f = indexing
    request = await request_for(f)
    f.db.fail_operation = "index_admit"
    with pytest.raises(DatabaseOperationError):
        await f.service.submit(NB, request)
    parent = next(
        v for v in f.store.rows.values() if v.get("operation") == "index_evidence_group"
    )
    child = await f.service.run(parent["job_ids"][0])
    assert child["state"] == "submission_unknown"
    assert f.provider.calls == []
    group = await f.service.reconcile(parent["job_id"])
    assert group["state"] == "submission_unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("acknowledge_external_processing", False),
        ("profile_id", "changed"),
        ("preview_hash", "f" * 64),
    ],
)
async def test_tampered_durable_request_rejects_before_content_or_provider(
    indexing, field, value
):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    job = await f.store.get("job", receipt.job_ids[0])
    job["request_snapshot"][field] = value
    await f.store.put("job", job["job_id"], job)
    f.db.calls.clear()
    failed = await f.service.run(job["job_id"])
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == "INDEX_INTEGRITY"
    assert f.provider.calls == []
    assert not any("index-input-content" in sql for sql, _ in f.db.calls)


@pytest.mark.asyncio
async def test_unknown_cancel_fence_cannot_be_reported_confirmed_on_repeat(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    f.db.raw_override = {"result": [{"status": "OK", "result": {"wrong": "receipt"}}]}
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.cancel(receipt.job_ids[0])
    # A retained local marker is not proof that the repository fence committed.
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.cancel(receipt.job_ids[0])
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_cancelled_group_creator_cannot_dispatch_remaining_children(indexing):
    f = indexing
    request = await request_for(f, ["v1", "v2"])
    original = f.service.enqueue

    async def enqueue(command, args):
        result = await original(command, args)
        child = await f.store.get("job", args["job_id"])
        await f.service.cancel(child["group_id"])
        return result

    f.service.enqueue = enqueue
    receipt = await f.service.submit(NB, request)
    assert receipt.state == "cancelled_local"
    assert len(f.queued) == 1
    assert len(receipt.jobs) == 2
    assert all(j.state == "cancelled_local" for j in receipt.jobs)


@pytest.mark.asyncio
@pytest.mark.parametrize("count,dimension", [(5001, 2), (500, 4096)])
async def test_preview_cap_rejects_before_content_without_truncation(
    indexing, count, dimension
):
    f = indexing
    add_many(f, count)
    f.provider.profile = f.provider.profile.model_copy(update={"dimension": dimension})
    with pytest.raises(InvalidInputError, match="SCOPE_TOO_LARGE"):
        await f.service.preview(NB, ["v1"], "chosen")
    assert not any("index-input-content" in sql for sql, _ in f.db.calls)
    assert f.queued == f.provider.calls == []


@pytest.mark.asyncio
async def test_failed_rebuild_keeps_compatible_last_good_manifest(indexing):
    f = indexing
    first = await f.service.submit(NB, await request_for(f))
    await f.service.run(first.job_ids[0])
    old = deepcopy(f.db.manifests)
    rebuild = await f.service.submit(NB, await request_for(f, key="rebuild"))
    f.db.publish_fail = True
    assert (await f.service.run(rebuild.job_ids[0]))["state"] == "submission_unknown"
    assert f.db.manifests == old
    assert (await f.service.reconcile(rebuild.job_ids[0]))[
        "state"
    ] == "submission_unknown"
    assert (await f.service.status(NB, ["v1"]))["profiles"][0]["index"][
        "state"
    ] == "ready"


@pytest.mark.asyncio
async def test_late_old_worker_is_fenced_after_explicit_retry(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    f.db.publish_fail = True
    assert (await f.service.run(receipt.job_ids[0]))["state"] == "submission_unknown"
    f.db.publish_fail = False
    await f.service.cancel(receipt.job_ids[0])
    old = await f.store.get("job", receipt.job_ids[0])
    retry = await f.service.submit(
        NB,
        await request_for(
            f,
            key="retry",
            retry_of_job_id=old["job_id"],
            acknowledge_duplicate_embedding_cost=True,
        ),
    )
    await f.service.run(retry.job_ids[0])
    manifest = deepcopy(f.db.manifests)
    from open_notebook.domain.evidence_retrieval import ScopeSnapshot

    with pytest.raises(InvalidInputError, match="ATTEMPT_CANCELLED"):
        await f.service.repository.publish(
            old["job_id"],
            ScopeSnapshot.model_validate(old["version_snapshot"]),
            f.provider.profile,
            1,
        )
    assert f.db.manifests == manifest
    assert len(f.provider.calls) == 2


@pytest.mark.asyncio
async def test_scope_revocation_at_dispatch_commit_blocks_provider(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))

    async def revoke_at_dispatch(params):
        if any(w["value"].get("stage") == "embedding" for w in params["job_writes"]):
            f.db.epochs["v1"] = 1

    f.db.commit_hook = revoke_at_dispatch
    failed = await f.service.run(receipt.job_ids[0])
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == "SCOPE_CHANGED"
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_dispatch_marker_includes_all_scope_and_attempt_db_guards(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f, ["v1", "v2"]))
    await f.service.run(receipt.job_ids[0])
    markers = [
        (sql, p)
        for sql, p in f.db.calls
        if "index-job-commit" in sql
        and any(
            w["value"].get("stage") == "embedding"
            and w["value"].get("state") == "running"
            and w["value"].get("completed_evidence") == w["value"].get("batch_start")
            for w in p["job_writes"]
        )
    ]
    assert markers
    for sql, params in markers:
        assert "SCOPE_CHANGED" in sql
        assert "ATTEMPT_CANCELLED" in sql
        assert {e["version_id"] for e in params["entries"]} == {"v1", "v2"}
        assert params["attempt_id"] == receipt.job_ids[0]


@pytest.mark.asyncio
async def test_explicit_retry_rebuilds_even_previously_acknowledged_batches(indexing):
    f = indexing
    add_many(f)
    first = await f.service.submit(NB, await request_for(f))

    async def fail_second_batch():
        if len(f.provider.calls) == 2:
            f.provider.error = EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")

    f.provider.on_call = fail_second_batch
    failed = await f.service.run(first.job_ids[0])
    assert failed["state"] == "submission_unknown"
    assert failed["completed_evidence"] == 16
    assert len(f.db.vectors) == 16
    f.provider.error = f.provider.on_call = None
    retry = await f.service.submit(
        NB,
        await request_for(
            f,
            key="retry",
            retry_of_job_id=first.job_ids[0],
            acknowledge_duplicate_embedding_cost=True,
        ),
    )
    assert (await f.service.run(retry.job_ids[0]))["state"] == "succeeded"
    assert list(map(len, f.provider.calls)) == [16, 2, 16, 2]
    assert (await f.store.get("job", first.job_ids[0]))["completed_evidence"] == 16


@pytest.mark.asyncio
async def test_unknown_vector_commit_does_not_advance_progress_or_send_next_batch(
    indexing,
):
    f = indexing
    add_many(f)
    receipt = await f.service.submit(NB, await request_for(f))
    original_raw = f.db.query_raw

    async def lose_vector_ack(sql, params):
        response = await original_raw(sql, params)
        if "vector-write" in sql:
            return {"result": response["result"][:1]}
        return response

    f.db.query_raw = lose_vector_ack
    result = await f.service.run(receipt.job_ids[0])
    assert result["state"] == "submission_unknown"
    assert result["completed_evidence"] == 0
    assert len(f.db.vectors) == 16  # Possible commit is not an acknowledged batch.
    assert list(map(len, f.provider.calls)) == [16]
    assert await f.service.run(receipt.job_ids[0]) == result


@pytest.mark.asyncio
async def test_group_never_claims_completion_for_partial_success(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f, ["v1", "v2"]))
    await f.service.run(receipt.job_ids[0])
    group = await f.service.reconcile(receipt.group_id)
    assert len(group["jobs"]) == 2
    assert [j["state"] for j in group["jobs"]] == ["succeeded", "queued"]
    assert group["state"] != "succeeded"
    f.provider.error = RuntimeError(PRIVATE)
    await f.service.run(receipt.job_ids[1])
    group = await f.service.reconcile(receipt.group_id)
    assert group["state"] == "submission_unknown"
    assert PRIVATE not in str(group)


@pytest.mark.asyncio
async def test_same_key_receipt_stays_immutable_after_worker_completion(indexing):
    f = indexing
    request = await request_for(f)
    receipt = await f.service.submit(NB, request)
    await f.service.run(receipt.job_ids[0])
    assert await f.service.submit(NB, request) == receipt
    assert (await f.service.reconcile(receipt.group_id))["state"] == "succeeded"
    assert len(f.queued) == len(f.provider.calls) == 1


@pytest.mark.asyncio
async def test_local_destination_still_needs_explicit_build_but_not_external_ack(
    indexing,
):
    f = indexing
    f.provider.profile = f.provider.profile.model_copy(
        update={"destination_kind": "on_device", "document_prefix": "文档: "}
    )
    request = await request_for(f)
    preview = await f.service.preview(NB, ["v1"], "chosen")
    assert preview.input_bytes == len(("文档: " + f.db.quotes["ev1"]).encode())
    receipt = await f.service.submit(
        NB, request.model_copy(update={"acknowledge_external_processing": False})
    )
    assert f.provider.calls == []
    assert (await f.service.run(receipt.job_ids[0]))["state"] == "succeeded"


@pytest.mark.asyncio
async def test_feature_disabled_still_allows_no_call_preview_status_but_no_build(
    indexing, monkeypatch
):
    f = indexing
    monkeypatch.delenv("STUDY_WORKBENCH_HYBRID_ENABLED")
    request = await request_for(f)
    assert (await f.service.status(NB, ["v1"]))["enabled"] is False
    with pytest.raises(InvalidInputError, match="FEATURE_DISABLED"):
        await f.service.submit(NB, request)
    assert f.provider.calls == f.queued == []


@pytest.mark.asyncio
async def test_active_attempt_check_is_inside_project_admission_barrier(indexing):
    f = indexing
    original = f.service._retry

    async def check(*args):
        assert f.store.locks[NB].locked()
        return await original(*args)

    f.service._retry = check
    await f.service.submit(NB, await request_for(f))


@pytest.mark.asyncio
async def test_unknown_dispatch_ownership_ack_never_queues(indexing):
    f = indexing
    request = await request_for(f)
    f.db.fail_operation = "index_progress"
    f.db.fail_ack = True
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.submit(NB, request)
    f.db.fail_operation = None
    receipt = await f.service.submit(NB, request)
    assert receipt.state == "submission_unknown"
    assert f.queued == f.provider.calls == []


# Task 3 independent review regressions (R1-R3).
@pytest.mark.asyncio
async def test_dead_dispatch_is_reconciled_without_reexecuting_worker(indexing):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    jid = receipt.job_ids[0]
    child = await f.store.get("job", jid)
    child.update(
        state="running",
        stage="embedding",
        attempts=1,
        dispatch_started=True,
        submission_state="unknown",
    )
    await f.store.put("job", jid, child)
    # There is no executing run() and thus no live run lock. This is the durable
    # post-crash state. Read-only reconciliation must not call run() to recover.
    observed = await f.service.reconcile(jid)
    assert f.provider.calls == []
    assert len(f.queued) == 1
    assert observed["state"] == "submission_unknown"


@pytest.mark.asyncio
async def test_explicit_retry_fences_old_group_creator_before_remaining_enqueue(
    indexing,
):
    f = indexing
    initial_request = await request_for(f, ["v1", "v2"])
    original_dispatch = f.service._dispatch
    original_enqueue = f.service.enqueue
    first_id = None
    retry_receipt = None
    calls = []

    async def enqueue(command, args):
        calls.append(args["job_id"])
        if len(calls) == 1:
            raise TimeoutError("synthetic lost queue acknowledgment")
        return await original_enqueue(command, args)

    async def dispatch(jid):
        nonlocal first_id, retry_receipt
        result = await original_dispatch(jid)
        if first_id is None:
            first_id = jid
            # Interleave a distinct user's acknowledged retry after old child A
            # is unknown but before its original submitter dispatches child B.
            retry_request = await request_for(
                f,
                key="explicit-retry",
                retry_of_job_id=jid,
                acknowledge_duplicate_embedding_cost=True,
            )
            retry_receipt = await f.service.submit(NB, retry_request)
        return result

    f.service.enqueue = enqueue
    f.service._dispatch = dispatch
    initial_receipt = await f.service.submit(NB, initial_request)
    assert retry_receipt is not None
    assert f.db.attempts[first_id] is True
    assert initial_receipt.job_ids[1] not in calls


@pytest.mark.asyncio
async def test_unknown_group_cancel_still_fences_remaining_creator_dispatch(indexing):
    f = indexing
    initial_request = await request_for(f, ["v1", "v2"])
    original_dispatch = f.service._dispatch
    original_cancel = f.service.repository.cancel_attempt
    first = True

    async def unknown_fence(jid):
        raise DatabaseOperationError("INDEX_COMMIT_UNKNOWN")

    async def dispatch(jid):
        nonlocal first
        result = await original_dispatch(jid)
        if first:
            first = False
            child = await f.store.get("job", jid)
            f.service.repository.cancel_attempt = unknown_fence
            with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
                await f.service.cancel(child["group_id"])
            f.service.repository.cancel_attempt = original_cancel
        return result

    f.service._dispatch = dispatch
    receipt = await f.service.submit(NB, initial_request)
    assert (await f.store.get("job", receipt.job_ids[0]))["cancel_requested"] is True
    assert len(f.queued) == 1


@pytest.mark.asyncio
async def test_unknown_dispatch_receipt_is_not_relabelled_queued_by_live_status(
    indexing,
):
    f = indexing
    request = await request_for(f)
    f.db.fail_operation = "index_progress"
    f.db.fail_ack = True
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.submit(NB, request)
    f.db.fail_operation = None
    receipt = await f.service.submit(NB, request)
    assert receipt.state == "submission_unknown"
    assert f.queued == []
    child = await f.store.get("job", receipt.job_ids[0])
    assert child["dispatch_receipt"]["dispatch_ack"] == "unknown"
    assert (await f.service.reconcile(receipt.group_id))[
        "state"
    ] == "submission_unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize("view", ["child", "group", "scope"])
async def test_live_run_lock_prevents_false_interruption_and_allows_cancel(
    indexing, view
):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    entered, release = asyncio.Event(), asyncio.Event()

    async def in_flight():
        entered.set()
        await release.wait()

    f.provider.on_call = in_flight
    worker = asyncio.create_task(f.service.run(receipt.job_ids[0]))
    await asyncio.wait_for(entered.wait(), 3)
    try:
        if view == "child":
            observed = await asyncio.wait_for(
                f.service.reconcile(receipt.job_ids[0]), 1
            )
            assert observed["state"] == "running"
        elif view == "group":
            observed = await asyncio.wait_for(f.service.reconcile(receipt.group_id), 1)
            assert observed["state"] == observed["jobs"][0]["state"] == "running"
        else:
            observed = await asyncio.wait_for(f.service.status(NB, ["v1"]), 1)
            assert observed["jobs"][0]["state"] == "running"
        cancelled = await asyncio.wait_for(f.service.cancel(receipt.job_ids[0]), 1)
        assert cancelled["state"] == "cancelled_local"
    finally:
        release.set()
        await worker
    assert len(f.provider.calls) == 1
    assert (await f.store.get("job", receipt.job_ids[0]))["state"] == "cancelled_local"


@pytest.mark.asyncio
@pytest.mark.parametrize("view", ["group", "scope"])
async def test_dead_worker_reconciles_from_all_read_views_then_explicit_retry(
    indexing, view
):
    f = indexing
    request = await request_for(f)
    receipt = await f.service.submit(NB, request)
    jid = receipt.job_ids[0]
    job = await f.store.get("job", jid)
    job.update(state="running", attempts=1, dispatch_started=True, stage="embedding")
    await f.store.put("job", jid, job)
    if view == "group":
        observed = await f.service.reconcile(receipt.group_id)
        assert observed["state"] == observed["jobs"][0]["state"] == "submission_unknown"
    else:
        observed = await f.service.status(NB, ["v1"])
        assert observed["jobs"][0]["state"] == "submission_unknown"
    assert (await f.store.get("job", jid))["state"] == "submission_unknown"
    assert f.provider.calls == []
    assert await f.service.submit(NB, request) == receipt
    retry = await f.service.submit(
        NB,
        await request_for(
            f,
            key="after-crash",
            retry_of_job_id=jid,
            acknowledge_duplicate_embedding_cost=True,
        ),
    )
    assert retry.job_ids != receipt.job_ids
    assert f.db.attempts[jid] is True
    assert len(f.queued) == 2


@pytest.mark.asyncio
async def test_unknown_queue_owner_reconciles_child_and_scope_with_explicit_retry(
    indexing,
):
    f = indexing
    request = await request_for(f)
    f.db.fail_operation = "index_progress"
    f.db.fail_ack = True
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.submit(NB, request)
    f.db.fail_operation = None
    receipt = await f.service.submit(NB, request)
    assert (await f.service.reconcile(receipt.job_ids[0]))[
        "state"
    ] == "submission_unknown"
    assert (await f.service.status(NB, ["v1"]))["jobs"][0][
        "state"
    ] == "submission_unknown"
    assert (await f.store.get("job", receipt.job_ids[0]))[
        "state"
    ] == "submission_unknown"
    assert f.queued == []
    assert await f.service.submit(NB, request) == receipt
    retry = await f.service.submit(
        NB,
        await request_for(
            f,
            key="after-owner-loss",
            retry_of_job_id=receipt.job_ids[0],
            acknowledge_duplicate_embedding_cost=True,
        ),
    )
    assert len(f.queued) == 1
    assert f.queued[0][1]["job_id"] == retry.job_ids[0]
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_live_queue_creator_remains_unknown_without_aborting_its_submission(
    indexing,
):
    f = indexing
    request = await request_for(f)
    entered, release = asyncio.Event(), asyncio.Event()
    original = f.service.enqueue
    jid = None

    async def pending(command, args):
        nonlocal jid
        jid = args["job_id"]
        entered.set()
        await release.wait()
        return await original(command, args)

    f.service.enqueue = pending
    submission = asyncio.create_task(f.service.submit(NB, request))
    await asyncio.wait_for(entered.wait(), 3)
    try:
        observed = await asyncio.wait_for(f.service.reconcile(jid), 1)
        assert observed["state"] == "submission_unknown"
        assert (await f.store.get("job", jid))["state"] == "queued"
        assert (await f.service.status(NB, ["v1"]))["jobs"][0][
            "state"
        ] == "submission_unknown"
    finally:
        release.set()
        receipt = await submission
    assert receipt.state == "queued"
    assert (await f.service.reconcile(jid))["state"] == "queued"
    assert len(f.queued) == 1
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_unknown_group_stop_ack_prevents_child_cancellation_or_new_admission(
    indexing,
):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f, ["v1", "v2"]))
    original_cancel = f.service.repository.cancel_attempt
    cancelled = []

    async def cancel_attempt(jid):
        cancelled.append(jid)
        await original_cancel(jid)

    f.service.repository.cancel_attempt = cancel_attempt
    f.db.fail_operation = "index_group_stop"
    f.db.fail_ack = True
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.cancel(receipt.group_id)
    assert cancelled == []
    assert (await f.store.get("job", receipt.group_id))["dispatch_stopped"] is True
    assert all(
        [
            not (await f.store.get("job", jid)).get("cancel_requested")
            for jid in receipt.job_ids
        ]
    )


@pytest.mark.asyncio
async def test_child_queue_ownership_transaction_writes_and_checks_group_fence(
    indexing,
):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    markers = [
        (sql, p)
        for sql, p in f.db.calls
        if "index-job-commit" in sql
        and any(
            w["value"].get("queue_dispatch_started")
            and not w["value"].get("worker_job_id")
            and w["value"].get("operation") == "index_evidence"
            for w in p["job_writes"]
        )
    ]
    assert markers
    for sql, params in markers:
        assert "dispatch_stopped" in sql
        assert params["dispatch_group_target"]
        assert any(w["identity"] == receipt.group_id for w in params["job_writes"])
    parent = await f.store.get("job", receipt.group_id)
    assert parent["receipt"] == receipt.model_dump()


@pytest.mark.asyncio
async def test_nonblocking_ownership_probe_uses_same_shared_lock_and_releases(tmp_path):
    from open_notebook.database.project_locks import project_lock, try_project_lock

    key = "index-run:synthetic"
    async with project_lock(key, tmp_path):
        async with try_project_lock(key, tmp_path) as acquired:
            assert acquired is False
    async with try_project_lock(key, tmp_path) as acquired:
        assert acquired is True
    async with try_project_lock(key, tmp_path) as acquired:
        assert acquired is True


@pytest.mark.asyncio
async def test_unknown_old_group_stop_ack_blocks_explicit_retry_admission(indexing):
    f = indexing
    first = await f.service.submit(NB, await request_for(f))
    f.provider.error = EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")
    assert (await f.service.run(first.job_ids[0]))["state"] == "submission_unknown"
    old_groups = {
        jid
        for (_, jid), j in f.store.rows.items()
        if j.get("operation") == "index_evidence_group"
    }
    retry = await request_for(
        f,
        key="group-stop-unknown",
        retry_of_job_id=first.job_ids[0],
        acknowledge_duplicate_embedding_cost=True,
    )
    f.db.fail_operation = "index_group_stop"
    f.db.fail_ack = True
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await f.service.submit(NB, retry)
    assert {
        jid
        for (_, jid), j in f.store.rows.items()
        if j.get("operation") == "index_evidence_group"
    } == old_groups
    assert len(f.queued) == 1
    assert (
        f.db.attempts[first.job_ids[0]] is False
    )  # no per-child fence after unknown group stop


@pytest.mark.asyncio
async def test_group_stop_racing_child_claim_is_checked_in_same_transaction(indexing):
    f = indexing
    request = await request_for(f)

    def is_claim(params):
        return params.get("dispatch_group_target") is not None

    async def external_stop(params):
        if is_claim(params):
            parent_write = params["job_writes"][0]
            parent = await f.store.get("job", parent_write["identity"])
            parent.update(dispatch_stopped=True, revision=parent["revision"] + 1)
            await f.store.put("job", parent["job_id"], parent)

    f.db.commit_hook = external_stop
    with pytest.raises(InvalidInputError, match="ATTEMPT_CANCELLED"):
        await f.service.submit(NB, request)
    assert f.queued == f.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("marker", ["restored_history", "replay_allowed"])
async def test_read_only_reconciliation_preserves_nonexecutable_historical_child(
    indexing, marker
):
    f = indexing
    receipt = await f.service.submit(NB, await request_for(f))
    job = await f.store.get("job", receipt.job_ids[0])
    job.update(state="running", attempts=1, dispatch_started=True)
    job[marker] = marker == "restored_history"
    await f.store.put("job", job["job_id"], job)
    assert await f.service.reconcile(job["job_id"]) == job
    assert await f.store.get("job", job["job_id"]) == job
    assert f.provider.calls == []


@pytest.mark.asyncio
async def test_live_worker_before_initial_claim_is_not_aborted_by_unknown_queue_reconcile(
    indexing,
):
    from open_notebook.database.project_locks import project_lock

    f = indexing
    request = await request_for(f)
    accepted = asyncio.Event()
    original = f.service.enqueue
    jid = None

    async def accepted_without_ack(command, args):
        nonlocal jid
        await original(command, args)
        jid = args["job_id"]
        accepted.set()
        await asyncio.Event().wait()

    f.service.enqueue = accepted_without_ack
    submission = asyncio.create_task(f.service.submit(NB, request))
    await asyncio.wait_for(accepted.wait(), 3)
    submission.cancel()  # Original request/creator dies after queue acceptance.
    with pytest.raises(asyncio.CancelledError):
        await submission
    assert isinstance(jid, str)
    group_id = (await f.store.get("job", jid))["group_id"]
    # A worker has acquired its real run ownership but has not yet ACKed its
    # initial queued -> running metadata claim. It is live, not interrupted.
    async with project_lock("index-run:" + jid):
        assert (await f.service.reconcile(jid))["state"] == "submission_unknown"
        assert (await f.store.get("job", jid))["state"] == "queued"
        assert (await f.service.reconcile(group_id))["state"] == "submission_unknown"
        assert (await f.service.status(NB, ["v1"]))["jobs"][0][
            "state"
        ] == "submission_unknown"
        assert (await f.store.get("job", jid))["state"] == "queued"
    # Only once both creator and worker ownership are idle is durable unknown
    # justified; no rerun/enqueue is used to reach that recovery state.
    assert (await f.service.reconcile(jid))["state"] == "submission_unknown"
    assert (await f.store.get("job", jid))["state"] == "submission_unknown"
    assert len(f.queued) == 1
    assert f.provider.calls == []
