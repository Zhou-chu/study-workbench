"""Grounded turn orchestration; evidence services, persistence and model are boundaries."""

import asyncio
import json
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from typing import Literal, cast
from unittest.mock import AsyncMock

import pytest

from open_notebook.domain.evidence_retrieval import RetrievalResult
from open_notebook.exceptions import InvalidInputError
from open_notebook.graphs import grounded_chat as module


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    for key, value in {
        "STUDY_WORKBENCH_MAX_SELECTED_SOURCES": "20",
        "STUDY_WORKBENCH_CONTEXT_TOKENS": "8192",
        "STUDY_WORKBENCH_OUTPUT_TOKENS": "2048",
        "STUDY_WORKBENCH_MODEL_TIMEOUT_SECONDS": "5",
    }.items():
        monkeypatch.setenv(key, value)
    history: list[dict[str, object]] = []
    existing: list[dict[str, object]] = []
    writes: list[dict[str, object]] = []
    events: list[str] = []

    @asynccontextmanager
    async def lock(identity: str):
        events.append("lock:" + identity)
        try:
            yield
        finally:
            events.append("unlock:" + identity)

    async def listing(kind: str, **filters):
        assert kind == "turn"
        return deepcopy(existing if "idempotency_key" in filters else history)

    async def put(kind: str, identity: str, value: dict[str, object], **options):
        assert kind == "turn" and identity == value["turn_id"]
        writes.append(deepcopy(value))

    store = SimpleNamespace(
        get=AsyncMock(return_value={"notebook_id": "notebook:one"}),
        list=AsyncMock(side_effect=listing),
        put=AsyncMock(side_effect=put),
        project_lock=lock,
    )
    hit = {
        "evidence_id": "ev_one",
        "source_version_id": "sv_one",
        "source_title": "Source",
        "quote": "Canonical passage",
    }

    async def validate(citation, versions, **options):
        return {**citation, "reference_validity": "verified"}

    evidence = SimpleNamespace(
        retrieve=AsyncMock(return_value=[hit]),
        version=AsyncMock(return_value={"status": "ready"}),
        list_evidence=AsyncMock(return_value=[hit]),
        validate_citation=AsyncMock(side_effect=validate),
    )
    repository = SimpleNamespace(
        capture_scope=AsyncMock(return_value="captured-scope"),
        assert_scope=AsyncMock(),
        _assert_locked=AsyncMock(),
    )
    retrieval = SimpleNamespace(repository=repository, retrieve=AsyncMock())
    model = SimpleNamespace(
        ainvoke=AsyncMock(
            return_value={
                "answer": "Answer [c1]",
                "citations": [
                    {
                        "citation_id": "c1",
                        "evidence_id": "ev_one",
                        "quote": "Canonical passage",
                    }
                ],
            }
        )
    )
    request: dict[str, object] = {
        "message": "Explain solar power",
        "idempotency_key": "once",
        "source_version_ids": ["sv_one"],
    }
    service = module.GroundedChatService(
        evidence_service=evidence, store=store, retrieval_service=retrieval, model=model
    )
    return SimpleNamespace(
        service=service,
        request=request,
        store=store,
        evidence=evidence,
        repository=repository,
        model=model,
        history=history,
        existing=existing,
        writes=writes,
        events=events,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes,error",
    [
        ({"engine": "notebooklm"}, "independent engine"),
        ({"selection_origin": "remote"}, "local source versions"),
        ({"remote_source_ids": ["remote"]}, "local source versions"),
        ({"message": " "}, "question and idempotency_key"),
        ({"idempotency_key": " "}, "question and idempotency_key"),
        ({"source_version_ids": []}, "NO_SOURCES_SELECTED"),
        ({"source_version_ids": [str(i) for i in range(21)]}, "SOURCE_LIMIT"),
    ],
)
async def test_invalid_request_rejects_before_storage(
    setup: SimpleNamespace, changes: dict[str, object], error: str
) -> None:
    s = setup
    with pytest.raises(InvalidInputError, match=error):
        await s.service.turn("notebook:one", "chat:one", {**s.request, **changes})
    s.store.get.assert_not_awaited()
    s.store.put.assert_not_awaited()
    s.model.ainvoke.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "version,error",
    [(None, "SCOPE_CHANGED"), ({"notebook_id": "foreign"}, "SOURCE_PROJECT_MISMATCH")],
)
async def test_scope_metadata_rejects_before_content_or_turn_creation(
    setup: SimpleNamespace, version: dict[str, str] | None, error: str
) -> None:
    s = setup
    s.store.get.return_value = version
    with pytest.raises(InvalidInputError, match=error):
        await s.service.turn("notebook:one", "chat:one", s.request)
    s.evidence.retrieve.assert_not_awaited()
    s.store.put.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", [False, True])
