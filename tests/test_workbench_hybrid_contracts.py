"""Actual route/queue/grounded integration using isolated repository/provider fakes."""

import json
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
import pytest_asyncio
from test_v1_evidence_ingest import MemoryStore
from test_workbench_hybrid_retrieval import NB, Harness

from api.personal_contracts import DurableJobResponse, WorkspaceResponse
from api.personal_service import PersonalService
from api.routers import evidence as routes
from open_notebook.database.project_locks import project_lock
from open_notebook.exceptions import InvalidInputError, PersonalTurnDispatchUnknownError
from open_notebook.graphs.grounded_chat import GroundedChatService


def hybrid(h, **changes):
    return {
        "notebook_id": NB,
        "engine": "independent",
        "message": "quasar",
        "query": "quasar",
        "selection_origin": "local",
        "source_version_ids": ["v1"],
        "idempotency_key": "same",
        "retrieval_mode": "hybrid",
        "embedding_profile_id": h.provider.profile.profile_id,
        "acknowledge_query_processing": True,
        "disclosed_profile_fingerprint": h.provider.profile.fingerprint,
        "destination_descriptor_version": h.provider.profile.destination_descriptor_version,
        **changes,
    }


@pytest_asyncio.fixture
async def h(tmp_path, monkeypatch):
    value = Harness(tmp_path, monkeypatch)
    await value.add("v1", ["Solar electricity.", "Wind energy."])
    await value.index(["v1"])

    # Grounded history/jobs may list their own records; content listing stays forbidden.
    async def listing(kind, *args, **kwargs):
        assert kind in {"turn", "job"}
        return await MemoryStore.list(value.store, kind, *args, **kwargs)

    monkeypatch.setattr(value.store, "list", listing)
    monkeypatch.setattr(
        routes, "EvidenceRetrievalService", lambda: value.service, raising=False
    )
    return value


@pytest.mark.asyncio
async def test_hybrid_search_requires_notebook_and_ack(h):
    for missing in (
        "notebook_id",
        "acknowledge_query_processing",
        "disclosed_profile_fingerprint",
        "destination_descriptor_version",
    ):
        body = hybrid(h)
        body.pop(missing)
        with pytest.raises((InvalidInputError, ValueError)):
            await routes.search(body)
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_old_lexical_search_has_no_provider_calls(h, monkeypatch):
    monkeypatch.setattr(routes, "EvidenceService", lambda: h.evidence)
    body: Any = {"query": "electricity", "source_version_ids": ["v1"]}
    expected = await h.evidence.retrieve("electricity", ["v1"])
    assert await routes.search(body) == {"hits": expected}
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_zero_hits_skips_generation_but_reports_query_embedding(h):
    h.provider.vector = [-1.0, 0.0]
    calls = []

    async def model(messages):
        calls.append(messages)
        raise AssertionError("No-hit retrieval must not generate")

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    turn = await chat.turn(NB, "zero", hybrid(h))
    assert calls == []
    assert len(h.provider.calls) == 1
    assert turn["retrieval"]["retrieval_method"] == "hybrid"
    assert turn["grounding_status"] == "insufficient_evidence"
    assert "retrieval" in turn["answer"].lower()
    assert (await h.store.get("turn", turn["turn_id"]))["retrieval"] == turn[
        "retrieval"
    ]


