"""Compute browser environment from a path value and synthetic inputs only."""

import importlib
from pathlib import Path


def test_browser_child_environment_drops_fixture_and_parent_credentials():
    browser = importlib.import_module("scripts.v1.browser_check")
    environment = browser.browser_environment(
        Path("/synthetic/profile"),
        {
            "PATH": "/safe",
            "OPEN_NOTEBOOK_PASSWORD": "fixture",
            "STUDY_WORKBENCH_ACCEPTANCE_TOKEN": "parent",
            "HTTPS_PROXY": "private",
            "NODE_OPTIONS": "injection",
        },
    )
    assert environment["PATH"] == "/safe"
    assert environment["HOME"] == "/synthetic/profile"
    assert all(
        name not in environment
        for name in (
            "OPEN_NOTEBOOK_PASSWORD",
            "STUDY_WORKBENCH_ACCEPTANCE_TOKEN",
            "HTTPS_PROXY",
            "NODE_OPTIONS",
        )
    )