async def test_existing_receipt_reuses_or_rejects_without_generation(
    setup: SimpleNamespace, conflict: bool
) -> None:
    s = setup
    request_hash = module._hash(
        {k: v for k, v in s.request.items() if k != "idempotency_key"}
    )
    receipt = {
        "request_hash": "different" if conflict else request_hash,
        "answer": "Saved answer",
        "status": "succeeded",
    }
    s.existing.append(receipt)
    if conflict:
        with pytest.raises(InvalidInputError, match="IDEMPOTENCY_CONFLICT"):
            await s.service.turn("notebook:one", "chat:one", s.request)
    else:
        assert await s.service.turn("notebook:one", "chat:one", s.request) == receipt
    s.store.put.assert_not_awaited()
    s.model.ainvoke.assert_not_awaited()
    s.repository.capture_scope.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_retrieval_returns_honest_insufficient_evidence_without_model(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.evidence.retrieve.return_value = []
    result = await s.service.turn("notebook:one", "chat:one", s.request)
    assert (
        result["status"] == "succeeded"
        and result["grounding_status"] == "insufficient_evidence"
    )
    assert result["coverage"] == {
        "selected_source_count": 1,
        "retrieved_source_count": 0,
        "evidence_count": 0,
    }
    assert "does not mean" in result["answer"]
    assert result["citations"] == []
    s.model.ainvoke.assert_not_awaited()
    assert [w["status"] for w in s.writes] == ["running", "succeeded"]
    s.repository._assert_locked.assert_awaited_once_with("captured-scope")


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["What about it?", "它是什么？", "上述结论呢？"])
async def test_ambiguous_followup_after_scope_change_is_not_answered(
    setup: SimpleNamespace, message: str
) -> None:
    s = setup
    s.history.append(
        {
            "created_at": "2024",
            "status": "succeeded",
            "scope_hash": "other",
            "message": "Old subject",
        }
    )
    with pytest.raises(InvalidInputError, match="QUESTION_NEEDS_CLARIFICATION"):
        await s.service.turn(
            "notebook:one", "chat:one", {**s.request, "message": message}
        )
    assert s.writes[-1]["status"] == "failed" and s.writes[-1]["answer"] == ""
    s.evidence.retrieve.assert_not_awaited()
    s.model.ainvoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_same_scope_followup_expands_query_but_not_current_question(
    setup: SimpleNamespace,
) -> None:
    s = setup
    scope = {
        "engine": "independent",
        "selection_origin": "local",
        "source_version_ids": ["sv_one"],
        "remote_source_ids": [],
        "remote_notebook_id": None,
        "mapping_version": 1,
    }
    s.history.append(
        {
            "created_at": "2024",
            "status": "succeeded",
            "scope_hash": module._hash(scope),
            "message": "Earlier subject",
        }
    )
    result = await s.service.turn(
        "notebook:one", "chat:one", {**s.request, "message": "Explain it"}
    )
    s.evidence.retrieve.assert_awaited_once_with(
        "Explain it Earlier subject", ["sv_one"]
    )
    assert result["message"] == "Explain it"
    assert result["grounding_status"] == "references_verified"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "citations,answer,reason",
    [
        ([], "Answer [c7]", "no reference"),
        (
            [
                {"citation_id": "c1", "evidence_id": "ev_one"},
                {"citation_id": "c1", "evidence_id": "ev_one"},
            ],
            "Answer [c1]",
            "Duplicate citation",
        ),
    ],
)
async def test_missing_or_duplicate_citation_markers_cannot_claim_verified_answer(
    setup: SimpleNamespace, citations: list[dict[str, str]], answer: str, reason: str
) -> None:
    s = setup
    s.model.ainvoke.return_value = {"answer": answer, "citations": citations}
    result = await s.service.turn("notebook:one", "chat:one", s.request)
    assert result["grounding_status"] == "unverified"
    assert any(
        c["reference_validity"] == "invalid" and reason in c["reason"]
        for c in result["citations"]
    )
    assert result["evidence_ids"] == ["ev_one"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["ready", "partial", "failed"])
