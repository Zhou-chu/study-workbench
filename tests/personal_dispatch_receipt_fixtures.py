"""Authored synthetic dispatch-uncertainty fixture."""

import json
from pathlib import Path

FIXTURE = json.loads(
    (
        Path(__file__).parents[1] / "contracts/v1/fixtures/dispatch-unknown.json"
    ).read_text()
)
