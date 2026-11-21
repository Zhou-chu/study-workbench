"""Real indexing pipeline with synthetic repository/provider/transaction boundaries."""

import asyncio
import hashlib
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from surrealdb import RecordID

from api import evidence_indexing as subject
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    ScopeEntry,
    ScopeSnapshot,
)
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError


@pytest.fixture
def pipeline(monkeypatch):
    async def make(count=17):
        jobs: dict[str, dict[str, object]] = {}
        events: list[tuple[object, ...]] = []
        faults: dict[str, Any] = {}
        profile = EmbeddingProfile(
            profile_id="synthetic",
            model_id="model:x",
            provider="synthetic",
            model_name="synthetic",
            revision="1",
            endpoint="https://example.invalid/v1",
            credential_binding_id="synthetic",
            dimension=2,
            document_prefix="文:",
            query_prefix="",
            preprocessing_revision="evidence-identity-v1",
            max_input_bytes=2000,
            cosine_min_score=0.0,
            destination_descriptor_version="1",
            destination_kind="remote",
        )
        rows = [
            {
                "id": RecordID.parse(subject.record_key("evidence", f"ev_{i}")),
                "evidence_id": f"ev_{i}",
                "version_id": "sv_one",
                "extraction_id": "ex_one",
                "notebook_id": "notebook:one",
                "quote": f"合成段落 {i}",
                "quote_hash": hashlib.sha256(f"合成段落 {i}".encode()).hexdigest(),
            }
            for i in range(count)
        ]
        manifest = subject._hash([[r["evidence_id"], r["quote_hash"]] for r in rows])
        snapshot = ScopeSnapshot(
            notebook_id="notebook:one",
            entries=(
                ScopeEntry(
                    version_id="sv_one",
                    extraction_id="ex_one",
                    manifest_hash=manifest,
                    scope_epoch=1,
                ),
            ),
        )
        membership = {
            "id": RecordID.parse(subject.record_key("extraction", "ex_one")),
            "extraction_id": "ex_one",
            "source_version_id": "sv_one",
            "notebook_id": "notebook:one",
            "evidence_ids": [r["evidence_id"] for r in rows],
        }

        @asynccontextmanager
        async def lock(key):
            events.append(("lock", key))
            try:
                yield
            finally:
                events.append(("unlock", key))

        async def get(kind, identity):
            assert kind == "job"
            return deepcopy(jobs.get(identity))

        async def transaction(_sql, params, *, operation):
            for write in params["job_writes"]:
                events.append(("commit", operation, deepcopy(write["value"])))
                jobs[write["identity"]] = deepcopy(write["value"])

        async def query(sql, _params):
            if "index-input-membership" in sql:
                return deepcopy(faults.get("memberships", [membership]))
            assert "index-input-content" in sql
            return deepcopy(faults.get("content", rows))

        async def register(*args):
            events.append(("register", args[0]))
            if faults.get("register"):
                raise faults["register"]

        async def write(*args):
            events.append(("write", deepcopy(args[3])))
            if faults.get("write"):
                raise faults["write"]
            if faults.get("cancel_after_write"):
                jobs[job_id].update(state="cancelled_local", cancel_requested=True)

        async def publish(*args):
            events.append(("publish", args[3]))
            if faults.get("publish"):
                raise faults["publish"]
            return {"state": "ready", "attempt_id": args[0]}

        repository = SimpleNamespace(
            capture_scope=AsyncMock(return_value=snapshot),
            assert_scope=AsyncMock(),
            query=query,
            _assert_locked=AsyncMock(return_value={}),
            _params=lambda *_args: {},
            register_attempt=register,
            write_batch=write,
            publish=publish,
        )

        async def embed(chosen, texts, *, dispatch_admission):
            events.append(("admission", len(texts)))
            if faults.get("cancel_before_admission"):
                jobs[job_id].update(state="cancelled_local", cancel_requested=True)
            if faults.get("tamper_before_admission"):
                jobs[job_id]["attempts"] = 7
            await dispatch_admission()
            events.append(("embed", list(texts), chosen))
            if faults.get("embed"):
                raise faults["embed"]
            if faults.get("cancel_after_embed"):
                jobs[job_id].update(state="cancelled_local", cancel_requested=True)
            return (
                [[1.0, 0.0] for _ in texts][:-1]
                if faults.get("short_vectors")
                else [[1.0, 0.0] for _ in texts]
            )

        provider = SimpleNamespace(
            resolve_profile=lambda _identity: faults.get("profile", profile),
            embed_documents=embed,
        )
        enqueue = AsyncMock(side_effect=AssertionError("Worker must not enqueue"))
        service = subject.EvidenceIndexingService(
            store=SimpleNamespace(get=get, project_lock=lock),
            repository=repository,
            embeddings=provider,
            submit=enqueue,
        )
        monkeypatch.setattr(subject, "project_lock", lock)
        monkeypatch.setattr(subject, "_transaction", transaction)
        monkeypatch.setattr(subject, "hybrid_enabled", lambda: True)
        monkeypatch.setattr(subject, "now", lambda: "2026-01-01T00:00:00Z")
        preview, _ = await service._preview(
            "notebook:one", ["sv_one"], profile.profile_id
        )
        request = subject.IndexRequest(
            source_version_ids=["sv_one"],
            profile_id=profile.profile_id,
            preview_hash=preview.preview_hash,
            acknowledge_external_processing=True,
            idempotency_key="synthetic-intent",
        )
        group_id = "job_" + subject.digest(
            {"notebook_id": "notebook:one", "index": request.idempotency_key}
        )
        job_id = "job_" + subject.digest({"index_group": group_id, "version": "sv_one"})
        jobs[job_id] = {
            "job_id": job_id,
            "group_id": group_id,
            "notebook_id": "notebook:one",
            "operation": "index_evidence",
            "state": "queued",
            "revision": 1,
            "queue_dispatch_started": True,
            "attempts": 0,
            "dispatch_started": False,
            "total_evidence": count,
            "completed_evidence": 0,
            "source_version_id": "sv_one",
            "extraction_id": "ex_one",
            "profile": profile.model_dump(exclude_computed_fields=True),
            "request_snapshot": request.model_dump(),
            "request_hash": subject.digest(
                {"notebook_id": "notebook:one", **request.model_dump()}
            ),
            "scope_snapshot": snapshot.model_dump(),
            "version_snapshot": snapshot.model_dump(),
            "profile_id": profile.profile_id,
            "profile_fingerprint": profile.fingerprint,
            "disclosed_profile_fingerprint": profile.fingerprint,
            "destination_descriptor_version": profile.destination_descriptor_version,
            "preview_hash": preview.preview_hash,
            "input_hash": manifest,
        }
        events.clear()
        return SimpleNamespace(
            service=service,
            jobs=jobs,
            events=events,
            faults=faults,
            repository=repository,
            profile=profile,
            rows=rows,
            membership=membership,
            snapshot=snapshot,
            preview=preview,
            job_id=job_id,
            enqueue=enqueue,
        )

    return make


