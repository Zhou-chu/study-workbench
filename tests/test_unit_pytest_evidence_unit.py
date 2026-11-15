"""Record callbacks and exit policy without executing the environment-changing runner."""

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts.quality import unit_pytest_evidence as evidence


@pytest.mark.parametrize(
    "json_exit,xml_exit,expected",
    [
        (0, 0, 0),
        (0, 2, 2),
        (2, 0, 2),
        (2, 2, 2),
        (None, 0, 1),
        (0, None, 1),
        (None, None, 1),
        (None, 2, 2),
        (2, None, 2),
    ],
)
def test_report_exit_status_preserves_native_failures_and_rejects_missing_status(
    json_exit: int | None, xml_exit: int | None, expected: int
) -> None:
    assert evidence.coverage_exit_status(json_exit, xml_exit) == expected


def test_callbacks_preserve_complete_execution_record_without_filesystem_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mkdir = Mock()
    write_text = Mock()
    monkeypatch.setattr(Path, "mkdir", mkdir)
    monkeypatch.setattr(Path, "write_text", write_text)
    recorder = evidence.ExecutionEvidence(Path("synthetic-output/execution.json"))
    recorder.pytest_collection_finish(
        SimpleNamespace(
            items=[
                SimpleNamespace(
                    nodeid="tests/example.py::test_ok",
                    path=recorder.root / "tests/example.py",
                ),
            ]
        )
    )
    recorder.pytest_deselected([SimpleNamespace(nodeid="tests/other.py::test_other")])
    recorder.pytest_collectreport(SimpleNamespace(failed=False, nodeid="ignored"))
    recorder.pytest_collectreport(SimpleNamespace(failed=True, nodeid="broken.py"))
    recorder.pytest_runtest_logreport(
        SimpleNamespace(
            nodeid="tests/example.py::test_ok",
            when="call",
            outcome="passed",
        )
    )
    recorder.pytest_runtest_logreport(
        SimpleNamespace(
            nodeid="tests/example.py::test_xfail",
            when="call",
            outcome="skipped",
            wasxfail="reason",
        )
    )
    assert recorder.value["complete"] is False
    assert "sessionExitCode" not in recorder.value
    recorder.pytest_sessionfinish(None, 2)
    mkdir.assert_called_once_with(parents=True, exist_ok=True)
    write_text.assert_called_once()
    encoded = write_text.call_args.args[0]
    assert encoded.endswith("\n")
    assert write_text.call_args.kwargs == {"encoding": "utf-8"}
    assert json.loads(encoded) == {
        "version": 1,
        "complete": True,
        "sessionExitCode": 2,
        "collected": [
            {"nodeid": "tests/example.py::test_ok", "file": "tests/example.py"}
        ],
        "deselected": ["tests/other.py::test_other"],
        "collectionFailures": ["broken.py"],
        "reports": [
            {
                "nodeid": "tests/example.py::test_ok",
                "when": "call",
                "outcome": "passed",
                "wasxfail": False,
            },
            {
                "nodeid": "tests/example.py::test_xfail",
                "when": "call",
                "outcome": "skipped",
                "wasxfail": True,
            },
        ],
    }
