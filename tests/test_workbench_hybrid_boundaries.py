"""Actual composed admission boundaries; only storage, transport and models are fake."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from test_evidence_embedding_calls import FakeResolver
from test_evidence_indexing_jobs import NB, request_for
from test_evidence_indexing_jobs import indexing as _indexing_fixture
from test_workbench_hybrid_acceptance import journey as _journey_fixture

from api.personal_service import PersonalService
from api.routers.notebooklm import cancel_job
from open_notebook.ai.evidence_embeddings import EvidenceEmbeddingClient, _slot

indexing = _indexing_fixture
journey = _journey_fixture


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["cancel", "revoke", "fence"])
@pytest.mark.parametrize("boundary", ["slot", "resolve", "provision"])
async def test_document_admission_at_real_async_boundaries(
    indexing, stop, boundary, monkeypatch
):
    f = indexing
    profile = f.provider.profile
    resolver = FakeResolver(profile)
    client = EvidenceEmbeddingClient(
        profile_loader=lambda: {profile.profile_id: profile},
        resolver=resolver,
        enabled=lambda: True,
    )
    f.service.embeddings = client
    receipt = await f.service.submit(NB, await request_for(f))
    jid = receipt.job_ids[0]
    entered, release = asyncio.Event(), asyncio.Event()
    if boundary == "slot":
        original = client._batch

        async def pause(*args, **kwargs):
            entered.set()
            return await original(*args, **kwargs)

        monkeypatch.setattr(client, "_batch", pause)
    else:
        original = getattr(resolver, boundary)

        async def pause(*args, **kwargs):
            result = await original(*args, **kwargs)
            entered.set()
            await release.wait()
            return result

        setattr(resolver, boundary, pause)

    async def interrupt():
        await asyncio.wait_for(entered.wait(), 2)
        assert resolver.calls == []
        if stop == "cancel":
            await f.service.cancel(jid)
        elif stop == "revoke":
            await f.service.repository.invalidate(NB, ["v1"], "test_revocation")
        else:
            await f.service.repository.cancel_attempt(jid)
        release.set()

    if boundary == "slot":
        async with _slot():
            task = asyncio.create_task(f.service.run(jid))
            await asyncio.wait_for(interrupt(), 2)
    else:
        task = asyncio.create_task(f.service.run(jid))
        await asyncio.wait_for(interrupt(), 2)
    result = await asyncio.wait_for(task, 2)
    assert resolver.calls == []
    assert len(resolver.provisions) == (1 if boundary == "provision" else 0)
    assert result["state"] != "succeeded"
    assert not f.db.vectors
    # The started receipt remains conservative and never authorizes replay.
    assert result["dispatch_started"] is True
    assert await f.service.run(jid) == result
    assert resolver.calls == []


async def setup_parent(f, monkeypatch, mode):
    import open_notebook.graphs.grounded_chat as grounded

    vid, _ = await f.add(
        NB, "source:public", "Solar panels convert light into current."
    )
    _, receipt = await f.build(NB, [vid], "build")
    await f.indexing.run(receipt.job_ids[0])
    profile = f.provider.profile
    resolver = FakeResolver(profile)
    client = EvidenceEmbeddingClient(
        profile_loader=lambda: {profile.profile_id: profile},
        resolver=resolver,
        enabled=lambda: True,
    )
    f.retrieval.embeddings = client
    monkeypatch.setattr(grounded, "GroundedChatService", lambda **kwargs: f.chat)

    async def enqueue(*args):
        return "command:offline"

    personal = PersonalService(store=f.store, submit=enqueue)
    request = dict(
        notebook_id=NB,
        engine="independent",
        selection_origin="local",
        source_version_ids=[vid],
        remote_source_ids=[],
        message="Solar panels",
        idempotency_key="turn",
        task="question",
    )
    if mode != "legacy":
        request["retrieval_mode"] = mode
    if mode == "hybrid":
        request.update(
            embedding_profile_id=profile.profile_id,
            disclosed_profile_fingerprint=profile.fingerprint,
            destination_descriptor_version=profile.destination_descriptor_version,
            acknowledge_query_processing=True,
        )
    job = await personal.submit_turn("session:boundary", request)

    async def cancel():
        result = await cancel_job(job["job_id"], service=SimpleNamespace(store=f.store))
        assert result["state"] == "cancelled_local"

    return personal, job, resolver, client, cancel, request


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary", ["slot", "resolve", "provision", "query_complete", "query_unknown"]
)
async def test_parent_cancel_blocks_next_query_or_generation_phase(
    journey, monkeypatch, boundary
):
    f = journey
    personal, job, resolver, client, cancel, request = await setup_parent(
        f, monkeypatch, "hybrid"
    )
    if boundary == "slot":
        entered = asyncio.Event()
        original = client._batch

        async def observe(*args, **kwargs):
            entered.set()
            return await original(*args, **kwargs)

        client._batch = observe
        async with _slot():
            task = asyncio.create_task(personal.run_turn(job["job_id"]))
            await asyncio.wait_for(entered.wait(), 2)
            await cancel()
        result = await asyncio.wait_for(task, 2)
    else:
        method = (
            "aembed" if boundary in {"query_complete", "query_unknown"} else boundary
        )
        original = getattr(resolver, method)

        async def interrupt(*args, **kwargs):
            result = await original(*args, **kwargs)
            await cancel()
            if boundary == "query_unknown":
                raise TimeoutError("synthetic timeout after dispatch")
            return result

        setattr(resolver, method, interrupt)
        result = await personal.run_turn(job["job_id"])
    turn = await f.store.get("turn", job["turn_id"])
    assert result["state"] == "cancelled_local"
    assert result["remote_may_continue"] is True
    assert len(resolver.calls) == (
        1 if boundary in {"query_complete", "query_unknown"} else 0
    )
    assert len(resolver.provisions) == (
        1 if boundary in {"provision", "query_complete", "query_unknown"} else 0
    )
    assert f.prompts == []
    assert turn["status"] != "succeeded"
    assert (await personal.submit_turn("session:boundary", request))["job_id"] == job[
        "job_id"
    ]
    assert (await personal.run_turn(job["job_id"]))["state"] == "cancelled_local"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["legacy", "lexical", "hybrid"])
@pytest.mark.parametrize(
    "boundary", ["generation_provision", "generation_response", "commit"]
)
async def test_cancelled_parent_cannot_generate_or_commit_child(
    journey, monkeypatch, mode, boundary
):
    import open_notebook.graphs.grounded_chat as grounded

    f = journey
    personal, job, resolver, client, cancel, _ = await setup_parent(
        f, monkeypatch, mode
    )
    if boundary == "generation_provision":
        f.chat.model = None

        async def defaults():
            return SimpleNamespace(default_chat_model="model:test")

        async def provision(*args, **kwargs):
            await cancel()
            return SimpleNamespace(ainvoke=f.answer)

        monkeypatch.setattr(grounded.DefaultModels, "get_instance", defaults)
        monkeypatch.setattr(grounded, "provision_langchain_model", provision)
    elif boundary == "generation_response":

        async def answer(messages):
            response = await f.answer(messages)
            await cancel()
            return response

        f.chat.model = answer
    else:
        # Trigger only after citation validation, while entering the actual final
        # project barrier. No earlier scope check can cover this cancellation.
        armed = False
        original_validate = f.evidence.validate_citation

        async def validate(*args, **kwargs):
            nonlocal armed
            result = await original_validate(*args, **kwargs)
            if f.prompts:
                armed = True
            return result

        f.evidence.validate_citation = validate
        original_lock = f.store.project_lock

        @asynccontextmanager
        async def lock(identity):
            nonlocal armed
            if armed:
                armed = False
                await cancel()
            async with original_lock(identity):
                yield

        f.store.project_lock = lock
    result = await personal.run_turn(job["job_id"])
    turn = await f.store.get("turn", job["turn_id"])
    assert result["state"] == "cancelled_local"
    assert turn["status"] != "succeeded"
    assert turn["answer"] == ""
    assert len(f.prompts) == (0 if boundary == "generation_provision" else 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["request_hash", "turn_id", "attempts", "state"])
async def test_parent_ownership_change_stops_dispatch_without_overwriting_receipt(
    journey, monkeypatch, change
):
    f = journey
    personal, job, resolver, client, _, _ = await setup_parent(f, monkeypatch, "hybrid")
    original = resolver.resolve
    changed = None

    async def resolve(profile):
        nonlocal changed
        result = await original(profile)
        async with f.store.project_lock(NB):
            changed = await f.store.get("job", job["job_id"])
            changed[change] = (
                2
                if change == "attempts"
                else "submission_unknown"
                if change == "state"
                else "other-immutable-identity"
            )
            await f.store.put("job", job["job_id"], changed)
        return result

    monkeypatch.setattr(resolver, "resolve", resolve)
    await personal.run_turn(job["job_id"])
    assert resolver.calls == []
    assert resolver.provisions == []
    assert f.prompts == []
    assert (await f.store.get("turn", job["turn_id"]))["status"] != "succeeded"
    assert await f.store.get("job", job["job_id"]) == changed
