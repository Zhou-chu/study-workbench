"""Aggregate-only SonarCloud gate readback for the same-repository draft PR #1."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PROJECT = "Zhou-chu_study-workbench"
HOST = "https://sonarcloud.io"
PR = "1"
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,100}")
NUMERIC = re.compile(r"-?\d{1,12}(?:\.\d{1,10})?")
STATUS = {"OK", "WARN", "ERROR", "NONE"}
COMPARATORS = {"GT", "LT", "EQ", "NE"}
METRICS = {
    "coverage",
    "duplicated_lines_density",
    "security_rating",
    "reliability_rating",
    "security_review_rating",
    "sqale_rating",
    "violations",
    "new_coverage",
    "new_duplicated_lines_density",
    "new_security_rating",
    "new_reliability_rating",
    "new_maintainability_rating",
    "new_security_review_rating",
    "new_security_hotspots_reviewed",
    "new_violations",
    "new_software_quality_security_rating",
    "new_software_quality_reliability_rating",
    "new_software_quality_maintainability_rating",
}
MAX_BODY = 1024 * 1024
Json = dict[str, Any]
Reader = Callable[..., Json]


class FeedbackError(ValueError):
    """Only fixed, bounded reason codes may be written to public output."""


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        raise FeedbackError("sonar-redirect-disallowed")


def task_id(receipt: str) -> str:
    if len(receipt) > 8192:
        raise FeedbackError("invalid-receipt")
    fields = {}
    for row in receipt.splitlines():
        key, separator, value = row.partition("=")
        if separator and key in {"projectKey", "ceTaskId", "dashboardUrl"}:
            if key in fields:
                raise FeedbackError("invalid-receipt")
            fields[key] = value
    try:
        dashboard = urlsplit(fields.get("dashboardUrl", ""))
        query = parse_qs(dashboard.query)
    except ValueError:
        raise FeedbackError("receipt-scope") from None
    if (
        fields.get("projectKey") != PROJECT
        or (dashboard.scheme, dashboard.netloc) != ("https", "sonarcloud.io")
        or query.get("id") != [PROJECT]
        or query.get("pullRequest") != [PR]
    ):
        raise FeedbackError("receipt-scope")
    identifier = fields.get("ceTaskId", "")
    if not IDENTIFIER.fullmatch(identifier):
        raise FeedbackError("invalid-task-id")
    return identifier


def sonar_reader(token: str) -> Reader:
    if not token:
        raise FeedbackError("sonar-token-unavailable")
    opener = build_opener(RejectRedirect())

    def read(endpoint: str, **params: str) -> Json:
        if endpoint not in {"ce/task", "qualitygates/project_status"}:
            raise FeedbackError("endpoint-outside-scope")
        try:
            request = Request(
                f"{HOST}/api/{endpoint}?{urlencode(params)}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                method="GET",
            )
            with opener.open(request, timeout=8) as response:
                raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise FeedbackError("sonar-response-overflow")
            body = json.loads(raw)
        except HTTPError as error:
            raise FeedbackError(f"sonar-http-{error.code}") from None
        except FeedbackError:
            raise
        except (OSError, ValueError, RecursionError):
            raise FeedbackError("sonar-api-unavailable") from None
        if not isinstance(body, dict):
            raise FeedbackError("sonar-invalid-response")
        return body

    return read


def token_in(value: object, choices: set[str]) -> bool:
    return isinstance(value, str) and value in choices


def collect(receipt: str, branch: str, read: Reader) -> Json:
    identifier = task_id(receipt)
    task = read("ce/task", id=identifier).get("task")
    if not isinstance(task, dict):
        raise FeedbackError("task-scope")
    pr = task.get("pullRequest")
    legacy = (
        pr is None
        and task.get("branchType") == "PULL_REQUEST"
        and (task.get("branch") == PR or (branch and task.get("branch") == branch))
    )
    if (
        task.get("componentKey") != PROJECT
        or task.get("id") != identifier
        or not (pr == PR or legacy)
    ):
        raise FeedbackError("task-scope")
    if task.get("status") != "SUCCESS":
        raise FeedbackError("compute-task-not-successful")
    analysis = task.get("analysisId")
    if not isinstance(analysis, str) or not IDENTIFIER.fullmatch(analysis):
        raise FeedbackError("invalid-analysis-id")
    report = read("qualitygates/project_status", analysisId=analysis).get(
        "projectStatus"
    )
    if (
        not isinstance(report, dict)
        or not token_in(report.get("status"), STATUS)
        or not isinstance(report.get("conditions"), list)
    ):
        raise FeedbackError("invalid-gate-result")
    return report


def numeric(value: object) -> bool:
    return isinstance(value, str) and bool(NUMERIC.fullmatch(value))


def summarize(report: Json) -> str:
    status = report["status"]
    lines = [
        "### SonarQube Cloud Quality Gate",
        "",
        f"Status: **{status}** (scan-specific).",
        "",
    ]
    rows = [
        item
        for item in report["conditions"]
        if isinstance(item, dict)
        and token_in(item.get("metricKey"), METRICS)
        and token_in(item.get("status"), STATUS)
        and numeric(item.get("actualValue"))
        and numeric(item.get("errorThreshold"))
    ][:50]
    if rows:
        lines.extend(
            [
                "| Metric | Status | Actual | Failure threshold |",
                "| --- | --- | ---: | --- |",
            ]
        )
        for item in rows:
            comparison = item.get("comparator")
            prefix = f"{comparison} " if token_in(comparison, COMPARATORS) else ""
            lines.append(
                f"| `{item['metricKey']}` | {item['status']} | {item['actualValue']} | "
                f"{prefix}{item['errorThreshold']} |"
            )
    omitted = len(report["conditions"]) - len(rows)
    if omitted:
        lines.append(f"\n{omitted} omitted (unknown or incomplete metric data).")
    if status == "ERROR" and not any(item["status"] == "ERROR" for item in rows):
        lines.append(
            "\nFailed condition values are unavailable in the permitted aggregate fields."
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    code = 0
    try:
        with Path(os.environ["SONAR_RECEIPT"]).open(encoding="utf-8") as source:
            receipt = source.read(8193)
        result = collect(
            receipt,
            os.environ.get("PR_BRANCH", ""),
            sonar_reader(os.environ.get("SONAR_TOKEN", "")),
        )
        summary = summarize(result)
    except (FeedbackError, OSError, KeyError, UnicodeError) as error:
        reason = (
            str(error)
            if isinstance(error, FeedbackError)
            else "scanner-receipt-unavailable"
        )
        summary = (
            "### SonarQube Cloud Quality Gate\n\n"
            f"Details unavailable: `{reason}`. The scanner result is unchanged.\n"
        )
        code = 1
    print(summary, end="")
    try:
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open(
            "a", encoding="utf-8"
        ) as output:
            output.write(summary)
    except (OSError, KeyError):
        print("Sonar Quality Gate summary could not be written.")
        code = 1
    return code


if __name__ == "__main__":
    raise SystemExit(main())