@pytest.mark.asyncio
async def test_success_executes_real_two_batch_pipeline_and_only_acknowledged_progress(
    pipeline,
):
    b = await pipeline()
    result = await b.service.run(b.job_id)
    assert result["state"] == "succeeded"
    assert result["submission_state"] == "confirmed"
    assert result["completed_evidence"] == 17
    assert result["remote_may_continue"] is False
    embedded = [e for e in b.events if e[0] == "embed"]
    assert [len(e[1]) for e in embedded] == [16, 1]
    assert [text for event in embedded for text in event[1]] == [
        r["quote"] for r in b.rows
    ]
    assert all(event[2] == b.profile for event in embedded)
    writes = [e[1] for e in b.events if e[0] == "write"]
    assert [len(w) for w in writes] == [16, 1]
    assert all(
        row["attempt_id"] == b.job_id and row["namespace"] == b.profile.fingerprint
        for batch in writes
        for row in batch
    )
    assert [row["evidence_id"] for batch in writes for row in batch] == [
        r["evidence_id"] for r in b.rows
    ]
    assert all(
        row["vector"] == [1.0, 0.0] and "quote" not in row
        for batch in writes
        for row in batch
    )
    assert [e for e in b.events if e[0] == "publish"] == [("publish", 17)]
    assert b.events[-1] == ("unlock", "index-run:" + b.job_id)
    for index, event in enumerate(b.events):
        if event[0] == "commit" and event[2].get("completed_evidence"):
            acknowledged = sum(len(e[1]) for e in b.events[:index] if e[0] == "write")
            assert event[2]["completed_evidence"] == acknowledged
    publish_index = next(i for i, e in enumerate(b.events) if e[0] == "publish")
    assert all(i < publish_index for i, e in enumerate(b.events) if e[0] == "write")
    b.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_valid_scope_publishes_without_embedding(pipeline):
    b = await pipeline(0)
    result = await b.service.run(b.job_id)
    assert result["state"] == "succeeded"
    assert result["completed_evidence"] == 0
    assert not any(e[0] in {"embed", "write"} for e in b.events)
    assert ("publish", 0) in b.events


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phase,code,state",
    [
        ("register", "SCOPE_CHANGED", "failed"),
        ("embed", "EMBEDDING_OUTCOME_UNKNOWN", "submission_unknown"),
        ("write", "INDEX_COMMIT_UNKNOWN", "submission_unknown"),
        ("publish", "INDEX_COMMIT_REJECTED", "failed"),
        ("embed", "UNRECOGNIZED", "submission_unknown"),
    ],
)
async def test_failures_never_invent_success_or_automatic_retry(
    pipeline, phase, code, state
):
    b = await pipeline()
    b.faults[phase] = DatabaseOperationError(code + ": SYNTHETIC_SECRET")
    result = await b.service.run(b.job_id)
    assert result["state"] == state
    assert result["error"]["code"] == (
        "INDEXING_UNCONFIRMED" if code == "UNRECOGNIZED" else code
    )
    assert "SYNTHETIC_SECRET" not in str(result["error"])
    assert result["submission_state"] == (
        "not_submitted" if phase == "register" else "unknown"
    )
    if phase in {"register", "embed", "write"}:
        assert result["completed_evidence"] == 0
        assert not any(e[0] == "publish" for e in b.events)
        assert sum(e[0] == "embed" for e in b.events) <= 1
    b.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_wrong_vector_cardinality_never_writes_or_publishes(pipeline):
    b = await pipeline()
    b.faults["short_vectors"] = True
    result = await b.service.run(b.job_id)
    assert result["error"]["code"] == "EMBEDDING_INVALID_RESPONSE"
    assert result["completed_evidence"] == 0
    assert not any(e[0] in {"write", "publish"} for e in b.events)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "point", ["cancel_before_admission", "cancel_after_embed", "cancel_after_write"]
)
async def test_cancellation_at_provider_boundaries_drops_late_progress(pipeline, point):
    b = await pipeline()
    b.faults[point] = True
    result = await b.service.run(b.job_id)
    assert result["state"] == "cancelled_local"
    assert result["completed_evidence"] == 0
    assert not any(e[0] == "publish" for e in b.events)
    if point != "cancel_after_write":
        assert not any(e[0] == "write" for e in b.events)
    if point == "cancel_before_admission":
        assert not any(e[0] == "embed" for e in b.events)
    assert b.events[-1] == ("unlock", "index-run:" + b.job_id)


