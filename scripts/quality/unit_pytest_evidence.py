"""Native pytest evidence and explicit empty-partition coverage, not a sandbox."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def pytest_addoption(parser):
    parser.addoption("--unit-evidence", action="store", default=None)


def pytest_configure(config):
    output = config.getoption("--unit-evidence")
    if output:
        config.pluginmanager.register(
            ExecutionEvidence(Path(output)), "unit-execution-evidence"
        )


class ExecutionEvidence:
    def __init__(self, output: Path):
        self.output = output
        self.root = Path.cwd().resolve()
        self.value = {
            "version": 1,
            "complete": False,
            "collected": [],
            "reports": [],
            "deselected": [],
            "collectionFailures": [],
        }

    def pytest_collection_finish(self, session):
        self.value["collected"] = [
            {
                "nodeid": item.nodeid,
                "file": Path(item.path).resolve().relative_to(self.root).as_posix(),
            }
            for item in session.items
        ]

    def pytest_deselected(self, items):
        self.value["deselected"].extend(item.nodeid for item in items)

    def pytest_collectreport(self, report):
        if report.failed:
            self.value["collectionFailures"].append(report.nodeid)

    def pytest_runtest_logreport(self, report):
        self.value["reports"].append(
            {
                "nodeid": report.nodeid,
                "when": report.when,
                "outcome": report.outcome,
                "wasxfail": hasattr(report, "wasxfail"),
            }
        )

    def pytest_sessionfinish(self, session, exitstatus):
        self.value.update(complete=True, sessionExitCode=int(exitstatus))
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(
            json.dumps(self.value, indent=2) + "\n", encoding="utf-8"
        )


def empty_partition(request_path: str) -> int:
    # Same fixed checkout and environment contract as offline_pytest; no test discovery.
    sys.path.insert(0, str(ROOT))
    from scripts.offline_pytest import build_environment, network_guard, prepare_cache

    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    output = Path(request["output"]).resolve()
    config = Path(request["config"]).resolve()
    with tempfile.TemporaryDirectory(prefix="notebook-empty-unit-") as temporary:
        environment = build_environment(Path(temporary), os.environ)
        prepare_cache(Path(request["cache"]), Path(environment["TIKTOKEN_CACHE_DIR"]))
        os.environ.clear()
        os.environ.update(environment)
        sys.addaudithook(network_guard)
        os.chdir(ROOT)
        import coverage
        from coverage.cmdline import main as coverage_main

        measured = coverage.Coverage(config_file=str(config))
        measured.erase()
        measured.start()
        measured.stop()
        measured.save()
        json_exit = coverage_main(
            ["json", "--rcfile=" + str(config), "-o", str(output / "coverage.json")]
        )
        xml_exit = coverage_main(
            ["xml", "--rcfile=" + str(config), "-o", str(output / "coverage.xml")]
        )
        evidence = {
            "version": 1,
            "complete": True,
            "mode": "empty",
            "sessionExitCode": None,
            "collected": [],
            "reports": [],
            "deselected": [],
            "collectionFailures": [],
            "coverageJsonExitCode": json_exit,
            "coverageXmlExitCode": xml_exit,
        }
        (output / "execution.json").write_text(
            json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
        )
        return max(json_exit, xml_exit)


if __name__ == "__main__":
    if sys.argv[1:2] != ["--empty"] or len(sys.argv) != 3:
        raise SystemExit("Only explicit --empty REQUEST is supported")
    raise SystemExit(empty_partition(sys.argv[2]))
