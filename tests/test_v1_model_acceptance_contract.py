"""Public-only evaluator contracts; no provider or network is configured."""

import json

import pytest

from scripts.v1.model_acceptance_check import load_suite, run_acceptance


class StubChat:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    async def turn(self, notebook, session, request):
        self.calls.append(request)
        if self.fail:
            raise RuntimeError("SECRET_API_KEY should never appear in reports")
        return {
            "answer": "Mock only",
            "citations": [],
            "status": "succeeded",
            "grounding_status": "unverified",
            "evidence_ids": [],
            "scope_snapshot": {"source_version_ids": request["source_version_ids"]},
            "usage": {"input_tokens": 1, "api_key": "SECRET_API_KEY"},
        }


def policy(**updates):
    return dict(
        opt_in=True,
        mode="simulation",
        max_calls=40,
        budget_microusd=40,
        per_call_microusd=1,
        **updates,
    )


def versions(suite):
    return {key: "sv_" + key for key in suite["sources"]}


def test_public_suite_exact_distribution_and_evidence():
    suite = load_suite()
    assert len(suite["cases"]) == 30
    assert len({case["id"] for case in suite["cases"]}) == 30
    for case in suite["cases"]:
        assert case["expected"]
        for evidence in case["expected_evidence"]:
            assert evidence["source"] in case["sources"]
            assert evidence["quote"] in suite["sources"][evidence["source"]]


@pytest.mark.asyncio
async def test_default_and_live_mode_never_call():
    suite = load_suite()
    chat = StubChat()
    for options in ({}, {**policy(), "mode": "live"}):
        report = await run_acceptance(chat, versions(suite), **options)
        assert report["status"] == "blocked"
    assert chat.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "key,value",
    [
        ("max_calls", 0),
        ("budget_microusd", 0),
        ("per_call_microusd", 0),
        ("max_calls", True),
        ("budget_microusd", float("nan")),
    ],
)
async def test_invalid_budget_fails_closed(key, value):
    suite = load_suite()
    chat = StubChat()
    report = await run_acceptance(chat, versions(suite), **{**policy(), key: value})
    assert report["status"] == "blocked"
    assert not chat.calls


@pytest.mark.asyncio
async def test_budget_reserves_before_each_turn_and_stops():
    suite = load_suite()
    chat = StubChat()
    report = await run_acceptance(
        chat, versions(suite), **{**policy(), "budget_microusd": 2}
    )
    assert len(chat.calls) == 2
    assert report["status"] == "budget_exhausted"
    assert report["reserved_microusd"] == 2
    assert all(row["semantic_review"] == "pending" for row in report["results"])
    assert "SECRET_API_KEY" not in json.dumps(report)


@pytest.mark.asyncio
async def test_failure_is_single_attempt_and_error_is_not_echoed():
    suite = load_suite()
    chat = StubChat(fail=True)
    report = await run_acceptance(chat, versions(suite), **policy())
    assert len(chat.calls) == 1
    assert report["status"] == "stopped_on_error"
    assert "SECRET_API_KEY" not in json.dumps(report)
    assert report["reserved_microusd"] == 1


@pytest.mark.asyncio
async def test_complete_simulation_never_claims_semantic_or_live_success():
    suite = load_suite()
    chat = StubChat()
    report = await run_acceptance(chat, versions(suite), **policy())
    assert len(report["results"]) == 30
    assert report["status"] == "simulation_complete_review_pending"
    assert report["live_verified"] is False
    assert all(row["semantic_review"] == "pending" for row in report["results"])
    assert len({request["idempotency_key"] for request in chat.calls}) == len(
        chat.calls
    )


@pytest.mark.asyncio
async def test_missing_scope_mapping_rejected_before_any_call():
    chat = StubChat()
    report = await run_acceptance(chat, {}, **policy())
    assert report["status"] == "blocked"
    assert not chat.calls


@pytest.mark.asyncio
async def test_real_grounded_service_public_fixtures_and_scope_switch(tmp_path):
    from test_v1_evidence_ingest import MemoryStore

    from api.evidence_service import EvidenceService
    from open_notebook.graphs.grounded_chat import GroundedChatService

    suite = load_suite()
    evidence = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    mapping = {}
    payloads = []
    for alias, content in suite["sources"].items():
        version = await evidence.ingest(
            "acceptance", alias, alias, content.encode(), filename=f"{alias}.txt"
        )
        await evidence.extract(version["source_version_id"])
        mapping[alias] = version["source_version_id"]

    async def fake_model(messages):
        payload = json.loads(messages[-1]["content"])
        payloads.append(payload)
        hit = payload["evidence"][0]
        return {
            "answer": "Mock evidence echo, not a semantic answer. [c1]",
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": hit["evidence_id"],
                    "quote": hit["quote"],
                }
            ],
        }

    service = GroundedChatService(evidence_service=evidence, model=fake_model)
    report = await run_acceptance(service, mapping, **policy())
    assert report["status"] == "simulation_complete_review_pending"
    assert len(report["results"]) == 30
    assert all(row["scope_matches"] for row in report["results"])
    assert all(row["invalid_citations"] == 0 for row in report["results"])
    assert all(row["semantic_review"] == "pending" for row in report["results"])
    switched = [p for p in payloads if p["question"].startswith("仅根据当前B版")]
    assert len(switched) == 4
    assert all(p["previous_questions"] == [] for p in switched)
    assert all(
        {e["source_version_id"] for e in p["evidence"]} == {mapping["b"]}
        for p in switched
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "turn",
    [
        None,
        {},
        {"status": "failed", "error": "SECRET"},
        {"status": "succeeded", "answer": "bad", "citations": [None]},
    ],
)
async def test_malformed_or_failed_turn_stops_without_false_structural_success(turn):
    class BrokenChat:
        calls = 0

        async def turn(self, *args):
            self.calls += 1
            return turn

    chat = BrokenChat()
    report = await run_acceptance(chat, versions(load_suite()), **policy())
    assert report["status"] == "stopped_invalid_turn"
    assert not report["results"]
    assert chat.calls == 1
    assert "SECRET" not in json.dumps(report)


@pytest.mark.asyncio
async def test_call_limit_stops_even_when_money_reservation_remains():
    chat = StubChat()
    report = await run_acceptance(
        chat, versions(load_suite()), **{**policy(), "max_calls": 1}
    )
    assert len(chat.calls) == 1
    assert report["status"] == "budget_exhausted"


@pytest.mark.asyncio
async def test_forged_citation_and_wrong_scope_fail_structure_not_semantic_review():
    class ForgedChat(StubChat):
        async def turn(self, *args):
            turn = await super().turn(*args)
            turn["scope_snapshot"] = {"source_version_ids": ["sv_outside"]}
            turn["citations"] = [
                {"reference_validity": "verified", "source_version_id": "sv_outside"}
            ]
            return turn

    report = await run_acceptance(
        ForgedChat(), versions(load_suite()), **{**policy(), "max_calls": 1}
    )
    row = report["results"][0]
    assert row["structural_gate"] == "failed"
    assert row["invalid_citations"] == 1
    assert row["scope_matches"] is False
    assert row["semantic_review"] == "pending"
