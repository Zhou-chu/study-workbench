"""Import/report contracts without browser, preview subprocess or report writes."""

import ast
import importlib.util
import json
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import pytest

SCRIPT = Path(__file__).parents[1] / "apps/web/scripts/model-setup-journey-review.py"


@pytest.fixture
def review(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("Import must not launch a review")

    monkeypatch.setattr("subprocess.Popen", forbidden)
    monkeypatch.setattr("socket.socket", forbidden)
    spec = importlib.util.spec_from_file_location("review_report_contract", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def initial_report(review: ModuleType) -> dict[str, object]:
    """Evaluate only the exact existing report literal, never run_review."""
    tree = ast.parse(SCRIPT.read_text())
    function = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "run_review"
    )
    assignment = next(
        n
        for n in function.body
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "report" for t in n.targets)
    )
    value = eval(
        compile(ast.Expression(assignment.value), str(SCRIPT), "eval"), vars(review)
    )
    assert isinstance(value, dict)
    return value


def test_import_leaves_child_runtime_state_uninitialized(review: ModuleType) -> None:
    assert "report" not in vars(review)
    assert "OUT" not in vars(review)
    assert "expect" not in vars(review)
    assert "sync_playwright" not in vars(review)
    assert "report" in review.__annotations__ and "OUT" in review.__annotations__


def test_initial_report_keys_match_required_schema_and_json_shape(
    review: ModuleType,
) -> None:
    value = initial_report(review)
    assert set(value) == review.ReviewReport.__required_keys__
    assert not review.ReviewReport.__optional_keys__ & set(value)
    assert value["results"] == [] and value["network"] == []
    assert value["failures"] == [] and value["source_files"] == {}
    assert json.loads(json.dumps(value)) == value


def test_failure_appends_original_serializable_contract(
    review: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    value = initial_report(review)
    monkeypatch.setattr(review, "report", value, raising=False)
    review.failure("synthetic-case", ValueError("synthetic detail"))
    assert value["failures"] == [
        {"case": "synthetic-case", "detail": "synthetic detail"}
    ]
    assert json.loads(json.dumps(value))["failures"] == value["failures"]


@pytest.mark.parametrize(
    ("focus", "failure_reason"),
    [
        ({"label": "target", "visibleFocus": True, "outlineWidth": "2px"}, None),
        ({"label": "other", "visibleFocus": True, "outlineWidth": "2px"}, "target"),
        ({"label": "target", "visibleFocus": False, "outlineWidth": "2px"}, "outline"),
        ({"label": "target", "visibleFocus": True, "outlineWidth": "1px"}, "outline"),
        ({"label": "target", "visibleFocus": True, "outlineWidth": "nanpx"}, "outline"),
    ],
)
def test_keyboard_focus_requires_expected_label_and_visible_outline(
    review: ModuleType, focus: dict[str, object], failure_reason: str | None
) -> None:
    if failure_reason is None:
        review.require_keyboard_focus(focus, "target")
    else:
        with pytest.raises(ValueError, match=failure_reason):
            review.require_keyboard_focus(focus, "target")


def test_keyboard_review_rejects_mutating_requests_only_in_its_own_case(
    review: ModuleType,
) -> None:
    records = [
        {"case": "keyboard", "method": "GET"},
        {"case": "other", "method": "POST"},
    ]
    review.require_read_only_case(records, "keyboard")
    with pytest.raises(ValueError, match="keyboard.*POST"):
        review.require_read_only_case(
            [*records, {"case": "keyboard", "method": "POST"}], "keyboard"
        )


@pytest.mark.parametrize("issue", [None, "overflow", "language"])
def test_capture_keeps_result_fields_and_failure_contract_without_files(
    review: ModuleType, monkeypatch: pytest.MonkeyPatch, issue: str | None
) -> None:
    value = initial_report(review)
    monkeypatch.setattr(review, "report", value, raising=False)
    monkeypatch.setattr(review, "OUT", review.ROOT / "synthetic-report", raising=False)
    monkeypatch.setattr(review, "BASELINE", True)
    metrics = {
        "width": 390,
        "documentWidth": 390,
        "overflow": issue == "overflow",
        "theme": "light",
        "language": "en" if issue == "language" else "zh-CN",
        "outliers": [],
    }
    page = Mock()
    page.evaluate.side_effect = [None, metrics]
    review.capture(page, "case", "empty", 390, "light")
    results = value["results"]
    assert isinstance(results, list) and len(results) == 1
    row = results[0]
    assert row["tag"] == "case" and row["scenario"] == "empty"
    assert row["full_screenshot"] == "synthetic-report/case-full.png"
    assert row["viewport_screenshot"] == "synthetic-report/case-viewport.png"
    assert row["guide_screenshot"] is None and row["guide_clip_note"] is None
    assert row["text_scale"] == 1 and row["width"] == 390
    assert page.screenshot.call_count == 2
    failures = value["failures"]
    assert isinstance(failures, list)
    assert len(failures) == (0 if issue is None else 1)
    assert json.loads(json.dumps(value)) == value