@pytest.mark.asyncio
async def test_dispatched_attempt_tampering_rejects_before_provider_send(pipeline):
    b = await pipeline()
    b.faults["tamper_before_admission"] = True
    result = await b.service.run(b.job_id)
    assert result["error"]["code"] == "INDEX_INTEGRITY"
    assert not any(e[0] in {"embed", "write", "publish"} for e in b.events)


@pytest.mark.asyncio
async def test_disclosure_rotation_stops_before_content_provider_work(pipeline):
    b = await pipeline()
    b.faults["profile"] = b.profile.model_copy(
        update={"destination_descriptor_version": "2"}
    )
    result = await b.service.run(b.job_id)
    assert result["error"]["code"] == "EMBEDDING_DISCLOSURE_STALE"
    assert not any(e[0] in {"register", "embed", "write", "publish"} for e in b.events)


@pytest.mark.asyncio
async def test_provider_task_cancellation_propagates_and_releases_lock(pipeline):
    b = await pipeline()
    b.faults["embed"] = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await b.service.run(b.job_id)
    assert b.jobs[b.job_id]["state"] == "running"
    assert b.jobs[b.job_id]["submission_state"] == "unknown"
    assert not any(e[0] in {"write", "publish"} for e in b.events)
    assert b.events[-1] == ("unlock", "index-run:" + b.job_id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change,code",
    [
        (lambda b: b.faults.update(memberships=[]), "SCOPE_CHANGED"),
        (lambda b: b.membership.update(notebook_id="notebook:other"), "SCOPE_CHANGED"),
        (
            lambda b: b.membership.update(evidence_ids=["ev_0", "ev_0"]),
            "INDEX_INTEGRITY",
        ),
        (lambda b: b.faults.update(content=[]), "INDEX_INTEGRITY"),
        (lambda b: b.rows[0].update(quote_hash="0" * 64), "INDEX_INTEGRITY"),
        (lambda b: b.rows[0].update(quote=" "), "INDEX_INTEGRITY"),
        (lambda b: b.rows[0].update(notebook_id="notebook:other"), "INDEX_INTEGRITY"),
    ],
)
async def test_real_content_projection_rejects_bad_membership_before_dispatch(
    pipeline, change, code
):
    b = await pipeline(1)
    change(b)
    result = await b.service.run(b.job_id)
    assert result["error"]["code"] == code
    assert not any(e[0] in {"register", "embed", "write", "publish"} for e in b.events)


