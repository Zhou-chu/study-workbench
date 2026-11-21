"""AST-isolated QA fixture contract; never runs the browser/service harness."""

import ast
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[1] / "apps/web/scripts/settings-controls-review.py"
)


def load_fallback(value):
    """Run only fallback extraction and its adjacent validation, not fixture exec."""
    body = ast.parse(SCRIPT.read_text()).body
    start = next(
        i
        for i, node in enumerate(body)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(t, ast.Name) and t.id == "fallback_candidate"
            for t in node.targets
        )
    )
    nodes = [body[start]]
    if isinstance(body[start + 1], ast.If):
        nodes.append(body[start + 1])
        nodes.append(body[start + 2])
    namespace = {"fixture": {"api": value}}
    exec(
        compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), "exec"), namespace
    )
    return namespace["fallback"]


@pytest.mark.parametrize("value", [None, "synthetic-invalid-handler", 42, {}])
def test_invalid_fixture_handler_fails_before_preview_start(value):
    with pytest.raises(
        RuntimeError, match="^Synthetic fixture API handler is not callable$"
    ):
        load_fallback(value)


def test_valid_fixture_handler_preserves_identity_and_route():
    seen = []

    def handler(route):
        seen.append(route)
        return "handled"

    route = object()
    fallback = load_fallback(handler)
    assert fallback is handler
    assert fallback(route) == "handled"
    assert seen == [route]
