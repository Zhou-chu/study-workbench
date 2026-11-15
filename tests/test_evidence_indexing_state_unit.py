"""Direct indexing state machine units with all persistence/lock/provider I/O replaced."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from api import evidence_indexing as subject
from open_notebook.domain.evidence_retrieval import EmbeddingProfile
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)


@pytest.fixture
def boundary(monkeypatch):
    rows = {}
    events = []
    faults = {}

    @asynccontextmanager
    async def lock(key):
        events.append(("enter", key))
        try:
            yield
        finally:
            events.append(("exit", key))

    @asynccontextmanager
    async def probe(key):
        events.append(("probe", key))
        try:
            yield faults.get(key, True)
        finally:
            events.append(("probe_exit", key))

    async def get(kind, identity):
        assert kind == "job"
        if faults.get("read"):
            raise faults["read"]
        return deepcopy(rows.get(identity))

    async def transaction(_sql, params, *, operation):
        events.append(("transaction", operation))
        if faults.get(operation):
            raise faults[operation]
        for write in params["job_writes"]:
            rows[write["identity"]] = deepcopy(write["value"])

    repository = SimpleNamespace(
        cancel_attempt=AsyncMock(),
        status=AsyncMock(return_value={"state": "missing", "manifests": []}),
    )
    provider = SimpleNamespace(
        resolve_profile=Mock(
            side_effect=AssertionError("No provider resolution expected")
        ),
        embed_documents=AsyncMock(side_effect=AssertionError("No embedding expected")),
    )
    enqueue = AsyncMock(side_effect=AssertionError("No automatic queue expected"))
    service = subject.EvidenceIndexingService(
        store=SimpleNamespace(get=get, project_lock=lock),
        repository=repository,
        embeddings=provider,
        submit=enqueue,
        profiles=lambda: {},
    )
    monkeypatch.setattr(subject, "project_lock", lock)
    monkeypatch.setattr(subject, "try_project_lock", probe)
    monkeypatch.setattr(subject, "_transaction", transaction)
    monkeypatch.setattr(subject, "hybrid_enabled", lambda: True)
    monkeypatch.setattr(subject, "now", lambda: "2026-01-01T00:00:00Z")
    return SimpleNamespace(
        service=service,
        rows=rows,
        events=events,
        faults=faults,
        repository=repository,
        provider=provider,
        enqueue=enqueue,
    )


def seed(b, **changes):
    profile = EmbeddingProfile(
        profile_id="synthetic",
        model_id="model:x",
        provider="synthetic",
        model_name="synthetic",
        revision="1",
        endpoint="https://example.invalid/v1",
        credential_binding_id="synthetic-only",
        dimension=2,
        document_prefix="",
        query_prefix="",
        preprocessing_revision="evidence-identity-v1",
        max_input_bytes=1000,
        cosine_min_score=0.0,
        destination_descriptor_version="1",
        destination_kind="remote",
    )
    row = {
        "job_id": "job_child",
        "group_id": "job_group",
        "notebook_id": "notebook:one",
        "operation": "index_evidence",
        "state": "queued",
        "revision": 1,
        "queue_dispatch_started": True,
        "attempts": 0,
        "dispatch_started": False,
        "total_evidence": 3,
        "profile": profile.model_dump(exclude={"fingerprint", "endpoint_fingerprint"}),
        "version_snapshot": {
            "notebook_id": "notebook:one",
            "entries": [
                {
                    "version_id": "sv_one",
                    "extraction_id": "ex_one",
                    "manifest_hash": "a" * 64,
                    "scope_epoch": 1,
                }
            ],
        },
        **changes,
    }
    b.rows["job_child"] = row
    b.rows["job_group"] = {
        "job_id": "job_group",
        "notebook_id": "notebook:one",
        "operation": "index_evidence_group",
        "job_ids": ["job_child"],
        "version_ids": ["sv_one"],
        "revision": 1,
    }
    return row


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["run", "cancel", "reconcile"])
async def test_missing_job_is_not_found_without_dispatch(boundary, method):
    with pytest.raises(NotFoundError):
        await getattr(boundary.service, method)("missing")
    boundary.enqueue.assert_not_awaited()
    boundary.provider.embed_documents.assert_not_awaited()


@pytest.mark.asyncio
async def test_store_error_is_metadata_only_and_cancelled_reads_propagate(boundary):
    boundary.faults["read"] = RuntimeError("SYNTHETIC_SECRET")
    with pytest.raises(
        DatabaseOperationError, match="^INDEX_READ_UNAVAILABLE$"
    ) as error:
        await boundary.service._job("job_child")
    assert error.value.__cause__ is None
    assert "SYNTHETIC_SECRET" not in str(error.value)
    boundary.faults["read"] = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await boundary.service._job("job_child")


@pytest.mark.asyncio
async def test_store_identity_mismatch_cannot_be_used(boundary):
    seed(boundary, job_id="wrong")
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await boundary.service._job("job_child")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"state": "succeeded"},
        {"state": "failed"},
        {"state": "cancelled_local"},
        {"state": "submission_unknown"},
        {"restored_history": True},
        {"replay_allowed": False},
    ],
)
async def test_terminal_or_historical_worker_never_replays(boundary, changes):
    original = deepcopy(seed(boundary, **changes))
    assert await boundary.service.run("job_child") == original
    assert not any(e[0] == "transaction" for e in boundary.events)
    boundary.provider.resolve_profile.assert_not_called()
    boundary.enqueue.assert_not_awaited()
    assert boundary.events[-1] == ("exit", "index-run:job_child")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"state": "running"},
        {"queue_dispatch_started": False},
        {"attempts": 1},
        {"dispatch_started": True},
    ],
)
async def test_unowned_or_previously_started_attempt_becomes_unknown_not_replayed(
    boundary, changes
):
    seed(boundary, **changes)
    result = await boundary.service.run("job_child")
    assert result["state"] == "submission_unknown"
    assert result["error"]["code"] == "INDEX_ATTEMPT_INTERRUPTED"
    assert result["revision"] == 2
    boundary.provider.resolve_profile.assert_not_called()
    boundary.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_feature_is_confirmed_local_failure_before_provider(
    boundary, monkeypatch
):
    seed(boundary)
    monkeypatch.setattr(subject, "hybrid_enabled", lambda: False)
    result = await boundary.service.run("job_child")
    assert (result["state"], result["submission_state"]) == ("failed", "not_submitted")
    assert result["error"]["code"] == "FEATURE_DISABLED"
    assert result["attempts"] == 1
    boundary.provider.resolve_profile.assert_not_called()


@pytest.mark.asyncio
async def test_malformed_captured_job_fails_closed_without_provider(boundary):
    seed(boundary, request_snapshot={"private": "SYNTHETIC_SECRET"})
    result = await boundary.service.run("job_child")
    assert result["state"] == "failed"
    assert result["error"]["code"] == "INDEX_INTEGRITY"
    assert "SYNTHETIC_SECRET" not in str(result["error"])
    boundary.provider.resolve_profile.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("started", [False, True])
async def test_cancel_confirms_local_fence_but_never_remote_cancellation(
    boundary, started
):
    seed(boundary, state="running", dispatch_started=started)
    result = await boundary.service.cancel("job_child")
    assert result["state"] == "cancelled_local"
    assert result["cancel_requested"] is True
    assert result["cancellation_fence_confirmed"] is True
    assert result["remote_may_continue"] is started
    assert result["remote_cancel_confirmed"] is False
    assert boundary.rows["job_group"]["dispatch_stopped"] is True
    boundary.repository.cancel_attempt.assert_awaited_once_with("job_child")
    boundary.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_group_stop_ack_prevents_child_cancellation(boundary):
    seed(boundary)
    boundary.faults["index_group_stop"] = DatabaseOperationError("INDEX_COMMIT_UNKNOWN")
    with pytest.raises(DatabaseOperationError):
        await boundary.service.cancel("job_child")
    assert boundary.rows["job_child"]["state"] == "queued"
    boundary.repository.cancel_attempt.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_fence_failure_stays_unconfirmed_on_repeat(boundary):
    seed(boundary, dispatch_started=True)
    boundary.repository.cancel_attempt.side_effect = DatabaseOperationError(
        "INDEX_COMMIT_UNKNOWN"
    )
    with pytest.raises(DatabaseOperationError):
        await boundary.service.cancel("job_child")
    assert boundary.rows["job_child"]["state"] == "cancelled_local"
    assert not boundary.rows["job_child"].get("cancellation_fence_confirmed")
    with pytest.raises(DatabaseOperationError, match="INDEX_COMMIT_UNKNOWN"):
        await boundary.service._cancel_child("job_child")
    assert boundary.repository.cancel_attempt.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["succeeded", "failed", "cancelled_local"])
async def test_cancel_child_preserves_confirmed_terminal_record(boundary, state):
    original = deepcopy(seed(boundary, state=state, cancellation_fence_confirmed=True))
    assert await boundary.service._cancel_child("job_child") == original
    boundary.repository.cancel_attempt.assert_not_awaited()
    assert not any(e[0] == "transaction" for e in boundary.events)


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["index-submit:job_group", "index-run:job_child"])
async def test_live_owner_exposes_uncertainty_without_mutating_queued_job(
    boundary, owner
):
    original = deepcopy(seed(boundary))
    boundary.faults[owner] = False
    result = await boundary.service.reconcile("job_child")
    assert result["state"] == "submission_unknown"
    assert result["error"]["code"] == "QUEUE_ACK_UNKNOWN"
    assert boundary.rows["job_child"] == original
    boundary.repository.status.assert_not_awaited()
    boundary.enqueue.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state,code",
    [("queued", "QUEUE_ACK_UNKNOWN"), ("running", "INDEX_ATTEMPT_INTERRUPTED")],
)
async def test_dead_owner_reconciles_without_queue_or_provider(boundary, state, code):
    seed(boundary, state=state)
    result = await boundary.service.reconcile("job_child")
    assert result["state"] == "submission_unknown"
    assert result["error"]["code"] == code
    boundary.repository.status.assert_awaited_once()
    snapshot, profile = boundary.repository.status.await_args.args
    assert (
        snapshot.model_dump(mode="json")
        == boundary.rows["job_child"]["version_snapshot"]
    )
    assert (
        profile.model_dump(exclude={"fingerprint", "endpoint_fingerprint"})
        == boundary.rows["job_child"]["profile"]
    )
    boundary.enqueue.assert_not_awaited()
    boundary.provider.resolve_profile.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "attempt,expected",
    [("job_child", "succeeded"), ("job_other", "submission_unknown")],
)
async def test_unknown_only_its_own_manifest_can_confirm_success(
    boundary, attempt, expected
):
    seed(boundary, state="submission_unknown")
    boundary.repository.status.return_value = {
        "state": "ready",
        "manifests": [{"attempt_id": attempt}],
    }
    result = await boundary.service.reconcile("job_child")
    assert result["state"] == expected
    if expected == "succeeded":
        assert result["completed_evidence"] == 3
        assert result["submission_state"] == "confirmed"
    boundary.enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_reconciliation_never_relabels_success_from_manifest(boundary):
    seed(boundary, state="submission_unknown", cancel_requested=True)
    result = await boundary.service.reconcile("job_child")
    assert result["state"] == "submission_unknown"
    boundary.repository.status.assert_not_awaited()


@pytest.mark.asyncio
async def test_task_cancellation_releases_owned_locks_without_invented_success(
    boundary,
):
    seed(boundary)
    boundary.faults["index_progress"] = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await boundary.service.run("job_child")
    assert boundary.rows["job_child"]["state"] == "queued"
    assert boundary.events[-2:] == [
        ("exit", "notebook:one"),
        ("exit", "index-run:job_child"),
    ]
    boundary.provider.embed_documents.assert_not_awaited()