@pytest.mark.asyncio
async def test_preview_uses_exact_prefixed_utf8_bytes_and_creates_once(pipeline):
    b = await pipeline(2)
    first = await b.service.preview("notebook:one", ["sv_one"], b.profile.profile_id)
    second = await b.service.preview("notebook:one", ["sv_one"], b.profile.profile_id)
    assert first == second
    assert first.evidence_count == 2
    assert first.input_bytes == sum(
        len((b.profile.document_prefix + r["quote"]).encode()) for r in b.rows
    )
    assert first.warnings
    assert sum(e[:2] == ("commit", "index_preview") for e in b.events) == 1
    assert not any(e[0] == "embed" for e in b.events)


@pytest.fixture
def submission(pipeline):
    async def prepare(*, queue_error=None):
        b = await pipeline(2)
        b.jobs.clear()
        preview = await b.service.preview(
            "notebook:one", ["sv_one"], b.profile.profile_id
        )
        input_query = b.repository.query

        async def query(sql, params):
            if "index-jobs-status" in sql:
                return [
                    {"payload": deepcopy(value)}
                    for value in b.jobs.values()
                    if value.get("operation") == "index_evidence"
                    and value["source_version_id"] in params["version_ids"]
                ]
            return await input_query(sql, params)

        async def enqueue(kind, payload):
            identity = payload["job_id"]
            b.events.append(("enqueue", kind, identity))
            assert b.jobs[identity]["queue_dispatch_started"] is True
            assert b.jobs[identity]["dispatch_receipt"]["dispatch_ack"] == "unknown"
            if queue_error:
                raise queue_error
            return "worker-accepted"

        async def cancel(attempt):
            b.events.append(("cancel", attempt))

        b.repository.query = query
        b.repository.cancel_attempt = AsyncMock(side_effect=cancel)
        b.enqueue.side_effect = enqueue
        b.request = subject.IndexRequest(
            source_version_ids=["sv_one"],
            profile_id=b.profile.profile_id,
            preview_hash=preview.preview_hash,
            idempotency_key="regular-indexing",
            acknowledge_external_processing=True,
        )
        b.repository.assert_scope.reset_mock()
        b.events.clear()
        return b

    return prepare


@pytest.mark.asyncio
async def test_index_admission_hands_off_only_after_durable_scope_and_queue_claim(
    submission,
):
    b = await submission()

    receipt = await b.service.submit("notebook:one", b.request)

    [projection] = receipt.jobs
    [identity] = receipt.job_ids
    assert receipt.state == projection.state == "queued"
    assert projection.total_evidence == 2
    assert projection.completed_evidence == 0
    assert projection.source_version_id == "sv_one"
    assert receipt.profile_fingerprint == b.profile.fingerprint
    child = b.jobs[identity]
    assert child["worker_job_id"] == "worker-accepted"
    assert child["dispatch_receipt"]["dispatch_ack"] == "confirmed"
    assert child["version_snapshot"]["entries"][0]["version_id"] == "sv_one"
    assert b.jobs[receipt.group_id]["receipt"] == receipt.model_dump()
    b.repository.assert_scope.assert_awaited_with(b.snapshot)
    assert all(
        call.args == (b.snapshot,) for call in b.repository.assert_scope.await_args_list
    )
    b.enqueue.assert_awaited_once_with("index_evidence", {"job_id": identity})
    ordered = [event[:2] for event in b.events if event[0] in {"commit", "enqueue"}]
    assert ordered == [
        ("commit", "index_admit"),
        ("commit", "index_admit"),
        ("commit", "index_progress"),
        ("commit", "index_progress"),
        ("enqueue", "index_evidence"),
        ("commit", "index_progress"),
        ("commit", "index_progress"),
    ]
    assert not any(event[0] in {"embed", "write", "publish"} for event in b.events)


