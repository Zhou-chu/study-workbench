"""Submission/status doubles and unsupported command fixture matrix."""

from unittest.mock import AsyncMock, Mock

import pytest

from api import command_service

CASES = [
    (
        "list_command_jobs",
        (),
        "GET",
        "/api/commands/jobs",
        "GENERIC_COMMAND_LISTING_UNSUPPORTED",
    ),
    (
        "cancel_command_job",
        ("command:fixture",),
        "DELETE",
        "/api/commands/jobs/command:fixture",
        "GENERIC_COMMAND_CANCELLATION_UNSUPPORTED",
    ),
]


@pytest.fixture
def backend(monkeypatch):
    submit = Mock(side_effect=AssertionError("unexpected submission"))
    status = AsyncMock(side_effect=AssertionError("unexpected status lookup"))
    monkeypatch.setattr(command_service, "submit_command", submit)
    monkeypatch.setattr(command_service, "get_command_status", status)
    return submit, status
