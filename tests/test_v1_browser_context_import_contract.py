"""Browser command loading must not import or start the browser package."""

import builtins
import importlib
import sys


def test_browser_check_import_does_not_import_or_start_playwright(monkeypatch):
    original = builtins.__import__

    def reject_playwright(name, *args, **kwargs):
        if name.startswith("playwright"):
            raise AssertionError("Playwright imported before context validation")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_playwright)
    sys.modules.pop("scripts.v1.browser_check", None)
    failure = None
    try:
        importlib.import_module("scripts.v1.browser_check")
    except (AssertionError, SystemExit) as error:
        failure = error
    assert failure is None
