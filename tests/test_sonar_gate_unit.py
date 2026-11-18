"""Aggregate-only Sonar feedback, from fixed synthetic API responses."""

import pytest

from scripts.ci.sonar_gate import PROJECT, FeedbackError, collect, summarize, task_id

RECEIPT = (
    f"projectKey={PROJECT}\nceTaskId=task-1\n"
    f"dashboardUrl=https://sonarcloud.io/dashboard?id={PROJECT}&pullRequest=1\n"
    "ceTaskUrl=https://untrusted.invalid/non-authoritative\n"
)


def test_reject_other_pr_and_ignore_untrusted_compute_task_url():
    assert task_id(RECEIPT) == "task-1"
    with pytest.raises(FeedbackError, match="receipt-scope"):
        task_id(RECEIPT.replace("pullRequest=1", "pullRequest=2"))


def test_pin_exact_ce_task_and_render_red_quality_gate_without_individual_details():
    calls = []

    def read(endpoint, **params):
        calls.append((endpoint, params))
        if endpoint == "ce/task":
            return {
                "task": {
                    "id": "task-1",
                    "status": "SUCCESS",
                    "componentKey": PROJECT,
                    "pullRequest": "1",
                    "analysisId": "analysis-42",
                }
            }
        return {
            "projectStatus": {
                "status": "ERROR",
                "conditions": [
                    {
                        "status": "ERROR",
                        "metricKey": "new_security_rating",
                        "comparator": "GT",
                        "actualValue": "5",
                        "errorThreshold": "1",
                        "message": "private message",
                    },
                    {
                        "status": "ERROR",
                        "metricKey": "unknown_metric",
                        "actualValue": "6",
                        "errorThreshold": "4",
                    },
                    {
                        "status": "ERROR",
                        "metricKey": "new_coverage",
                        "actualValue": "private value",
                        "errorThreshold": "80",
                    },
                ],
            },
        }

    report = summarize(collect(RECEIPT, "", read))
    assert calls == [
        ("ce/task", {"id": "task-1"}),
        ("qualitygates/project_status", {"analysisId": "analysis-42"}),
    ]
    assert (
        "ERROR" in report and "new_security_rating" in report and "2 omitted" in report
    )
    assert (
        "private" not in report
        and "unknown_metric" not in report
        and "new_coverage" not in report
    )


def test_wrong_ce_pr_stops_before_gate_query():
    def read(endpoint, **params):
        assert endpoint == "ce/task"
        return {"task": {"id": "task-1", "componentKey": PROJECT, "pullRequest": "2"}}

    with pytest.raises(FeedbackError, match="task-scope"):
        collect(RECEIPT, "", read)