@pytest.mark.asyncio
async def test_outline_never_embeds(h, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Outline must not call retrieval")

    monkeypatch.setattr(h.service, "retrieve", forbidden)

    async def model(messages):
        return {"answer": "Outline", "citations": []}

    turn = await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(
        NB,
        "outline",
        hybrid(
            h,
            task="outline",
            retrieval_mode="lexical",
            embedding_profile_id=None,
            acknowledge_query_processing=False,
            disclosed_profile_fingerprint=None,
            destination_descriptor_version=None,
        ),
    )
    assert turn["retrieval"]["retrieval_method"] == "selected_overview"
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["unlink", "reparse", "not_ready"])
async def test_scope_recheck_before_generation(h, monkeypatch, change):
    calls = []
    original = GroundedChatService._messages

    def messages(*args):
        result = original(*args)
        if change == "unlink":
            h.db.members.clear()
        elif change == "not_ready":
            h.store.data[("version", "v1")]["status"] = "failed"
        else:
            h.store.data[("version", "v1")]["current_extraction_id"] = "ex_changed"
        return result

    async def model(messages):
        calls.append(messages)
        return {"answer": "unsafe", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    monkeypatch.setattr(chat, "_messages", messages)
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "changed", hybrid(h))
    assert calls == []
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("retrieval_mode", "lexical"),
        ("embedding_profile_id", "other"),
        ("disclosed_profile_fingerprint", "b" * 64),
        ("destination_descriptor_version", "new"),
    ],
)
async def test_mode_or_profile_change_conflicts_same_turn_key(h, field, value):
    async def submit(*args):
        return "command:fake"

    service = PersonalService(store=h.store, submit=submit)
    body = hybrid(h)
    await service.submit_turn("chat", body)
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await service.submit_turn("chat", {**body, field: value})


@pytest.mark.asyncio
async def test_queued_turn_keeps_disclosed_fingerprint_and_rejects_rotated_destination(
    h, monkeypatch
):
    async def submit(*args):
        return "command:fake"

    body = hybrid(h)
    body.pop("query")
    service = PersonalService(store=h.store, submit=submit)
    job = await service.submit_turn("queued", body)
    pinned = deepcopy(job["request_snapshot"])
    h.provider.profile = h.provider.profile.model_copy(
        update={"endpoint": "https://rotated.invalid/v1"}
    )
    monkeypatch.setattr(
        "open_notebook.graphs.grounded_chat.GroundedChatService",
        lambda **kw: GroundedChatService(
            evidence_service=h.evidence, retrieval_service=h.service
        ),
    )
    result = await service.run_turn(job["job_id"])
    assert result["state"] == "failed"
    assert "EMBEDDING_DISCLOSURE_STALE" in str(result["error"])
    assert result["request_snapshot"] == pinned
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_model_cannot_cite_unsupplied_semantic_evidence(h):
    h.db.vectors[1]["vector"] = [-1.0, 0.0]

    async def model(messages):
        supplied = json.loads(messages[-1]["content"])["evidence"]
        assert [e["evidence_id"] for e in supplied] == ["v1_0000"]
        return {
            "answer": "Forged [c1]",
            "citations": [{"citation_id": "c1", "evidence_id": "v1_0001"}],
        }

    turn = await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(NB, "forged", hybrid(h))
    assert turn["citations"][0]["reference_validity"] != "verified"
    assert turn["grounding_status"] == "unverified"


@pytest.mark.asyncio
async def test_fallback_metadata_survives_response_models_and_persistence(h):
    h.enabled = False

    async def model(messages):
        return {"answer": "An excerpt", "citations": []}

    body = hybrid(h, message="electricity", query="electricity")
    search = await routes.search(body)
    assert search["retrieval"]["retrieval_method"] == "lexical_fallback"
    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    turn = await chat.turn(NB, "fallback", body)
    assert turn["retrieval"] == search["retrieval"]
    saved = await h.store.get("turn", turn["turn_id"])
    job = {
        "job_id": "job",
        "notebook_id": NB,
        "operation": "chat",
        "state": "succeeded",
        "result": saved,
    }
    assert (
        DurableJobResponse.model_validate(job).model_dump()["result"]["retrieval"]
        == search["retrieval"]
    )
    workspace = {
        "notebook": {"id": NB, "name": "fake"},
        "sources": [],
        "notes": [],
        "turns": [saved],
        "jobs": [job],
        "link": None,
        "selection": None,
        "legacy_history": [],
    }
    assert (
        WorkspaceResponse.model_validate(workspace).model_dump()["turns"][0][
            "retrieval"
        ]
        == search["retrieval"]
    )
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_explicit_lexical_uses_new_scope_service_but_omitted_keeps_legacy_hash(
    h, monkeypatch
):
    calls = []
    original = h.service.retrieve

    async def retrieve(*args, **kwargs):
        calls.append(kwargs)
        return await original(*args, **kwargs)

    monkeypatch.setattr(h.service, "retrieve", retrieve)

    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    omitted = {
        "engine": "independent",
        "message": "electricity",
        "source_version_ids": ["v1"],
        "idempotency_key": "legacy",
    }
    await chat.turn(NB, "lexical", omitted)
    assert calls == []
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await chat.turn(NB, "lexical", {**omitted, "retrieval_mode": "lexical"})
    await chat.turn(
        NB,
        "lexical",
        {**omitted, "idempotency_key": "modern", "retrieval_mode": "lexical"},
    )
    assert len(calls) == 1
    assert calls[0]["mode"] == "lexical"
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_legacy_scope_rechecked_before_content_and_after_prompt(h, monkeypatch):
    calls = []

    async def model(messages):
        calls.append(messages)
        return {"answer": "unsafe", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    body = {
        "engine": "independent",
        "message": "electricity",
        "source_version_ids": ["v1"],
        "idempotency_key": "legacy",
    }
    h.db.members.clear()
    h.store.reads.clear()
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "legacy", body)
    assert h.store.reads == []
    assert calls == []


