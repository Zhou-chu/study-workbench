"""Index status and retry decisions, isolated from storage/provider/queue I/O."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call

import pytest

from api import evidence_indexing as target
from open_notebook.domain.evidence_retrieval import (
    EmbeddingProfile,
    ScopeEntry,
    ScopeSnapshot,
)
from open_notebook.exceptions import InvalidInputError

pytestmark = pytest.mark.asyncio


@pytest.fixture
def state(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    profile = EmbeddingProfile(
        profile_id="p",
        model_id="model:x",
        provider="synthetic",
        model_name="synthetic",
        revision="1",
        endpoint="https://example.invalid",
        credential_binding_id="fixture",
        dimension=2,
        document_prefix="",
        query_prefix="",
        preprocessing_revision="evidence-identity-v1",
        max_input_bytes=1000,
        cosine_min_score=0,
        destination_descriptor_version="1",
        destination_kind="remote",
    )
    snapshot = ScopeSnapshot(
        notebook_id="notebook:one",
        entries=(
            ScopeEntry(
                version_id="sv_one",
                extraction_id="ex_one",
                manifest_hash="a" * 64,
                scope_epoch=1,
            ),
        ),
    )
    rows: dict[str, dict] = {}

    async def get(kind: str, identity: str) -> dict | None:
        assert kind == "job"
        return deepcopy(rows.get(identity))

    store = SimpleNamespace(
        get=AsyncMock(side_effect=get),
        project_lock=Mock(side_effect=AssertionError("No lock expected")),
    )
    repository = SimpleNamespace(
        query=AsyncMock(return_value=[]),
        capture_scope=AsyncMock(return_value=snapshot),
        status=AsyncMock(return_value={"state": "missing"}),
    )
    embeddings = SimpleNamespace(
        resolve_profile=Mock(return_value=profile),
        embed_documents=AsyncMock(side_effect=AssertionError("No model expected")),
    )
    queue = AsyncMock(side_effect=AssertionError("No queue expected"))
    configured: dict[str, object] = {}
    service = target.EvidenceIndexingService(
        store=store,
        repository=repository,
        embeddings=embeddings,
        submit=queue,
        profiles=lambda: configured,
    )
    monkeypatch.setattr(target, "hybrid_enabled", lambda: True)
    monkeypatch.setattr(
        target,
        "try_project_lock",
        Mock(side_effect=AssertionError("No owner probing expected")),
    )
    request = target.IndexRequest(
        source_version_ids=["sv_one"],
        profile_id="p",
        preview_hash="b" * 64,
        idempotency_key="new-key",
    )
    return SimpleNamespace(
        service=service,
        rows=rows,
        store=store,
        repository=repository,
        embeddings=embeddings,
        queue=queue,
        configured=configured,
        profile=profile,
        snapshot=snapshot,
        request=request,
    )


def old_job(s: SimpleNamespace, state: str = "failed") -> dict:
    return {
        "job_id": "old",
        "group_id": "group",
        "operation": "index_evidence",
        "notebook_id": "notebook:one",
        "source_version_id": "sv_one",
        "state": state,
        "profile_id": "p",
        "profile_fingerprint": s.profile.fingerprint,
        "idempotency_key": "old-key",
    }


def no_dispatch(s: SimpleNamespace) -> None:
    s.queue.assert_not_awaited()
    s.embeddings.embed_documents.assert_not_awaited()
    s.store.project_lock.assert_not_called()


@pytest.mark.parametrize(
    "states,expected",
    [
        (["succeeded", "succeeded"], "succeeded"),
        (["failed", "succeeded"], "failed"),
        (["cancelled_local", "succeeded"], "cancelled_local"),
        (["running", "failed"], "running"),
        (["queued", "failed"], "queued"),
        (["submission_unknown", "running"], "submission_unknown"),
        ([], "submission_unknown"),
        (["future_state"], "submission_unknown"),
    ],
)
async def test_group_reconciliation_projects_children_without_replaying_history(
    state: SimpleNamespace, states: list[str], expected: str
) -> None:
    s = state
    ids = [f"child_{i}" for i in range(len(states))]
    s.rows["group"] = {
        "job_id": "group",
        "operation": "index_evidence_group",
        "job_ids": ids,
        "version_ids": [f"sv_{i}" for i in range(len(states))],
        "state": "queued",
    }
    for identity, value in zip(ids, states):
        s.rows[identity] = {
            **old_job(s, value),
            "job_id": identity,
            "restored_history": True,
            "worker_job_id": "historical",
            "completed_evidence": 3,
            "total_evidence": 5,
        }
    before = deepcopy(s.rows)
    result = await s.service.reconcile("group")
    assert result["state"] == expected
    assert [j["job_id"] for j in result["jobs"]] == ids
    assert [j["state"] for j in result["jobs"]] == states
    assert all(
        j["completed_evidence"] == 3 and j["total_evidence"] == 5
        for j in result["jobs"]
    )
    assert result["retry_safe"] is result["remote_cancel_confirmed"] is False
    assert s.rows == before
    no_dispatch(s)


async def test_missing_child_retains_version_and_unknown_instead_of_group_success(
    state: SimpleNamespace,
) -> None:
    s = state
    s.rows["group"] = {
        "job_id": "group",
        "operation": "index_evidence_group",
        "job_ids": ["gone"],
        "version_ids": ["sv_missing"],
    }
    result = await s.service.reconcile("group")
    child = result["jobs"][0]
    assert (result["state"], child["source_version_id"], child["error"]["code"]) == (
        "submission_unknown",
        "sv_missing",
        "INDEX_JOB_MISSING",
    )
    assert child["retry_safe"] is child["remote_cancel_confirmed"] is False
    no_dispatch(s)


async def test_status_uses_captured_scope_and_sorted_metadata_without_model_work(
    state: SimpleNamespace,
) -> None:
    s = state
    s.configured.update({"z": object(), "a": object()})
    profiles = {
        name: s.profile.model_copy(update={"profile_id": name}) for name in s.configured
    }
    s.embeddings.resolve_profile.side_effect = profiles.__getitem__
    s.rows["old"] = {**old_job(s, "cancelled_local"), "restored_history": True}
    s.repository.query.return_value = [{"payload": s.rows["old"]}]
    result = await s.service.status("notebook:one", ["sv_one"])
    assert result["snapshot"] == s.snapshot.model_dump()
    assert [p["profile"]["profile_id"] for p in result["profiles"]] == ["a", "z"]
    assert all(p["index"] == {"state": "missing"} for p in result["profiles"])
    assert result["jobs"][0]["state"] == "cancelled_local"
    assert result["enabled"] is True and result["retry_safe"] is False
    s.repository.capture_scope.assert_awaited_once_with("notebook:one", ["sv_one"])
    assert s.repository.status.await_args_list == [
        call(s.snapshot, profiles["a"]),
        call(s.snapshot, profiles["z"]),
    ]
    sql, params = s.repository.query.await_args.args
    assert "payload.operation = 'index_evidence'" in sql
    assert params == {"notebook_id": "notebook:one", "version_ids": ["sv_one"]}
    no_dispatch(s)


@pytest.mark.parametrize(
    "terminal", ["failed", "submission_unknown", "cancelled_local"]
)
async def test_explicit_retry_accepts_prior_uncertain_attempt_without_enqueuing(
    state: SimpleNamespace, terminal: str
) -> None:
    s = state
    s.rows["old"] = old_job(s, terminal)
    s.repository.query.return_value = [{"payload": s.rows["old"]}]
    request = s.request.model_copy(
        update={"retry_of_job_id": "old", "acknowledge_duplicate_embedding_cost": True}
    )
    result = await s.service._retry("notebook:one", request, s.snapshot, s.profile)
    assert result == s.rows["old"] and result is not s.rows["old"]
    no_dispatch(s)


@pytest.mark.parametrize(
    "value,code",
    [
        ("queued", "INDEX_ATTEMPT_EXISTS"),
        ("running", "INDEX_ATTEMPT_EXISTS"),
        ("failed", "INDEX_RETRY_REQUIRED"),
        ("submission_unknown", "INDEX_RETRY_REQUIRED"),
        ("cancelled_local", "INDEX_RETRY_REQUIRED"),
    ],
)
async def test_implicit_retry_cannot_duplicate_active_or_uncertain_work(
    state: SimpleNamespace, value: str, code: str
) -> None:
    s = state
    s.repository.query.return_value = [{"payload": old_job(s, value)}]
    with pytest.raises(InvalidInputError, match=code):
        await s.service._retry("notebook:one", s.request, s.snapshot, s.profile)
    no_dispatch(s)


@pytest.mark.parametrize(
    "changes",
    [
        {"restored_history": True},
        {"profile_fingerprint": "different"},
        {"state": "succeeded"},
    ],
)
async def test_old_history_or_other_profile_does_not_block_new_attempt(
    state: SimpleNamespace, changes: dict
) -> None:
    s = state
    s.repository.query.return_value = [{"payload": {**old_job(s), **changes}}]
    assert (
        await s.service._retry("notebook:one", s.request, s.snapshot, s.profile) is None
    )
    no_dispatch(s)


@pytest.mark.parametrize(
    "mode",
    [
        "cost_without_reference",
        "reference_without_cost",
        "same_key",
        "historical",
        "wrong_scope",
    ],
)
async def test_retry_requires_explicit_reference_cost_and_matching_scope(
    state: SimpleNamespace, mode: str
) -> None:
    s = state
    s.rows["old"] = old_job(s)
    updates: dict[str, object] = {
        "retry_of_job_id": "old",
        "acknowledge_duplicate_embedding_cost": True,
    }
    if mode == "cost_without_reference":
        updates["retry_of_job_id"] = None
    elif mode == "reference_without_cost":
        updates["acknowledge_duplicate_embedding_cost"] = False
    elif mode == "same_key":
        updates["idempotency_key"] = "old-key"
    elif mode == "historical":
        s.rows["old"]["restored_history"] = True
    else:
        s.rows["old"]["source_version_id"] = "sv_other"
    request = s.request.model_copy(update=updates)
    with pytest.raises(
        InvalidInputError,
        match="INDEX_RETRY_REFERENCE_REQUIRED"
        if mode == "cost_without_reference"
        else "INDEX_RETRY_INVALID",
    ):
        await s.service._retry("notebook:one", request, s.snapshot, s.profile)
    s.repository.query.assert_not_awaited()
    no_dispatch(s)


async def test_status_cancellation_does_not_return_partial_profiles(
    state: SimpleNamespace,
) -> None:
    s = state
    s.configured["p"] = object()
    error = asyncio.CancelledError()
    s.repository.status.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await s.service.status("notebook:one", ["sv_one"])
    assert caught.value is error
    s.repository.query.assert_not_awaited()
    no_dispatch(s)
