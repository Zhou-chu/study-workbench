"""Non-collected synthetic fixtures shared by isolated and integration cases."""

import json
from pathlib import Path

FIXTURE = Path(__file__).parents[1] / "contracts/v1/fixtures/workspace-view-v1.json"


def example():
    return json.loads(FIXTURE.read_text())