@pytest.mark.asyncio
async def test_hybrid_turn_keeps_exact_submitted_query(h):
    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    message = "  quasar  "
    await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(NB, "exact", hybrid(h, message=message))
    assert h.provider.calls[0][1] == message


@pytest.mark.asyncio
async def test_hybrid_turn_route_rejects_rotated_disclosure_before_queue(
    h, monkeypatch
):
    from types import SimpleNamespace

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    monkeypatch.setattr(routes.Notebook, "get", notebook_get)
    monkeypatch.setattr(routes, "EvidenceService", lambda: h.evidence)
    queued = []

    async def submit(*args):
        queued.append(args)
        return "command:fake"

    service = PersonalService(store=h.store, submit=submit)
    monkeypatch.setattr(routes, "PersonalService", lambda: service)
    request = routes.TurnRequest.model_validate(hybrid(h))
    h.provider.profile = h.provider.profile.model_copy(
        update={"endpoint": "https://rotated.invalid/v1"}
    )
    with pytest.raises(InvalidInputError, match="EMBEDDING_DISCLOSURE_STALE"):
        await routes.turn("route", request)
    assert queued == h.provider.calls == []


@pytest.mark.asyncio
async def test_generation_scope_rechecked_after_model_provision(h, monkeypatch):
    from types import SimpleNamespace

    calls = []

    async def invoke(messages):
        calls.append(messages)
        return {"answer": "unsafe", "citations": []}

    async def provision(*args, **kwargs):
        h.db.members.clear()
        return SimpleNamespace(ainvoke=invoke)

    monkeypatch.setattr(
        "open_notebook.graphs.grounded_chat.provision_langchain_model", provision
    )
    chat = GroundedChatService(evidence_service=h.evidence, retrieval_service=h.service)
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "provision", hybrid(h, model_id="model:chat"))
    assert calls == []


@pytest.mark.asyncio
async def test_http_search_retains_metadata_and_explicit_lexical_has_no_embeddings(h):
    import httpx
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        body = {
            "notebook_id": NB,
            "query": "electricity",
            "source_version_ids": ["v1"],
            "retrieval_mode": "lexical",
        }
        response = await client.post("/api/personal/search", json=body)
        assert response.status_code == 200
        assert response.json()["retrieval"]["retrieval_method"] == "lexical"
        bad = hybrid(h)
        bad.pop("disclosed_profile_fingerprint")
        assert (await client.post("/api/personal/search", json=bad)).status_code == 422
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_grounded_same_key_changed_mode_conflicts_before_new_dispatch(h):
    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    body = hybrid(h)
    await chat.turn(NB, "identity", body)
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await chat.turn(NB, "identity", {**body, "retrieval_mode": "lexical"})
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_turn_pins_disclosure_against_mutating_caller_request(h):
    body = hybrid(h)
    original = deepcopy(
        {
            key: body[key]
            for key in (
                "retrieval_mode",
                "embedding_profile_id",
                "acknowledge_query_processing",
                "disclosed_profile_fingerprint",
                "destination_descriptor_version",
            )
        }
    )

    async def mutate():
        body["disclosed_profile_fingerprint"] = "b" * 64
        body["destination_descriptor_version"] = "later"

    h.provider.on_call = mutate

    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    turn = await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(NB, "mutable", body)
    assert turn["retrieval_request"] == original
    assert (await h.store.get("turn", turn["turn_id"]))["retrieval_request"] == original


