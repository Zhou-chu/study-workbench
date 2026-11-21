"""Load the trusted, import-safe model setup QA module across layers."""

import ast
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "apps/web/scripts/model-setup-journey-review.py"


@pytest.fixture
def review():
    tree = ast.parse(SCRIPT.read_text())
    assert any(
        isinstance(node, ast.FunctionDef) and node.name == "main" for node in tree.body
    ), "QA script must be import-safe before exercising it"
    spec = importlib.util.spec_from_file_location("model_setup_review", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
