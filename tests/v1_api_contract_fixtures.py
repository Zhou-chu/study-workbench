"""Exact authored public contract fixture used across tests."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORTER = ROOT / "scripts/v1/export_contract.py"
CONTRACT = ROOT / "contracts/v1/openapi.json"
FIXTURES = ROOT / "contracts/v1/fixtures"


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())