async def test_outline_uses_selected_overview_only_for_ready_sources(
    setup: SimpleNamespace, status: str
) -> None:
    s = setup
    s.evidence.version.return_value = {"status": status}
    if status == "failed":
        with pytest.raises(InvalidInputError, match="SOURCE_NOT_READY"):
            await s.service.turn(
                "notebook:one", "chat:one", {**s.request, "task": "outline"}
            )
        s.model.ainvoke.assert_not_awaited()
    else:
        result = await s.service.turn(
            "notebook:one", "chat:one", {**s.request, "task": "outline"}
        )
        assert result["retrieval"]["retrieval_method"] == "selected_overview"
        assert any("BOUNDED_OVERVIEW" in w for w in result["warnings"])
        s.evidence.list_evidence.assert_awaited_once_with("sv_one")
    s.evidence.retrieve.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["capture_scope", "assert_scope", "_assert_locked"])
async def test_scope_failure_clears_output_and_rejects(
    setup: SimpleNamespace, phase: str
) -> None:
    s = setup
    error = InvalidInputError("SCOPE_CHANGED")
    getattr(s.repository, phase).side_effect = error
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED") as caught:
        await s.service.turn("notebook:one", "chat:one", s.request)
    final = s.writes[-1]
    assert final["status"] == "failed" and final["generation_status"] == "failed"
    assert (
        final["answer"] == ""
        and final["citations"] == []
        and final["evidence_ids"] == []
    )
    assert s.events[-1] == "unlock:notebook:one"
    if phase == "_assert_locked":
        s.model.ainvoke.assert_awaited_once()
    else:
        assert caught.value is error
        s.model.ainvoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_diagnostic_write_failure_does_not_mask_original_error(
    setup: SimpleNamespace,
) -> None:
    s = setup
    error = InvalidInputError("SCOPE_CHANGED")
    s.repository.capture_scope.side_effect = error
    original_put = s.store.put.side_effect

    async def put(kind, identity, value, **options):
        if value["status"] == "failed":
            raise OSError("diagnostic unavailable")
        await original_put(kind, identity, value, **options)

    s.store.put.side_effect = put
    with pytest.raises(InvalidInputError) as caught:
        await s.service.turn("notebook:one", "chat:one", s.request)
    assert caught.value is error
    assert len(s.writes) == 1 and s.writes[0]["status"] == "running"


@pytest.mark.asyncio
async def test_model_cancellation_is_not_a_success_or_failed_receipt(
    setup: SimpleNamespace,
) -> None:
    s = setup
    error = asyncio.CancelledError("cancel")
    s.model.ainvoke.side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await s.service.turn("notebook:one", "chat:one", s.request)
    assert caught.value is error
    assert [w["status"] for w in s.writes] == ["running"]
    assert s.events.count("lock:notebook:one") == s.events.count("unlock:notebook:one")


def retrieval_hit(version, index, *, quote="Canonical passage"):
    return {
        "evidence_id": f"{version}_{index}",
        "source_version_id": version,
        "source_title": version,
        "quote": quote,
    }


def model_citation(setup, evidence_id):
    setup.model.ainvoke.return_value = {
        "answer": "Answer [c1]",
        "citations": [{"citation_id": "c1", "evidence_id": evidence_id}],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["lexical", "hybrid"])
async def test_scoped_followup_routes_query_without_hiding_fallback(
    setup: SimpleNamespace, mode: Literal["lexical", "hybrid"]
) -> None:
    s = setup
    scope = {
        "engine": "independent",
        "selection_origin": "local",
        "source_version_ids": ["sv_one"],
        "remote_source_ids": [],
        "remote_notebook_id": None,
        "mapping_version": 1,
    }
    s.history.append(
        {
            "created_at": "2024",
            "status": "succeeded",
            "scope_hash": module._hash(scope),
            "message": "Earlier subject",
        }
    )
    declarations = (
        {
            "embedding_profile_id": "chosen",
            "acknowledge_query_processing": True,
            "disclosed_profile_fingerprint": "configured-profile",
            "destination_descriptor_version": "v1",
        }
        if mode == "hybrid"
        else {}
    )
    chosen: Literal["lexical_fallback", "lexical"] = (
        "lexical_fallback" if mode == "hybrid" else "lexical"
    )
    retrieval = s.service.retrieval_service.retrieve
    retrieval.return_value = RetrievalResult(
        requested_method=mode,
        retrieval_method=chosen,
        fallback_reason="INDEX_UNAVAILABLE" if mode == "hybrid" else None,
        selected_version_count=1,
        warnings=("Collected from selected sources",),
        hits=[retrieval_hit("sv_one", 1)],
    )
    model_citation(s, "sv_one_1")

    result = await s.service.turn(
        "notebook:one",
        "chat:one",
        {**s.request, "message": "Explain it", "retrieval_mode": mode, **declarations},
    )

    expected_query = "Explain it" if mode == "hybrid" else "Explain it Earlier subject"
    assert retrieval.await_args.args == (expected_query, "notebook:one", ["sv_one"])
    assert retrieval.await_args.kwargs["mode"] == mode
    assert retrieval.await_args.kwargs["profile_id"] == declarations.get(
        "embedding_profile_id"
    )
    s.evidence.retrieve.assert_not_awaited()
    assert result["retrieval"]["requested_method"] == mode
    assert result["retrieval"]["retrieval_method"] == chosen
    assert result["citations"][0]["evidence_id"] == "sv_one_1"
    assert "Collected from selected sources" in result["warnings"]
    assert any(w.startswith("LEXICAL_FALLBACK") for w in result["warnings"]) is (
        mode == "hybrid"
    )


