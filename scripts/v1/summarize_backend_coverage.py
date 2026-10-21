"""Separate upstream-wide, V1 file and V1 changed-line pytest coverage.

Requires a Git checkout/bundle containing the pinned upstream baseline. This does
not merge separate uninstrumented native/browser runs into pytest coverage.
"""

import argparse
import difflib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--baseline", default="a0f6f3081ae06328f0a451b3a3ef2959ca25721d")
parser.add_argument(
    "--coverage", default="docs/v1/evidence/coverage/backend/coverage.json"
)
parser.add_argument("--out", default="docs/v1/evidence/coverage/backend/summary.json")
args = parser.parse_args()
report = json.loads(Path(args.coverage).read_text())
names = set(
    subprocess.check_output(
        ["git", "diff", "--name-only", args.baseline], text=True
    ).splitlines()
)
names.update(
    subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard"], text=True
    ).splitlines()
)
files = sorted(
    name
    for name in names
    if name.endswith(".py") and name.startswith(("api/", "commands/", "open_notebook/"))
)
keys = (
    "covered_lines",
    "num_statements",
    "covered_branches",
    "num_branches",
    "missing_lines",
    "missing_branches",
)
summary = {
    "measurement": "Full pytest suite, including injected-fake and CPU/service tests; opt-in native skipped. Separate native/browser runs are not instrumented or merged.",
    "baseline": args.baseline,
    "all_production": report["totals"],
    "v1_changed_and_new_production_files": {
        "files": files,
        "unreported_files": [name for name in files if name not in report["files"]],
        "totals": {
            key: sum(
                report["files"].get(name, {}).get("summary", {}).get(key, 0)
                for name in files
            )
            for key in keys
        },
        "per_file": {
            name: report["files"][name]["summary"]
            for name in files
            if name in report["files"]
        },
    },
}
rows = {}
for name in files:
    if name not in report["files"]:
        continue
    data = report["files"][name]
    old = subprocess.run(
        ["git", "show", f"{args.baseline}:{name}"], capture_output=True, text=True
    )
    old_lines = old.stdout.splitlines() if old.returncode == 0 else []
    changed: set[int] = set()
    for tag, _, _, start, end in difflib.SequenceMatcher(
        None, old_lines, Path(name).read_text().splitlines(), autojunk=False
    ).get_opcodes():
        if tag in ("replace", "insert"):
            changed.update(range(start + 1, end + 1))
    covered = len(changed & set(data["executed_lines"]))
    missing = len(changed & set(data["missing_lines"]))
    branches = sum(start in changed for start, _ in data.get("executed_branches", []))
    missing_branches = sum(
        start in changed for start, _ in data.get("missing_branches", [])
    )
    rows[name] = {
        "covered_lines": covered,
        "total_lines": covered + missing,
        "covered_branches": branches,
        "total_branches": branches + missing_branches,
    }
summary["v1_added_modified_executable_lines"] = {
    "method": "New/replaced executable line numbers versus pinned upstream; removed lines excluded. Branches counted when their source line is new/replaced. Whole changed-file coverage is separately reported.",
    "totals": {
        key: sum(row[key] for row in rows.values())
        for key in (
            "covered_lines",
            "total_lines",
            "covered_branches",
            "total_branches",
        )
    },
    "per_file": rows,
}
Path(args.out).write_text(json.dumps(summary, indent=2) + "\n")
print(
    json.dumps(
        {key: value for key, value in summary.items() if key.endswith("production")}
    )
)
