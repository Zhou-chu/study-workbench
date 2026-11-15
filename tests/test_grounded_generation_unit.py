"""Pure prompt/response policy and model-dispatch unit boundaries; no ingest or DB."""

import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from open_notebook.exceptions import (
    ConfigurationError,
    ContextLengthExceededError,
    ExternalServiceError,
    InvalidInputError,
    RateLimitError,
)
from open_notebook.graphs import grounded_chat as module

Service = module.GroundedChatService


def hit(**extra):
    return {
        "evidence_id": "e1",
        "source_version_id": "v1",
        "source_title": "资料",
        "quote": "中文 evidence",
        **extra,
    }


def service(model=None):
    # Dependencies are never invoked in these prompt/dispatch methods. Supplying
    # explicit inert boundaries avoids constructing real evidence repositories.
    return Service(
        evidence_service=object(),
        store=object(),
        retrieval_service=object(),
        model=model,
    )


@pytest.fixture(autouse=True)
def budget_environment(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_CONTEXT_TOKENS", "8192")
    monkeypatch.setenv("STUDY_WORKBENCH_OUTPUT_TOKENS", "2048")
    monkeypatch.setenv("STUDY_WORKBENCH_MODEL_TIMEOUT_SECONDS", "5")


@pytest.mark.parametrize(
    "provenance,authorship",
    [
        ({"origin_kind": "turn", "authorship": "ai"}, "ai"),
        ({}, "unknown"),
        (None, "unknown"),
    ],
)
def test_derived_prompt_preserves_data_not_independent_support(provenance, authorship):
    item = hit(
        evidence_kind="derived_snapshot",
        provenance=provenance,
        secret_internal="must not leak",
    )
    before = deepcopy(item)
    messages, included, budget = Service._messages("问题", ["earlier"], [item])
    payload = json.loads(messages[1]["content"])
    entry = payload["evidence"][0]
    assert payload["question"] == "问题"
    assert payload["previous_questions"] == ["earlier"]
    assert entry["independent_support"] is False
    assert entry["authorship"] == authorship
    assert entry["origin_kind"] == (provenance or {}).get("origin_kind")
    assert "secret_internal" not in entry
    assert item == before and included == [item]
    assert "untrusted data" in messages[0]["content"]
    assert budget["estimated_input_tokens"] == sum(
        len(m["content"].encode()) + 16 for m in messages
    )
    assert budget["estimator"] == "utf8_byte_upper_bound"


def test_budget_skips_oversized_block_without_truncating_and_keeps_later_fit():
    huge, small = hit(quote="大" * 10000), hit(evidence_id="e2")
    messages, included, budget = Service._messages("Q", [], [huge, small])
    assert included == [small]
    assert json.loads(messages[1]["content"])["evidence"] == [
        {**small, "evidence_kind": "text"}
    ]
    assert budget["retrieved_evidence_count"] == 2
    assert budget["included_evidence_count"] == 1


@pytest.mark.parametrize("hits", [[], [hit(quote="x" * 100000)]])
def test_no_complete_block_fits_is_error(hits):
    with pytest.raises(ContextLengthExceededError, match="no complete evidence block"):
        Service._messages("Q", [], hits)


def test_context_cap_and_exact_fit_boundary(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_CONTEXT_TOKENS", "999999")
    _, _, budget = Service._messages("Q", [], [hit()])
    assert budget["context_tokens"] == 100000
    exact = budget["estimated_input_tokens"] + budget["output_tokens"]
    monkeypatch.setenv("STUDY_WORKBENCH_CONTEXT_TOKENS", str(exact))
    assert Service._messages("Q", [], [hit()])[1] == [hit()]
    monkeypatch.setenv("STUDY_WORKBENCH_CONTEXT_TOKENS", str(exact - 1))
    with pytest.raises(ContextLengthExceededError, match="no complete evidence block"):
        Service._messages("Q", [], [hit()])


def test_question_and_instructions_rejected_before_evidence(monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_CONTEXT_TOKENS", "10")
    with pytest.raises(ContextLengthExceededError, match="question and instructions"):
        Service._messages("Q", [], [hit()])


@pytest.mark.parametrize(
    "wrapper",
    [
        lambda x: x,
        lambda x: json.dumps(x),
        lambda x: SimpleNamespace(content=json.dumps(x)),
        lambda x: "```json\n" + json.dumps(x) + "\n```",
        lambda x: "```\n" + json.dumps(x) + "\n```",
    ],
)
def test_response_accepts_supported_forms_without_claiming_citation_validity(wrapper):
    citation = {"citation_id": "c1", "evidence_id": "unverified"}
    answer, citations = Service._response(
        wrapper({"answer": "Answer [c1]", "citations": [citation]})
    )
    assert answer == "Answer [c1]" and citations == [citation]
    assert "reference_validity" not in citations[0]


@pytest.mark.parametrize("value", [{}, {"answer": " "}, {"answer": 1}, "null", "[]"])
def test_response_rejects_missing_blank_or_non_string_answer(value):
    with pytest.raises(ExternalServiceError, match="answer is empty or malformed"):
        Service._response(value)


@pytest.mark.parametrize("citations", [None, {}, "c1", [1], [None], [{}, "bad"]])
def test_response_rejects_non_object_citations(citations):
    with pytest.raises(ExternalServiceError, match="citations must be objects"):
        Service._response({"answer": "A", "citations": citations})


def test_response_defaults_citations_and_strips_thinking():
    assert Service._response({"answer": "<think>hidden</think>Visible"}) == (
        "Visible",
        [],
    )


@pytest.mark.parametrize("value", ["not json", []])
def test_malformed_json_keeps_cause(value):
    with pytest.raises(ExternalServiceError, match="expected an answer") as caught:
        Service._response(value)
    assert isinstance(caught.value.__cause__, json.JSONDecodeError)


@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["sync", "async", "ainvoke"])
async def test_injected_model_forms_preserve_response_usage_and_admission_order(shape):
    events = []
    response = SimpleNamespace(content="answer", usage_metadata={"input_tokens": 7})
    messages = [{"role": "user", "content": "Q"}]

    def sync(actual):
        assert actual == messages
        events.append("model")
        return response

    async def asynchronous(actual):
        return sync(actual)

    model = sync if shape == "sync" else asynchronous
    if shape == "ainvoke":
        model = SimpleNamespace(ainvoke=asynchronous)

    async def admit():
        events.append("admit")

    result = await service(model)._generate(
        messages, None, 55, dispatch_admission=admit
    )
    assert result == (response, "injected-test-model", {"input_tokens": 7})
    assert events == ["admit", "admit", "model"]


@pytest.mark.asyncio
async def test_explicit_injected_model_id_is_not_overwritten():
    assert await service(lambda _: "answer")._generate([], "chosen", 1) == (
        "answer",
        "chosen",
        None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit", [None, "selected"])
async def test_provider_provision_uses_default_only_when_needed(monkeypatch, explicit):
    calls = []
    defaults = AsyncMock(return_value=SimpleNamespace(default_chat_model="default"))
    monkeypatch.setattr(module.DefaultModels, "get_instance", defaults)
    response = SimpleNamespace(content="text", usage_metadata=None)
    model = SimpleNamespace(ainvoke=AsyncMock(return_value=response))

    async def provision(*args, **kwargs):
        calls.append((args, kwargs))
        return model

    monkeypatch.setattr(module, "provision_langchain_model", provision)
    admission = AsyncMock()
    messages = [{"role": "user", "content": "中文"}]
    assert await service()._generate(
        messages, explicit, 23, dispatch_admission=admission
    ) == (response, explicit or "default", None)
    assert calls == [
        (
            (json.dumps(messages, ensure_ascii=False), explicit or "default", "chat"),
            {"max_tokens": 23},
        )
    ]
    assert defaults.await_count == (0 if explicit else 1)
    assert admission.await_count == 3
    model.ainvoke.assert_awaited_once_with(messages)


@pytest.mark.asyncio
async def test_unconfigured_default_refuses_provision(monkeypatch):
    monkeypatch.setattr(
        module.DefaultModels,
        "get_instance",
        AsyncMock(return_value=SimpleNamespace(default_chat_model=None)),
    )
    provision = AsyncMock()
    monkeypatch.setattr(module, "provision_langchain_model", provision)
    with pytest.raises(ConfigurationError, match="MODEL_NOT_CONFIGURED"):
        await service()._generate([], None, 1)
    provision.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("admission_number", [1, 2, 3])
async def test_admission_failure_never_dispatches_provider(
    monkeypatch, admission_number
):
    model = SimpleNamespace(ainvoke=AsyncMock())
    provision = AsyncMock(return_value=model)
    monkeypatch.setattr(module, "provision_langchain_model", provision)
    count = 0
    error = InvalidInputError("SCOPE_CHANGED")

    async def admit():
        nonlocal count
        count += 1
        if count == admission_number:
            raise error

    with pytest.raises(InvalidInputError) as caught:
        await service()._generate([], "selected", 1, dispatch_admission=admit)
    assert caught.value is error
    assert count == admission_number
    assert provision.await_count == (1 if admission_number == 3 else 0)
    model.ainvoke.assert_not_called()


@pytest.mark.asyncio
async def test_provider_rate_limit_is_classified_with_original_cause():
    error = RuntimeError("429 rate limit exceeded")

    async def model(_):
        raise error

    with pytest.raises(RateLimitError) as caught:
        await service(model)._generate([], None, 1)
    assert caught.value.__cause__ is error


@pytest.mark.asyncio
async def test_domain_error_propagates_identity():
    error = ConfigurationError("broken configuration")

    def model(_):
        raise error

    with pytest.raises(ConfigurationError) as caught:
        await service(model)._generate([], None, 1)
    assert caught.value is error


@pytest.mark.asyncio
async def test_cancellation_propagates_and_closes_inflight_provider():
    started = asyncio.Event()
    finished = asyncio.Event()

    async def model(_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            finished.set()

    task = asyncio.create_task(service(model)._generate([], None, 1))
    await asyncio.wait_for(started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"engine": "remote"}, "only supports"),
        ({"selection_origin": "remote"}, "local source versions"),
        ({"remote_source_ids": ["remote"]}, "local source versions"),
        ({"message": " "}, "question and idempotency_key"),
        ({"idempotency_key": " "}, "question and idempotency_key"),
        ({"source_version_ids": []}, "NO_SOURCES_SELECTED"),
        ({"source_version_ids": ["v" + str(i) for i in range(21)]}, "SOURCE_LIMIT"),
    ],
)
async def test_invalid_turn_requests_fail_before_any_io(patch, reason):
    request = {"message": "Q", "idempotency_key": "k", "source_version_ids": ["v"]}
    request.update(patch)
    before = deepcopy(request)
    # Inert boundaries have no I/O methods: accidental dispatch cannot be hidden
    # by a permissive mock and would fail with a different exception.
    with pytest.raises(InvalidInputError, match=reason):
        await service().turn("notebook", "session", request)
    assert request == before


def test_request_hash_is_canonical_and_unicode_sensitive():
    assert module._hash({"b": 2, "a": "中文"}) == module._hash({"a": "中文", "b": 2})
    assert module._hash({"a": "中文"}) != module._hash({"a": "中"})
    assert len(module._hash({})) == 64