@pytest.mark.asyncio
async def test_scope_change_during_generation_aborts_instead_of_committing_answer(h):
    async def model(messages):
        h.db.members.clear()
        return {"answer": "Revoked response", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "during", hybrid(h))
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "failed"
    assert saved["answer"] == ""


@pytest.mark.asyncio
async def test_queue_snapshots_disclosure_before_waiting_on_admission_lock(h):
    import asyncio

    async def submit(*args):
        return "command:fake"

    service = PersonalService(store=h.store, submit=submit)
    body = hybrid(h)
    original = deepcopy(body)
    async with h.store.project_lock(NB):
        task = asyncio.create_task(service.submit_turn("immutable", body))
        await asyncio.sleep(0)
        body["disclosed_profile_fingerprint"] = "b" * 64
        body["source_version_ids"].append("v2")
    job = await task
    assert job["request_snapshot"] == original


@pytest.mark.asyncio
async def test_legacy_scope_recheck_after_prompt_blocks_generation(h, monkeypatch):
    original = GroundedChatService._messages

    def messages(*args):
        result = original(*args)
        h.db.members.clear()
        return result

    calls = []

    async def model(messages):
        calls.append(messages)
        return {"answer": "unsafe", "citations": []}

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    monkeypatch.setattr(chat, "_messages", messages)
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(
            NB,
            "legacy-prompt",
            {
                "message": "electricity",
                "source_version_ids": ["v1"],
                "idempotency_key": "legacy",
            },
        )
    assert calls == h.provider.calls == []


@pytest.mark.asyncio
async def test_fallback_and_pinned_disclosure_survive_actual_job_and_events_response(
    h, monkeypatch
):
    from types import SimpleNamespace

    import httpx
    from fastapi import FastAPI

    from api.routers import notebooklm

    h.enabled = False

    async def model(messages):
        return {"answer": "excerpt", "citations": []}

    body = hybrid(h, message="electricity")
    turn = await GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    ).turn(NB, "wire", body)
    job = {
        "job_id": "job",
        "notebook_id": NB,
        "turn_id": turn["turn_id"],
        "operation": "chat",
        "state": "succeeded",
        "result": turn,
    }
    await h.store.put("job", "job", job)
    monkeypatch.setattr(routes, "get_store", lambda: h.store)
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.include_router(notebooklm.router, prefix="/api")
    app.dependency_overrides[notebooklm.get_notebooklm_service] = (
        lambda: SimpleNamespace(store=h.store)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/personal/jobs/job")
        assert response.status_code == 200
        assert response.json()["result"]["retrieval"] == turn["retrieval"]
        assert (
            response.json()["result"]["retrieval_request"] == turn["retrieval_request"]
        )
        response = await client.get(f"/api/personal/turns/{turn['turn_id']}/events")
        assert "event: final" in response.text
        payload = json.loads(response.text.split("data: ", 1)[1])
        assert payload["retrieval_request"] == turn["retrieval_request"]
        assert payload["retrieval"]["retrieval_method"] == "lexical_fallback"
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["unavailable", "unknown"])
async def test_no_hit_provider_fallback_keeps_honest_metadata_and_never_replays(
    h, outcome
):
    from open_notebook.ai.evidence_embeddings import (
        EmbeddingOutcomeUnknown,
        EmbeddingUnavailable,
    )

    h.provider.error = (
        EmbeddingOutcomeUnknown("EMBEDDING_OUTCOME_UNKNOWN")
        if outcome == "unknown"
        else EmbeddingUnavailable("EMBEDDING_UNAVAILABLE")
    )
    calls = []

    async def model(messages):
        calls.append(messages)
        raise AssertionError("No supporting excerpts")

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    body = hybrid(h)
    result = await chat.turn(NB, "provider-fallback", body)
    assert result["retrieval"]["retrieval_method"] == "lexical_fallback"
    assert result["retrieval"]["fallback_reason"] == (
        "EMBEDDING_OUTCOME_UNKNOWN" if outcome == "unknown" else "EMBEDDING_UNAVAILABLE"
    )
    assert len(h.provider.calls) == 1
    assert calls == []
    assert await chat.turn(NB, "provider-fallback", body) == result
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_scope_read_uncertainty_is_hard_error_not_turn_fallback(h):
    from open_notebook.exceptions import DatabaseOperationError

    h.db.error_at = "scope-membership"
    calls = []

    async def model(messages):
        calls.append(messages)
        raise AssertionError("No authorization")

    with pytest.raises(DatabaseOperationError, match="INDEX_READ_UNAVAILABLE"):
        await GroundedChatService(
            evidence_service=h.evidence, retrieval_service=h.service, model=model
        ).turn(NB, "unreadable", hybrid(h))
    assert calls == h.provider.calls == []
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "failed"
    assert "retrieval" not in saved


