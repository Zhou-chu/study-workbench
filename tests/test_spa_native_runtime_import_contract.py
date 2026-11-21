"""The native launcher module must be import-inert."""

import importlib
import os

import pytest
from spa_native_runtime_support import helper


def test_import_is_inert(monkeypatch):
    m = helper()

    def forbidden(*args, **kwargs):
        pytest.fail("Import must not start, connect, inspect environment or signal")

    monkeypatch.setattr(m.subprocess, "run", forbidden)
    monkeypatch.setattr(m.socket, "socket", forbidden)
    monkeypatch.setattr(os, "getenv", forbidden)
    monkeypatch.setattr(os, "killpg", forbidden)
    importlib.reload(m)