@pytest.mark.asyncio
async def test_outline_balances_versions_before_applying_evidence_limit(
    setup: SimpleNamespace,
) -> None:
    s = setup
    versions = ["sv_one", "sv_two"]
    groups = [[retrieval_hit(version, i) for i in range(8)] for version in versions]
    s.evidence.list_evidence.side_effect = groups
    model_citation(s, "sv_one_0")

    result = await s.service.turn(
        "notebook:one",
        "chat:one",
        {**s.request, "source_version_ids": versions, "task": "outline"},
    )

    expected = [f"{version}_{i}" for i in range(6) for version in versions]
    assert result["evidence_ids"] == expected
    assert result["coverage"] == {
        "selected_source_count": 2,
        "retrieved_source_count": 2,
        "evidence_count": 12,
    }
    payload = json.loads(s.model.ainvoke.await_args.args[0][1]["content"])
    assert [e["evidence_id"] for e in payload["evidence"]] == expected
    assert result["retrieval"]["retrieval_method"] == "selected_overview"
    assert any(w.startswith("BOUNDED_OVERVIEW") for w in result["warnings"])
    s.evidence.retrieve.assert_not_awaited()


@pytest.mark.asyncio
async def test_answer_reports_sources_omitted_by_context_budget(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.evidence.retrieve.return_value = [
        retrieval_hit("sv_one", 1),
        retrieval_hit("sv_two", 1, quote="Long excerpt. " * 1200),
    ]
    model_citation(s, "sv_one_1")

    result = await s.service.turn(
        "notebook:one",
        "chat:one",
        {**s.request, "source_version_ids": ["sv_one", "sv_two"]},
    )

    assert result["evidence_ids"] == ["sv_one_1"]
    assert result["coverage"] == {
        "selected_source_count": 2,
        "retrieved_source_count": 1,
        "evidence_count": 1,
    }
    assert result["budget"]["retrieved_evidence_count"] == 2
    assert result["budget"]["included_evidence_count"] == 1
    assert any(w.startswith("CONTEXT_BUDGET") for w in result["warnings"])
    assert any(
        w.startswith("PARTIAL_SOURCE_COVERAGE") and "sv_two" in w
        for w in result["warnings"]
    )
    assert result["grounding_status"] == "references_verified"


@pytest.mark.asyncio
@pytest.mark.parametrize("retired", [False, True])
async def test_grounded_answer_revalidates_parent_turn_inside_barrier(
    setup: SimpleNamespace, retired: bool
) -> None:
    s = setup
    response = s.model.ainvoke.return_value
    model_returned = False

    async def generate(*_args):
        nonlocal model_returned
        model_returned = True
        return response

    async def check_parent(store):
        assert store is s.store
        assert s.events[-1] == "lock:notebook:one"
        if retired and model_returned:
            raise InvalidInputError("PARENT_TURN_RETIRED")

    s.model.ainvoke.side_effect = generate
    parent_check = AsyncMock(side_effect=check_parent)
    parent = cast(
        module.PersonalTurnAdmission, SimpleNamespace(assert_locked=parent_check)
    )
    if retired:
        with pytest.raises(InvalidInputError, match="PARENT_TURN_RETIRED"):
            await s.service.turn(
                "notebook:one", "chat:one", s.request, parent_admission=parent
            )
        assert s.writes[-1]["status"] == "failed"
        assert s.writes[-1]["answer"] == ""
        assert s.writes[-1]["citations"] == []
    else:
        result = await s.service.turn(
            "notebook:one", "chat:one", s.request, parent_admission=parent
        )
        assert result["status"] == "succeeded"
        assert s.writes[-1]["citations"] == result["citations"]
    assert parent_check.await_count >= 2
    s.repository.assert_scope.assert_not_awaited()
    s.repository._assert_locked.assert_awaited_with("captured-scope")
    s.model.ainvoke.assert_awaited_once()