# Permanent copies of the independent five-case review regressions.
@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["citation", "commit_lock"])
async def test_scope_revoked_after_generation_check_must_not_commit(
    h, monkeypatch, phase
):
    generated = False

    async def model(messages):
        nonlocal generated
        generated = True
        return {
            "answer": "Solar electricity. [c1]",
            "citations": [{"citation_id": "c1", "evidence_id": "v1_0000"}],
        }

    original = h.evidence.validate_citation

    async def validate(*args, **kwargs):
        result = await original(*args, **kwargs)
        if generated:
            h.db.members.clear()
        return result

    entries = 0

    @asynccontextmanager
    async def store_lock(notebook):
        nonlocal entries
        async with project_lock(notebook):
            entries += 1
            if phase == "commit_lock" and entries == 2:
                # A completed revocation before the final commit owns the barrier.
                h.db.members.clear()
            yield

    monkeypatch.setattr(h.store, "project_lock", store_lock)
    if phase == "citation":
        monkeypatch.setattr(h.evidence, "validate_citation", validate)
    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    error = None
    try:
        await chat.turn(NB, "review-commit", hybrid(h))
    except InvalidInputError as exc:
        error = str(exc)
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "failed", {
        k: saved[k] for k in ("status", "answer", "grounding_status")
    }
    assert saved["answer"] == ""
    assert error == "SCOPE_CHANGED"


@pytest.mark.asyncio
async def test_revocation_during_default_model_lookup_prevents_provision(
    h, monkeypatch
):
    provisioned = []

    async def defaults():
        h.db.members.clear()
        return SimpleNamespace(default_chat_model="model:review")

    async def provision(*args, **kwargs):
        provisioned.append(args)
        return SimpleNamespace(ainvoke=None)

    monkeypatch.setattr(
        "open_notebook.graphs.grounded_chat.DefaultModels.get_instance", defaults
    )
    monkeypatch.setattr(
        "open_notebook.graphs.grounded_chat.provision_langchain_model", provision
    )
    chat = GroundedChatService(evidence_service=h.evidence, retrieval_service=h.service)
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "review-default", hybrid(h))
    assert provisioned == []


@pytest.mark.asyncio
@pytest.mark.parametrize("dispatch", ["queued", "unknown"])
async def test_same_key_retained_receipt_survives_disclosure_rotation(
    h, monkeypatch, dispatch
):
    queued = []

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    async def submit(*args):
        queued.append(args)
        if dispatch == "unknown":
            raise RuntimeError("Fake queue acknowledgment lost")
        return "command:review"

    service = PersonalService(store=h.store, submit=submit)
    monkeypatch.setattr(routes.Notebook, "get", notebook_get)
    monkeypatch.setattr(routes, "PersonalService", lambda: service)
    request = routes.TurnRequest.model_validate(hybrid(h))
    if dispatch == "unknown":
        with pytest.raises(PersonalTurnDispatchUnknownError):
            await routes.turn("review-receipt", request)
        saved = (await h.store.list("job"))[0]
        receipt = {
            key: saved[key]
            for key in ("job_id", "turn_id", "state", "dispatch_receipt")
        }
    else:
        receipt = await routes.turn("review-receipt", request)
    h.provider.profile = h.provider.profile.model_copy(
        update={"endpoint": "https://rotated.invalid/v1"}
    )
    assert await routes.turn("review-receipt", request) == receipt
    assert len(queued) == 1
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_no_hit_revocation_while_waiting_for_final_commit_cannot_succeed(
    h, monkeypatch
):
    h.provider.vector = [-1.0, 0.0]
    entries = 0

    @asynccontextmanager
    async def store_lock(notebook):
        nonlocal entries
        async with project_lock(notebook):
            entries += 1
            if entries == 2:
                h.db.members.clear()
            yield

    monkeypatch.setattr(h.store, "project_lock", store_lock)

    async def model(messages):
        raise AssertionError("No-hit generation")

    chat = GroundedChatService(
        evidence_service=h.evidence, retrieval_service=h.service, model=model
    )
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await chat.turn(NB, "nohit-final-fence", hybrid(h))
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "failed"
    assert saved["answer"] == ""
    assert saved["citations"] == []
    assert saved["grounding_status"] != "references_verified"
    assert saved["retrieval"]["retrieval_method"] == "hybrid"
    assert len(h.provider.calls) == 1


