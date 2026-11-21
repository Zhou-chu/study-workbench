"""Validate same-revision coverage formats and prepare repository-relative scan inputs."""

from __future__ import annotations

import argparse
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

PARTITION_ROOTS = {
    "bff": "apps/bff",
    "contracts": "packages/contracts",
    "deployment-config": "",
    "domain": "packages/domain",
    "legacy-node-tools": "",
    "legacy-web": "frontend",
    "node-tools": "",
    "quality-configs": "",
    "quality-tooling": "",
    "web": "apps/web",
    "web-transport": "packages/web-transport",
}
JS_SUFFIXES = {".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"}
PYTHON_ROOTS = {"api", "open_notebook", "commands", "scripts", "deploy", "apps"}


class ReportError(ValueError):
    """The scanner handoff could not prove it has usable coverage inputs."""


def valid_relative(path: str) -> bool:
    return not re.search(r"[:\\\x00-\x1f\x7f]", path) and all(
        part not in {"", ".", ".."} for part in path.split("/")
    )


def text(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ReportError("Coverage report is not UTF-8") from exc


def normalize_lcov(partition: str, data: bytes, tracked: set[str]) -> bytes:
    """Change only SF path bytes; never reconstruct counters or reorder records."""
    if partition not in PARTITION_ROOTS:
        raise ReportError(f"Unknown LCOV partition: {partition}")
    root = PARTITION_ROOTS[partition]
    seen: set[str] = set()
    active = False
    measured = False
    output: list[bytes] = []
    for raw in data.splitlines(keepends=True):
        line = raw.rstrip(b"\r\n")
        if line.startswith(b"SF:"):
            path = text(line[3:])
            canonical = f"{root}/{path}" if root else path
            if (
                active
                or not valid_relative(path)
                or canonical in seen
                or canonical not in tracked
                or Path(canonical).suffix not in JS_SUFFIXES
            ):
                raise ReportError(
                    f"Invalid, duplicate, or untracked LCOV source: {path}"
                )
            seen.add(canonical)
            active = True
            raw = b"SF:" + canonical.encode() + raw[len(line) :]
        elif line == b"end_of_record":
            if not active:
                raise ReportError("LCOV record missing source")
            active = False
        elif line.startswith(b"DA:") and active:
            if not re.fullmatch(rb"DA:[1-9][0-9]*,[0-9]+(?:,[A-Za-z0-9+/=]+)?", line):
                raise ReportError("Malformed LCOV line counter")
            measured = True
        elif not active and line and not line.startswith(b"TN:"):
            raise ReportError("Unexpected LCOV data outside a record")
        output.append(raw)
    if not seen or active or not measured:
        raise ReportError(f"Empty or incomplete LCOV partition: {partition}")
    return b"".join(output)


def normalize_cobertura(data: bytes, tracked: set[str]) -> bytes:
    """Accept coverage.py's repository-relative Cobertura, not JUnit or historical absolute paths."""
    xml = text(data)
    if "<!DOCTYPE" in xml or "<!ENTITY" in xml:
        raise ReportError("Declarations are not allowed in coverage XML")
    try:
        doc = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ReportError("Invalid coverage XML") from exc
    if doc.tag != "coverage" or not re.fullmatch(
        r"\d+(?:\.\d+)+", doc.get("version", "")
    ):
        raise ReportError("Expected coverage.py Cobertura, not test results")
    for prefix in ("lines", "branches"):
        valid, covered = (
            doc.get(f"{prefix}-{suffix}", "") for suffix in ("valid", "covered")
        )
        if (
            not valid.isdecimal()
            or not covered.isdecimal()
            or int(covered) > int(valid)
        ):
            raise ReportError("Invalid Cobertura report totals")
    sources = doc.findall("./sources")
    if (
        len(sources) != 1
        or not len(sources[0])
        or any(
            node.tag != "source" or (node.text or "").strip() not in {"", "."}
            for node in sources[0]
        )
    ):
        raise ReportError(
            "Coverage XML must use the repository root as its only source"
        )
    seen: set[str] = set()
    line_count = 0
    hit_count = 0
    for node in doc.findall("./packages/package/classes/class"):
        path = node.get("filename", "")
        if (
            not valid_relative(path)
            or path in seen
            or path not in tracked
            or not path.endswith(".py")
            or (path != "run_api.py" and path.split("/")[0] not in PYTHON_ROOTS)
        ):
            raise ReportError(
                f"Invalid, duplicate, or untracked Cobertura source: {path}"
            )
        seen.add(path)
        numbers: set[int] = set()
        for line in node.findall("./lines/line"):
            number = line.get("number", "")
            hits = line.get("hits", "")
            if not number.isdecimal() or not int(number) or not hits.isdecimal():
                raise ReportError(f"Invalid Cobertura line in {path}")
            if int(number) in numbers:
                raise ReportError(f"Duplicate Cobertura line in {path}")
            numbers.add(int(number))
            line_count += 1
            hit_count += int(hits) > 0
    if (
        not seen
        or not line_count
        or line_count != int(doc.attrib["lines-valid"])
        or hit_count != int(doc.attrib["lines-covered"])
    ):
        raise ReportError("Empty or inconsistent Cobertura line totals")
    if len(sources[0]) == 1 and sources[0][0].text == ".":
        return data
    # coverage.py 7.14.3 may emit both an empty source and '.'. Keep one
    # canonical source so scanners do not resolve the same path twice.
    sources[0].clear()
    ET.SubElement(sources[0], "source").text = "."
    return ET.tostring(doc, encoding="utf-8", xml_declaration=True)


def tracked_files(repo: Path, revision: str) -> set[str]:
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ReportError("Expected a full commit SHA")
    if (
        subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
        ).strip()
        != revision
    ):
        raise ReportError("Checkout revision does not match coverage input revision")
    tree = subprocess.check_output(
        ["git", "-C", str(repo), "ls-tree", "-r", "-z", revision]
    )
    return {
        text(path)
        for record in tree.split(b"\0")
        if record
        for entry, path in [record.split(b"\t", 1)]
        if entry.split(b" ", 1)[0] in {b"100644", b"100755"}
    }


def read_report(root: Path, report: Path) -> bytes:
    path = root / report
    if not path.is_file() or path.resolve() != path:
        raise ReportError(f"Missing or indirect coverage report: {report}")
    return path.read_bytes()


def prepare(repo: Path, revision: str, bundle: Path, output: Path) -> None:
    tracked = tracked_files(repo, revision)
    bundle = bundle.absolute()
    reports = {
        f"{partition}.lcov.info": normalize_lcov(
            partition, read_report(bundle, Path(partition) / "lcov.info"), tracked
        )
        for partition in PARTITION_ROOTS
    }
    seen: set[bytes] = set()
    for data in reports.values():
        for line in data.splitlines():
            if line.startswith(b"SF:"):
                if line in seen:
                    raise ReportError(
                        f"LCOV path appears in multiple partitions: {text(line[3:])}"
                    )
                seen.add(line)
    reports["python.xml"] = normalize_cobertura(
        read_report(bundle, Path("python.xml")), tracked
    )
    output.mkdir()
    for name, data in reports.items():
        (output / name).write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        prepare(args.repo, args.revision, args.bundle, args.output)
    except (OSError, ReportError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
