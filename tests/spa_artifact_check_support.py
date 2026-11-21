"""Load the tracked independent SPA artifact checker without launching it."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def checker():
    path = ROOT / "scripts/v1/check_spa_artifacts.py"
    assert path.is_file(), "Independent Web/BFF validator missing"
    spec = importlib.util.spec_from_file_location("spa_artifacts", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