@pytest.mark.asyncio
async def test_original_scope_fence_error_survives_failed_failure_record_write(
    h, monkeypatch
):
    original_put = h.store.put
    entries = 0

    async def put(kind, identity, payload, **kwargs):
        if kind == "turn" and payload.get("status") == "failed":
            raise RuntimeError("fake failed diagnostic write")
        return await original_put(kind, identity, payload, **kwargs)

    @asynccontextmanager
    async def store_lock(notebook):
        nonlocal entries
        async with project_lock(notebook):
            entries += 1
            if entries == 2:
                h.db.members.clear()
            yield

    monkeypatch.setattr(h.store, "put", put)
    monkeypatch.setattr(h.store, "project_lock", store_lock)

    async def model(messages):
        return {"answer": "unsafe", "citations": []}

    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await GroundedChatService(
            evidence_service=h.evidence, retrieval_service=h.service, model=model
        ).turn(NB, "error-final-fence", hybrid(h))
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "running"
    assert saved["answer"] == ""


@pytest.mark.asyncio
async def test_retained_receipt_changed_intent_conflicts_before_rotated_admission(
    h, monkeypatch
):
    calls = []

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    async def submit(*args):
        calls.append(args)
        return "command:retained"

    service = PersonalService(store=h.store, submit=submit)
    monkeypatch.setattr(routes.Notebook, "get", notebook_get)
    monkeypatch.setattr(routes, "PersonalService", lambda: service)
    original = hybrid(h)
    await routes.turn("same-intent", routes.TurnRequest.model_validate(original))
    h.provider.profile = h.provider.profile.model_copy(
        update={"endpoint": "https://rotated.invalid/v1"}
    )
    changed = routes.TurnRequest.model_validate(
        {**original, "message": "different intent"}
    )
    with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
        await routes.turn("same-intent", changed)
    assert len(calls) == 1
    assert h.provider.calls == []