@pytest.mark.asyncio
async def test_index_submission_returns_saved_receipt_without_requeue(submission):
    b = await submission()
    first = await b.service.submit("notebook:one", b.request)
    events = b.events.copy()

    replay = await b.service.submit("notebook:one", b.request)

    assert replay == first
    b.enqueue.assert_awaited_once()
    assert [event for event in b.events[len(events) :] if event[0] == "commit"] == []


@pytest.mark.asyncio
async def test_index_same_intent_with_changed_preview_is_not_submitted_again(
    submission,
):
    b = await submission()
    first = await b.service.submit("notebook:one", b.request)
    changed = b.request.model_copy(update={"preview_hash": "c" * 64})

    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await b.service.submit("notebook:one", changed)

    b.enqueue.assert_awaited_once()
    assert b.jobs[first.group_id]["receipt"] == first.model_dump()


@pytest.mark.asyncio
async def test_index_submit_requires_current_preview_and_external_cost_confirmation(
    submission,
):
    b = await submission()
    changed = b.request.model_copy(update={"preview_hash": "c" * 64})
    missing_consent = b.request.model_copy(
        update={"acknowledge_external_processing": False}
    )

    with pytest.raises(InvalidInputError, match="PREVIEW_CHANGED"):
        await b.service.submit("notebook:one", changed)
    with pytest.raises(InvalidInputError, match="EMBEDDING_ACKNOWLEDGMENT_REQUIRED"):
        await b.service.submit("notebook:one", missing_consent)

    b.enqueue.assert_not_awaited()
    assert not any(event[0] == "commit" for event in b.events)


@pytest.mark.asyncio
async def test_index_queue_ack_loss_persists_unknown_without_silent_retry(submission):
    b = await submission(queue_error=OSError("queue receipt unavailable"))

    receipt = await b.service.submit("notebook:one", b.request)
    replay = await b.service.submit("notebook:one", b.request)

    [projection] = receipt.jobs
    assert receipt == replay
    assert receipt.state == projection.state == "submission_unknown"
    assert projection.error is not None
    assert projection.error["code"] == "QUEUE_ACK_UNKNOWN"
    assert projection.retry_safe is False
    assert b.jobs[receipt.group_id]["receipt"] == receipt.model_dump()
    b.enqueue.assert_awaited_once()


@pytest.mark.asyncio
async def test_new_explicit_index_retry_fences_old_attempt_before_admitting_replacement(
    submission,
):
    b = await submission(queue_error=OSError("queue receipt unavailable"))
    original = await b.service.submit("notebook:one", b.request)
    [original_child] = original.job_ids
    b.events.clear()
    b.enqueue.reset_mock()
    b.enqueue.side_effect = None
    b.enqueue.return_value = "retry-worker"
    next_request = b.request.model_copy(
        update={
            "idempotency_key": "explicit-retry",
            "retry_of_job_id": original_child,
            "acknowledge_duplicate_embedding_cost": True,
        }
    )

    retry = await b.service.submit("notebook:one", next_request)

    assert retry.state == "queued"
    assert retry.group_id != original.group_id
    [replacement_child] = retry.job_ids
    assert replacement_child != original_child
    assert b.jobs[original.group_id]["dispatch_stopped"] is True
    assert b.jobs[original.group_id]["dispatch_stop_reason"] == "explicit_retry"
    assert b.jobs[replacement_child]["retry_of_job_id"] == original_child
    assert b.jobs[replacement_child]["acknowledge_duplicate_embedding_cost"] is True
    b.repository.cancel_attempt.assert_awaited_once_with(original_child)
    b.enqueue.assert_awaited_once_with("index_evidence", {"job_id": replacement_child})
    ordering = [event[:2] for event in b.events if event[0] in {"commit", "cancel"}]
    assert ordering[:4] == [
        ("commit", "index_group_stop"),
        ("cancel", original_child),
        ("commit", "index_admit"),
        ("commit", "index_admit"),
    ]
