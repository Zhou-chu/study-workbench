"""Offline acceptance preparation. CLI never provisions a model or reads credentials.

The injected turn interface matches GroundedChatService; simulation callers must
supply an in-memory service with an injected fake model, not a configured provider.
Live mode deliberately remains blocked until provider-level retry/cost controls
and explicit transmission authorization are independently verified.
"""

import argparse
import json
from collections import Counter
from pathlib import Path
from time import monotonic
from uuid import uuid4

SUITE = (
    Path(__file__).resolve().parents[2]
    / "tests/fixtures/v1/model_acceptance/suite.json"
)
DISTRIBUTION = {"single": 12, "multi": 6, "no_evidence": 6, "scope_injection": 6}


def load_suite(path=SUITE):
    suite = json.loads(Path(path).read_text(encoding="utf-8"))
    cases, sources = suite["cases"], suite["sources"]
    if (
        suite["schema_version"] != 1
        or Counter(c["category"] for c in cases) != DISTRIBUTION
    ):
        raise ValueError("Invalid acceptance distribution or schema")
    if len({c["id"] for c in cases}) != 30:
        raise ValueError("Acceptance IDs must be unique")
    for case in cases:
        if not case["question"] or not case["expected"] or not case["sources"]:
            raise ValueError("Missing question, scope or manual review expectation")
        if not set(case["sources"]) <= sources.keys():
            raise ValueError("Unknown source")
        for evidence in case["expected_evidence"]:
            if (
                evidence["source"] not in case["sources"]
                or not evidence["quote"]
                or evidence["quote"] not in sources[evidence["source"]]
            ):
                raise ValueError(
                    "Expected evidence must be an exact in-scope substring"
                )
        if case.get("prior") and not set(case["prior"]["sources"]) <= sources.keys():
            raise ValueError("Unknown prior source")
    return suite


async def run_acceptance(
    chat,
    versions,
    *,
    opt_in=False,
    mode="offline",
    max_calls=0,
    budget_microusd=0,
    per_call_microusd=0,
):
    """Exercise the turn contract with a caller-owned simulated service only.

    Budget values are integer micro-USD reservations (not actual billing). Every
    turn, including primers and failed attempts, reserves the whole upper bound.
    Never refund based on missing usage. No retry or fallback is attempted.
    """
    suite = load_suite()
    report = {
        "status": "blocked",
        "live_verified": False,
        "results": [],
        "calls": 0,
        "reserved_microusd": 0,
        "mode": mode,
    }
    if opt_in is not True or mode != "simulation":
        report["reason"] = (
            "Explicit simulation opt-in required; live execution is not enabled"
        )
        return report
    limits = (max_calls, budget_microusd, per_call_microusd)
    if any(type(value) is not int or value <= 0 for value in limits):
        report["reason"] = "Positive integer call and reservation limits required"
        return report
    if (
        set(versions) != set(suite["sources"])
        or any(not isinstance(v, str) or not v for v in versions.values())
        or len(set(versions.values())) != len(versions)
    ):
        report["reason"] = "Complete distinct source version mapping required"
        return report
    run_id = uuid4().hex
    for case in suite["cases"]:
        steps = ([case["prior"]] if case.get("prior") else []) + [case]
        for step_index, step in enumerate(steps):
            if (
                report["calls"] >= max_calls
                or report["reserved_microusd"] + per_call_microusd > budget_microusd
            ):
                report["status"] = "budget_exhausted"
                return report
            report["calls"] += 1
            report["reserved_microusd"] += per_call_microusd
            started = monotonic()
            selected = [versions[source] for source in step["sources"]]
            try:
                turn = await chat.turn(
                    "acceptance",
                    f"{run_id}-{case['id']}",
                    {
                        "engine": "independent",
                        "selection_origin": "local",
                        "source_version_ids": selected,
                        "message": step["question"],
                        "idempotency_key": f"{run_id}-{case['id']}-{step_index}",
                    },
                )
            except Exception:
                # Exceptions may contain endpoint headers, URLs or credentials.
                report.update(status="stopped_on_error", failed_case=case["id"])
                return report
            if (
                not isinstance(turn, dict)
                or turn.get("status") != "succeeded"
                or not isinstance(turn.get("answer"), str)
                or not turn["answer"].strip()
                or not isinstance(turn.get("citations"), list)
                or not all(isinstance(c, dict) for c in turn["citations"])
                or not isinstance(turn.get("scope_snapshot"), dict)
                or not isinstance(
                    turn["scope_snapshot"].get("source_version_ids"), list
                )
                or not all(
                    isinstance(v, str)
                    for v in turn["scope_snapshot"]["source_version_ids"]
                )
                or not isinstance(turn.get("evidence_ids"), list)
                or not all(isinstance(v, str) for v in turn["evidence_ids"])
                or (
                    turn.get("usage") is not None
                    and not isinstance(turn["usage"], dict)
                )
            ):
                report.update(status="stopped_invalid_turn", failed_case=case["id"])
                return report
            if step_index < len(steps) - 1:
                continue
            citations = turn.get("citations", [])
            scope_ok = set(
                turn.get("scope_snapshot", {}).get("source_version_ids", [])
            ) == set(selected)
            invalid = sum(
                c.get("reference_validity") != "verified"
                or c.get("source_version_id") not in selected
                for c in citations
            )
            usage = turn.get("usage") or {}
            report["results"].append(
                {
                    "case_id": case["id"],
                    "source_aliases": step["sources"],
                    "source_version_ids": selected,
                    "answer": turn.get("answer", ""),
                    "evidence_ids": turn.get("evidence_ids", []),
                    "citations": [
                        {
                            k: c.get(k)
                            for k in (
                                "citation_id",
                                "evidence_id",
                                "source_version_id",
                                "quote",
                                "reference_validity",
                            )
                        }
                        for c in citations
                    ],
                    "scope_matches": scope_ok,
                    "invalid_citations": invalid,
                    "grounding_status": turn.get("grounding_status"),
                    "duration_seconds": round(monotonic() - started, 3),
                    "usage": {
                        k: usage[k]
                        for k in ("input_tokens", "output_tokens", "total_tokens")
                        if type(usage.get(k)) is int and usage[k] >= 0
                    },
                    "semantic_review": "pending",
                    "expected": case["expected"],
                    "structural_gate": "failed"
                    if invalid or not scope_ok
                    else "manual_review_required",
                }
            )
    report["status"] = "simulation_complete_review_pending"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("offline", "live"), default="offline")
    args = parser.parse_args()
    suite = load_suite()
    print(
        json.dumps(
            {
                "status": "offline_contract_ready"
                if args.mode == "offline"
                else "blocked",
                "cases": len(suite["cases"]),
                "distribution": DISTRIBUTION,
                "live_verified": False,
                "external_calls": 0,
                "reason": "CLI validates public fixtures only; provider budget/retry and authorization gates remain open",
            },
            ensure_ascii=False,
        )
    )
    return 0 if args.mode == "offline" else 2


if __name__ == "__main__":
    raise SystemExit(main())
