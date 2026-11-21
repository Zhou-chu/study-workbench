"""Remote-only chat state and restart tests using in-memory store and fake bridge."""

import pytest
from v1_notebooklm_helpers import FakeBridge, MemoryStore

from api.notebooklm_service import NotebookLMService
from open_notebook.integrations.notebooklm.contracts import (
    BridgeAnswer,
    BridgeError,
    RemoteReference,
)


@pytest.mark.asyncio
async def test_remote_citation_outside_selected_scope_never_gets_local_locator():
    bridge = FakeBridge()
    bridge.answer = BridgeAnswer(
        answer="A fact",
        conversation_id="c",
        references=[RemoteReference(remote_source_id="b", quote="A fact")],
    )
    app = NotebookLMService(store=MemoryStore(), bridge=bridge, enqueue=None)
    result = await app.ask(
        {
            "notebook_id": "notebook:local",
            "selection_origin": "remote",
            "remote_source_ids": ["a"],
            "remote_notebook_id": "nb",
            "message": "Question",
            "idempotency_key": "ask",
        }
    )
    citation = result["citations"][0]
    assert citation["reference_validity"] == "out_of_scope"
    assert citation["locator"] is None
    assert citation["evidence_id"] is None


@pytest.mark.asyncio
async def test_lost_chat_reply_never_reasks_on_same_idempotency_key():
    bridge = FakeBridge()
    bridge.error = BridgeError("REMOTE_UNAVAILABLE", "lost", submission_state="unknown")
    app = NotebookLMService(store=MemoryStore(), bridge=bridge, enqueue=None)
    request = {
        "notebook_id": "notebook:local",
        "selection_origin": "remote",
        "remote_source_ids": ["a"],
        "remote_notebook_id": "nb",
        "message": "Question",
        "idempotency_key": "ask",
    }
    with pytest.raises(BridgeError):
        await app.ask(request)
    bridge.error = None
    with pytest.raises(BridgeError):
        await app.ask(request)
    assert bridge.ask_calls == 1


@pytest.mark.asyncio
async def test_confirmed_chat_restart_finishes_from_saved_answer_without_reasking():
    bridge = FakeBridge()
    app = NotebookLMService(store=MemoryStore(), bridge=bridge, enqueue=None)
    request = {
        "notebook_id": "notebook:local",
        "selection_origin": "remote",
        "remote_source_ids": ["a"],
        "remote_notebook_id": "nb",
        "message": "Question",
        "idempotency_key": "ask",
    }
    result = await app.ask(request)
    job = await app.job(result["job_id"])
    job.update(
        state="running",
        lease_until="2000-01-01T00:00:00+00:00",
        result={
            "answer": "Answer",
            "conversation_id": "conversation",
            "references": [],
        },
    )
    await app.store.put("job", job["job_id"], job)
    await app.dispatch_due_jobs()
    recovered = await app.poll_job(job["job_id"])
    assert recovered["state"] == "succeeded"
    assert recovered["result"]["answer"] == "Answer"
    assert bridge.ask_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "support", ["unsupported", "unverified", "temporarily_unavailable", None]
)
@pytest.mark.parametrize("recover", [False, True], ids=["queued", "recovered"])
async def test_pending_chat_rechecks_strict_capability_before_submission(
    support, recover
):
    """A formerly admitted job must not submit after its capability is withdrawn."""
    from open_notebook.integrations.notebooklm.contracts import (
        Capability,
        CapabilityMatrix,
    )

    class ChangedBridge(FakeBridge):
        async def capabilities(self):
            operations = (
                [] if support is None else [Capability(name="ask", support=support)]
            )
            return CapabilityMatrix(operations=operations)

    bridge = ChangedBridge()
    app = NotebookLMService(store=MemoryStore(), bridge=bridge, enqueue=None)
    request = await app.resolve_scope(
        {
            "notebook_id": "notebook:local",
            "selection_origin": "remote",
            "remote_source_ids": ["a"],
            "remote_notebook_id": "nb",
            "message": "Question",
            "idempotency_key": "previously-admitted",
        }
    )
    request["chat_session_id"] = "chat"
    job = await app.create_job("notebook:local", "ask", request, "previously-admitted")
    if recover:
        job.update(state="running", lease_until="2000-01-01T00:00:00+00:00")
        await app.store.put("job", job["job_id"], job)
        await app.dispatch_due_jobs()
    result = await app.run_job(job["job_id"])
    assert result["state"] == "failed"
    assert result["error"]["code"] == "SCOPE_ISOLATION_UNAVAILABLE"
    assert result["submission_state"] == "not_submitted"
    assert bridge.ask_calls == 0
    assert result["remote_task_id"] is None


@pytest.mark.asyncio
async def test_confirmed_chat_recovery_does_not_require_current_ask_capability():
    """Reconstructing a saved answer must not be confused with a new submission."""
    from open_notebook.integrations.notebooklm.contracts import (
        Capability,
        CapabilityMatrix,
    )

    class ChangedBridge(FakeBridge):
        support = "available"

        async def capabilities(self):
            return CapabilityMatrix(
                operations=[Capability(name="ask", support=self.support)]
            )

    bridge = ChangedBridge()
    app = NotebookLMService(store=MemoryStore(), bridge=bridge, enqueue=None)
    result = await app.ask(
        {
            "notebook_id": "notebook:local",
            "selection_origin": "remote",
            "remote_source_ids": ["a"],
            "remote_notebook_id": "nb",
            "message": "Question",
            "idempotency_key": "saved-answer",
        }
    )
    job = await app.job(result["job_id"])
    job.update(
        state="running",
        lease_until="2000-01-01T00:00:00+00:00",
        result={
            "answer": "Persisted answer",
            "conversation_id": "conversation",
            "references": [],
        },
    )
    await app.store.put("job", job["job_id"], job)
    bridge.support = "unsupported"
    await app.dispatch_due_jobs()
    recovered = await app.poll_job(job["job_id"])
    assert recovered["state"] == "succeeded"
    assert recovered["result"]["answer"] == "Persisted answer"
    assert bridge.ask_calls == 1
