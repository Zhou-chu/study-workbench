"""Synthetic driver fixture for audio playback test layers."""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def audio(monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / "scripts/v1"))
    monkeypatch.setitem(
        sys.modules,
        "playwright.sync_api",
        SimpleNamespace(expect=None, sync_playwright=None),
    )
    spec = importlib.util.spec_from_file_location(
        "audio_review", root / "scripts/v1/audio_playback_check.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Python 3.11 accepts no delete= keyword. Exercise that API contract even
    # when this focused suite is running under prepared Python 3.12.
    original_temporary_directory = module.tempfile.TemporaryDirectory

    def python311_temporary_directory(
        suffix=None, prefix=None, dir=None, ignore_cleanup_errors=False
    ):
        return original_temporary_directory(
            suffix=suffix,
            prefix=prefix,
            dir=dir,
            ignore_cleanup_errors=ignore_cleanup_errors,
        )

    monkeypatch.setattr(
        module.tempfile, "TemporaryDirectory", python311_temporary_directory
    )
    return module
