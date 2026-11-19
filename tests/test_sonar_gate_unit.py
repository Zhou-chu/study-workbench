"""Aggregate-only Sonar feedback, from fixed synthetic API responses."""

import pytest

from scripts.ci.sonar_gate import (
    PROJECT,
    FeedbackError,
    collect,
    duplication_capability,
    summarize,
    task_id,
)

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


@pytest.mark.parametrize(
    ("parameters", "status"),
    [
        (
            ["component", "pullRequest", "qualifiers", "metricKeys"],
            "exact-analysis-selector-not-documented",
        ),
        (
            ["component", "pullRequest", "qualifiers", "metricKeys", "analysisId"],
            "analysis-selector-advertised-readback-not-enabled",
        ),
        (["component", "metricKeys"], "pr-file-measures-not-documented"),
    ],
)
def test_duplication_probe_reads_metadata_only(parameters, status):
    def read(endpoint, **params):
        assert (endpoint, params) == ("webservices/list", {})
        return {
            "webServices": [
                {
                    "path": "api/measures",
                    "actions": [
                        {
                            "key": "component_tree",
                            "params": [{"key": key} for key in parameters],
                            "description": "irrelevant metadata is never emitted",
                        }
                    ],
                }
            ]
        }

    assert duplication_capability(read) == status


def test_duplication_probe_failure_never_exports_external_error():
    def read(endpoint, **params):
        raise FeedbackError("irrelevant external error")

    assert duplication_capability(read) == "api-catalog-unavailable"


def test_duplication_probe_does_not_consider_internal_analysis_selector():
    params = [
        {"key": key} for key in ("component", "pullRequest", "qualifiers", "metricKeys")
    ] + [{"key": "analysisId", "internal": True}]
    actions = [{"key": "component_tree", "params": params}]
    catalog = {"webServices": [{"path": "api/measures", "actions": actions}]}
    assert (
        duplication_capability(lambda *_: catalog)
        == "exact-analysis-selector-not-documented"
    )
    assert (
        duplication_capability(lambda *_: {"webServices": {}}) == "api-catalog-invalid"
    )


def test_scanner_local_metadata_requires_same_project_pr_and_sha():
    from scripts.ci.sonar_gate import scanner_metadata_matches

    def field(number, value):
        value = value.encode()
        return bytes((number << 3 | 2, len(value))) + value

    sha = "a" * 40
    metadata = field(3, PROJECT) + field(13, sha) + field(14, "1")
    assert scanner_metadata_matches(metadata, sha)
    assert not scanner_metadata_matches(metadata, "b" * 40)
    assert not scanner_metadata_matches(metadata, "a")
    assert not scanner_metadata_matches(metadata + field(13, sha), sha)
    assert not scanner_metadata_matches(metadata[:-1], sha)
    assert not scanner_metadata_matches(metadata + b"\x00", sha)
    assert not scanner_metadata_matches(
        metadata.replace(b"\x72\x01" + b"1", b"\x72\x01" + b"2"), sha
    )
