"""Aggregate gate readback and capability-only probe for draft PR #1."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
from collections.abc import Callable, Iterator
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
        if endpoint not in {
            "ce/task",
            "qualitygates/project_status",
            "webservices/list",
        } or (endpoint == "webservices/list" and params):
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


def duplication_capability(read: Reader) -> str:
    """Read API metadata only. Never fetch mutable per-file measures."""
    try:
        services = read("webservices/list").get("webServices")
    except FeedbackError:
        return "api-catalog-unavailable"
    if not isinstance(services, list):
        return "api-catalog-invalid"
    catalog = [
        service
        for service in services
        if isinstance(service, dict) and service.get("path") == "api/measures"
    ]
    if len(catalog) != 1 or not isinstance(catalog[0].get("actions"), list):
        return "pr-file-measures-not-documented"
    actions = [
        action
        for action in catalog[0]["actions"]
        if isinstance(action, dict)
        and action.get("key") == "component_tree"
        and action.get("internal", False) is False
    ]
    if len(actions) != 1 or not isinstance(actions[0].get("params"), list):
        return "pr-file-measures-not-documented"
    keys = {
        param["key"]
        for param in actions[0]["params"]
        if isinstance(param, dict)
        and isinstance(param.get("key"), str)
        and param.get("internal", False) is False
    }
    if not {"component", "pullRequest", "qualifiers", "metricKeys"} <= keys:
        return "pr-file-measures-not-documented"
    if "analysisId" not in keys:
        return "exact-analysis-selector-not-documented"
    # Documentation metadata alone does not prove revision-bound read semantics.
    return "analysis-selector-advertised-readback-not-enabled"


def scanner_metadata_matches(raw: bytes, sha: str) -> bool:
    """Check only the published ScannerReport Metadata fields 3, 13 and 14.

    Known field layout: SonarSource/sonarqube 25.12.0.117093,
    sonar-scanner-protocol/src/main/protobuf/scanner_report.proto.
    """
    if len(raw) > MAX_BODY or not re.fullmatch(r"[a-f0-9]{40}", sha):
        return False
    expected = {3: PROJECT.encode(), 13: sha.encode(), 14: PR.encode()}
    seen: set[int] = set()
    position = 0

    def varint() -> int:
        nonlocal position
        value = 0
        for shift in range(0, 70, 7):
            byte = raw[position]
            position += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError("invalid-varint")

    try:
        while position < len(raw):
            field, wire = divmod(varint(), 8)
            if not 0 < field < 2**29 or (field in expected and wire != 2):
                return False
            if wire == 0:
                varint()
            elif wire == 1:
                position += 8
            elif wire == 2:
                length = varint()
                end = position + length
                if field in expected:
                    if (
                        field in seen
                        or length != len(expected[field])
                        or raw[position:end] != expected[field]
                    ):
                        return False
                    seen.add(field)
                position = end
            elif wire == 5:
                position += 4
            else:
                return False
            if position > len(raw):
                return False
    except (IndexError, ValueError):
        return False
    return seen == expected.keys()


# ScannerReport wire layout and delimited writer, SonarSource/sonarqube
# 25.12.0.117093. This is an optional lower bound, never a CE metric.
CPD_TOTAL_LIMIT = 64 * 1024 * 1024
CPD_FILE_LIMIT = 8 * 1024 * 1024
CPD_COUNT_LIMIT = 2048
CPD_ORIGIN_LIMIT = 50_000
CPD_CHANGED_LIMIT = 250_000
SAFE_TRACKED_PATH = re.compile(rb"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*")


def pb_varint(raw: bytes, pos: int) -> tuple[int, int]:
    value = 0
    for shift in range(0, 70, 7):
        if pos == len(raw):
            break
        byte = raw[pos]
        pos += 1
        if shift == 63 and byte > 1:
            break
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
    raise ValueError("scanner-wire-varint")


def pb_fields(raw: bytes) -> Iterator[tuple[int, int | bytes]]:
    pos = 0
    while pos < len(raw):
        key, pos = pb_varint(raw, pos)
        field, wire = divmod(key, 8)
        if not 0 < field < 2**29:
            raise ValueError("scanner-wire-field")
        if wire == 0:
            value, pos = pb_varint(raw, pos)
            yield field, value
        elif wire == 2:
            size, pos = pb_varint(raw, pos)
            end = pos + size
            if end > len(raw):
                raise ValueError("scanner-wire-size")
            yield field, raw[pos:end]
            pos = end
        elif wire in (1, 5):
            pos += 8 if wire == 1 else 4
            if pos > len(raw):
                raise ValueError("scanner-wire-size")
        else:
            raise ValueError("scanner-wire-type")


def unique_fields(raw: bytes, keys: set[int]) -> dict[int, int | bytes]:
    result: dict[int, int | bytes] = {}
    for field, value in pb_fields(raw):
        if field not in keys:
            continue
        if field in result:
            raise ValueError("scanner-duplicate-field")
        result[field] = value
    return result


def git_regular_paths(workspace: Path, sha: str) -> set[bytes]:
    head = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"],
        cwd=workspace,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=5,
        check=True,
    )
    if head.stdout.strip() != sha.encode("ascii"):
        raise ValueError("scanner-git-sha")
    subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--no-ext-diff", "HEAD", "--"],
        cwd=workspace,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=5,
        check=True,
    )
    with subprocess.Popen(
        ["git", "ls-files", "--stage", "-z"],
        cwd=workspace,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ) as proc:
        assert proc.stdout is not None
        try:
            data = proc.stdout.read(MAX_BODY + 1)
            if len(data) > MAX_BODY or proc.wait(timeout=5):
                raise ValueError("scanner-git-index")
        finally:
            if proc.poll() is None:
                proc.kill()
    if data and not data.endswith(b"\0"):
        raise ValueError("scanner-git-index")
    paths: set[bytes] = set()
    for entry in data.split(b"\0")[:-1]:
        info, path = entry.split(b"\t", 1)
        mode, _, stage = info.split(b" ")
        if stage == b"0" and mode in {b"100644", b"100755"}:
            paths.add(path)
    return paths


def cpd_origin_rows(report: int, refs: list[int], workspace: Path, sha: str) -> str:
    if len(refs) > CPD_COUNT_LIMIT:
        return "scanner-local-report-limit"
    remaining_bytes = CPD_TOTAL_LIMIT
    remaining_origins = CPD_ORIGIN_LIMIT
    remaining_lines = CPD_CHANGED_LIMIT

    def read(name: str, limit: int) -> bytes:
        nonlocal remaining_bytes
        descriptor = os.open(
            name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=report
        )
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("scanner-report-type")
            cap = min(limit, remaining_bytes)
            data = stream.read(cap + 1)
        if len(data) > cap:
            raise OverflowError("scanner-report-limit")
        remaining_bytes -= len(data)
        return data

    paths = git_regular_paths(workspace, sha)
    missing = 0
    counts: dict[bytes, int] = {}
    seen: set[bytes] = set()
    for ref in refs:
        comp = unique_fields(read(f"component-{ref}.pb", MAX_BODY), {1, 4, 5, 11, 14})
        if comp.get(1) != ref or comp.get(4) != 4 or comp.get(5, 0) not in {0, 1}:
            raise ValueError("scanner-component")
        if comp.get(5) == 1:
            continue
        path, lines = comp.get(14), comp.get(11)
        if (
            not isinstance(path, bytes)
            or not isinstance(lines, int)
            or not 0 < lines < 2**31
        ):
            raise ValueError("scanner-component")
        if path in seen:
            raise ValueError("scanner-component")
        seen.add(path)
        if (
            len(path) > 240
            or path not in paths
            or not SAFE_TRACKED_PATH.fullmatch(path)
        ):
            continue
        if any(part in {b".", b".."} for part in path.split(b"/")):
            continue
        try:
            data = read(f"changed-lines-{ref}.pb", MAX_BODY)
        except FileNotFoundError:
            missing += 1
            continue
        changed: set[int] = set()

        def add(line: int) -> None:
            nonlocal remaining_lines
            remaining_lines -= 1
            if remaining_lines < 0:
                raise OverflowError("scanner-report-limit")
            if not 0 < line <= lines:
                raise ValueError("scanner-changed-line")
            changed.add(line)

        for field, value in pb_fields(data):
            if field != 1:
                raise ValueError("scanner-changed-field")
            if isinstance(value, int):
                add(value)
            else:
                pos = 0
                while pos < len(value):
                    line, pos = pb_varint(value, pos)
                    add(line)
        if not changed:
            continue

        raw = read(f"duplications-{ref}.pb", CPD_FILE_LIMIT)
        intervals = []
        pos = 0
        while pos < len(raw):
            remaining_origins -= 1
            if remaining_origins < 0:
                raise OverflowError("scanner-report-limit")
            size, pos = pb_varint(raw, pos)
            end = pos + size
            if end > len(raw):
                raise ValueError("scanner-duplication-frame")
            row = unique_fields(raw[pos:end], {1}).get(1)
            if not isinstance(row, bytes):
                raise ValueError("scanner-duplication-origin")
            span = unique_fields(row, {1, 2})
            first, last = span.get(1), span.get(2)
            if (
                not isinstance(first, int)
                or not isinstance(last, int)
                or not 0 < first <= last <= lines
            ):
                raise ValueError("scanner-duplication-range")
            intervals.append((first, last))
            pos = end
        cursor = 0
        count = 0
        ordered = sorted(changed)
        for first, last in sorted(intervals):
            while cursor < len(ordered) and ordered[cursor] < first:
                cursor += 1
            while cursor < len(ordered) and ordered[cursor] <= last:
                count += 1
                cursor += 1
        if count:
            counts[path] = count
    if not counts:
        return (
            "scanner-local-changed-lines-missing"
            if missing
            else "scanner-local-no-changed-origin-lines"
        )
    result = [
        "Scanner-local changed duplicate origins (origin-only lower bound; not server metrics):",
        "",
        "| Tracked source file | Changed origin lines |",
        "| --- | ---: |",
    ]
    for path, count in sorted(counts.items(), key=lambda row: (-row[1], row[0]))[:10]:
        result.append(f"| `{path.decode('ascii')}` | {count} |")
    if missing:
        result.extend(
            ("", f"{missing} tracked source file records had no changed-lines data.")
        )
    return "\n".join(result)


def scanner_local_presence(workspace: Path, sha: str, *, origins: bool = False) -> str:
    """Return aggregate presence or bounded origin-only file counts."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        cwd = os.open(workspace, flags)
        try:
            work = os.open(".scannerwork", flags, dir_fd=cwd)
            try:
                report = os.open("scanner-report", flags, dir_fd=work)
                try:
                    metadata = os.open(
                        "metadata.pb",
                        os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW,
                        dir_fd=report,
                    )
                    with os.fdopen(metadata, "rb") as source:
                        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                            return "scanner-local-report-unavailable"
                        raw = source.read(MAX_BODY + 1)
                    if not scanner_metadata_matches(raw, sha):
                        return "scanner-local-metadata-mismatch"
                    with os.scandir(report) as entries:
                        refs: list[int] = []
                        for total, entry in enumerate(entries, 1):
                            if total > 100_000:
                                return "scanner-local-report-limit"
                            if re.fullmatch(
                                r"duplications-[1-9][0-9]{0,8}\.pb", entry.name
                            ):
                                if not entry.is_file(follow_symlinks=False):
                                    return "scanner-local-report-unavailable"
                                refs.append(int(entry.name[13:-3]))
                    status = f"same-scan-metadata; {len(refs)} scanner-local CPD record files"
                    if not origins:
                        return status
                    try:
                        details = cpd_origin_rows(report, refs, workspace, sha)
                    except OverflowError:
                        details = "scanner-local-report-limit"
                    except (OSError, ValueError, subprocess.SubprocessError):
                        details = "scanner-local-origin-data-unavailable"
                    return f"{status} (not server metrics).\n\n{details}"
                finally:
                    os.close(report)
            finally:
                os.close(work)
        finally:
            os.close(cwd)
    except (OSError, ValueError):
        return "scanner-local-report-unavailable"


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
        read = sonar_reader(os.environ.get("SONAR_TOKEN", ""))
        result = collect(receipt, os.environ.get("PR_BRANCH", ""), read)
        summary = summarize(result)
        if any(
            isinstance(row, dict)
            and row.get("metricKey") == "new_duplicated_lines_density"
            and row.get("status") == "ERROR"
            for row in result["conditions"]
        ):
            capability = duplication_capability(read)
            summary += f"\nPer-file duplication readback: `{capability}`.\n"
            presence = "scanner-local-retention-not-enabled"
            if os.environ.get("SONAR_KEEP_LOCAL_REPORT") == "true":
                presence = scanner_local_presence(
                    Path.cwd(), os.environ.get("PR_SHA", ""), origins=True
                )
            summary += f"\nLocal scanner report: {presence}\n"

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
