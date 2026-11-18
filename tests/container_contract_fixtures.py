"""Load exact local deployment source and the tracked Compose fixture."""

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(path):
    assert (ROOT / path).is_file(), f"Missing deployment contract: {path}"
    spec = importlib.util.spec_from_file_location(Path(path).stem, ROOT / path)
    assert spec is not None, f"Cannot create module specification: {path}"
    assert spec.loader is not None, f"Missing module loader: {path}"
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def manifest():
    assert (ROOT / "deploy/v1/compose.yaml").is_file()
    # JSON is a YAML 1.2 subset; stdlib parsing keeps this check dependency-free.
    return json.loads((ROOT / "deploy/v1/compose.yaml").read_text())
