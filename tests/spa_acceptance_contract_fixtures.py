"""Load the trusted acceptance contract without starting tools."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def helper():
    path = ROOT / "scripts/v1/spa_acceptance.py"
    assert path.is_file(), "Inert C2 ownership/evidence helper is missing"
    spec = importlib.util.spec_from_file_location("spa_acceptance", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