@pytest.mark.asyncio
async def test_cancellation_waiting_inside_final_barrier_releases_lock_without_output(
    h, monkeypatch
):
    import asyncio

    entries = 0
    reached_commit = asyncio.Event()

    @asynccontextmanager
    async def store_lock(notebook):
        nonlocal entries
        async with project_lock(notebook):
            entries += 1
            if entries == 2:
                reached_commit.set()
                await asyncio.Event().wait()
            yield

    monkeypatch.setattr(h.store, "project_lock", store_lock)

    async def model(messages):
        return {"answer": "not committed", "citations": []}

    task = asyncio.create_task(
        GroundedChatService(
            evidence_service=h.evidence, retrieval_service=h.service, model=model
        ).turn(NB, "cancel-final-fence", hybrid(h))
    )
    await asyncio.wait_for(reached_commit.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    async def acquire_released_lock():
        async with project_lock(NB):
            pass

    await asyncio.wait_for(acquire_released_lock(), 1)
    saved = (await h.store.list("turn"))[0]
    assert saved["status"] == "running"
    assert saved["answer"] == ""
    assert saved["citations"] == []


@pytest.mark.asyncio
async def test_exact_receipt_recovery_does_not_recheck_or_dispatch_mutable_scope(
    h, monkeypatch
):
    calls = []

    async def notebook_get(identity):
        return SimpleNamespace(id=identity)

    async def submit(*args):
        calls.append(args)
        return "command:retained"

    service = PersonalService(store=h.store, submit=submit)
    monkeypatch.setattr(routes.Notebook, "get", notebook_get)
    monkeypatch.setattr(routes, "PersonalService", lambda: service)
    request = routes.TurnRequest.model_validate(hybrid(h))
    receipt = await routes.turn("read-only-receipt", request)
    before_queries = len(h.db.calls)
    before_resolutions = len(h.provider.resolutions)
    h.db.members.clear()
    h.provider.profile = h.provider.profile.model_copy(
        update={"endpoint": "https://rotated.invalid/v1"}
    )
    assert await routes.turn("read-only-receipt", request) == receipt
    assert len(h.db.calls) == before_queries
    assert len(h.provider.resolutions) == before_resolutions
    assert len(calls) == 1
    assert h.provider.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("task", ["question", "outline"])
@pytest.mark.parametrize("explicit_lexical", [False, True])
async def test_remote_notebooklm_retrieval_options_do_not_require_local_scope(
    h, monkeypatch, enabled, task, explicit_lexical
):
    h.enabled = enabled

    async def exists(identity):
        return SimpleNamespace(id=identity)

    monkeypatch.setattr(routes.Notebook, "get", exists)
    queued = []

    async def enqueue(command, args):
        queued.append((command, args))
        return "command:offline"

    personal = PersonalService(store=h.store, submit=enqueue)
    monkeypatch.setattr(routes, "PersonalService", lambda: personal)
    body = dict(
        notebook_id=NB,
        engine="notebooklm",
        selection_origin="remote",
        source_version_ids=[],
        remote_source_ids=["remote:1"],
        remote_notebook_id="remote1",
        message="Question",
        idempotency_key="remote",
        task=task,
    )
    if explicit_lexical:
        body["retrieval_mode"] = "lexical"
    request = routes.TurnRequest(**body)
    result = await routes.turn("session:remote", request)
    assert result["state"] == "queued"
    retained = await personal.turn_receipt("session:remote", request.dispatch_payload())
    assert retained["request_snapshot"] == request.dispatch_payload()
    assert len(queued) == 1
    assert h.provider.calls == []
    assert h.store.reads == []


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_frontend_serialized_turn_dtos_reach_actual_route(
    h, monkeypatch, enabled
):
    from pathlib import Path

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    fixture = json.loads(
        Path("contracts/v1/fixtures/hybrid-turn-requests.json").read_text()
    )
    assert fixture["profile"] == h.provider.profile.model_dump(mode="json")
    h.enabled = enabled

    async def exists(identity):
        return SimpleNamespace(id=identity)

    monkeypatch.setattr(routes.Notebook, "get", exists)
    monkeypatch.setattr(routes, "EvidenceService", lambda: h.evidence)
    queued = []

    async def enqueue(command, args):
        queued.append((command, args))
        return "command:offline"

    personal = PersonalService(store=h.store, submit=enqueue)
    monkeypatch.setattr(routes, "PersonalService", lambda: personal)
    app = FastAPI()
    app.include_router(routes.router)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://offline.test"
    ) as client:
        for name, body in fixture["cases"].items():
            body = {**body, "idempotency_key": name}
            response = await client.post(
                "/personal/chats/session:wire/turns", json=body
            )
            assert response.status_code == 200, response.text
            request = routes.TurnRequest(**body).dispatch_payload()
            receipt = await personal.turn_receipt("session:wire", request)
            assert receipt["state"] == "queued"
            assert receipt["request_snapshot"] == request
        for name in ["remote_question", "remote_outline", "local_outline"]:
            body = {
                **fixture["cases"]["local_hybrid"],
                **fixture["cases"][name],
                "retrieval_mode": "hybrid",
                "idempotency_key": "invalid_" + name,
            }
            response = await client.post(
                "/personal/chats/session:wire/turns", json=body
            )
            assert response.status_code == 422
    assert len(queued) == len(fixture["cases"])
    assert h.provider.calls == []
