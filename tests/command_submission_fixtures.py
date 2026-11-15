"""Static schema and fake-connection submission fixture values."""

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel

from open_notebook.utils import command_submission as bridge


class Choice(Enum):
    FIRST = "first"


class Input(BaseModel):
    when: datetime
    choice: Choice


def submit():
    return bridge.submit_command(
        "app",
        "name",
        {"when": datetime(2026, 10, 22, tzinfo=timezone.utc), "choice": Choice.FIRST},
        context={"trace": "fixture", "nested": {"values": [1, None]}},
    )
