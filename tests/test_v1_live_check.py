"""Offline CLI checks: synthetic adapter only, no provider or profile access."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def run_check(tmp_path, *, opt_in=None, state=None, verified=None, failure=None):
    # Install a synthetic adapter before executing the actual CLI. Deny all real
    # application/provider imports and network connections, even on the opt-in path.
    harness = """
import importlib.abc
import json
import runpy
import sys
import types

payload = json.loads(sys.argv[2])
class NoProvider(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith(("open_notebook", "notebooklm")):
            raise AssertionError("real provider import forbidden")
sys.meta_path.insert(0, NoProvider())
def no_network(event, args):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.bind"):
        raise AssertionError("network forbidden")
sys.addaudithook(no_network)
class Bridge:
    def __init__(self):
        if payload["failure"] == "constructor":
            raise RuntimeError("private-exception-canary")
    async def verify_connection(self):
        if payload["failure"] == "verification":
            raise RuntimeError("private-exception-canary")
        if payload["failure"] == "none":
            return None
        if payload["failure"] == "malformed":
            return object()
        status = {"state": payload["state"], "last_verified_at": payload["verified"]}
        return types.SimpleNamespace(**status, model_dump_json=lambda: json.dumps(status))
if payload["state"] is not None or payload["failure"] in ("constructor", "verification", "none", "malformed"):
    adapter = types.ModuleType("open_notebook.integrations.notebooklm.sdk_adapter")
    adapter.SDKNotebookLMBridge = Bridge
    sys.modules[adapter.__name__] = adapter
runpy.run_path(sys.argv[1], run_name="__main__")
"""
    env = {"PYTHON_DOTENV_DISABLED": "1", "HOME": str(tmp_path)}
    if opt_in is not None:
        env["STUDY_WORKBENCH_LIVE_READONLY"] = opt_in
    return subprocess.run(
        [
            sys.executable,
            "-c",
            harness,
            str(ROOT / "scripts/v1/live_check.py"),
            json.dumps({"state": state, "verified": verified, "failure": failure}),
        ],
        env=env,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=10,
    )


@pytest.mark.parametrize("opt_in", [None, "0", "true"])
def test_blocked_cli_is_nonzero_and_does_not_import_provider(tmp_path, opt_in):
    result = run_check(tmp_path, opt_in=opt_in)
    assert result.returncode == 2
    assert json.loads(result.stdout)["status"] == "blocked"
    assert result.stderr == ""


@pytest.mark.parametrize(
    "state,verified,code",
    [
        ("connected", "2026-10-22T00:00:00Z", 0),
        ("connected", None, 3),
        ("connected", "", 3),
        ("connected", "   ", 3),
        ("connected", True, 3),
        ("disconnected", None, 3),
        ("awaiting_user_login", None, 3),
        ("verifying", None, 3),
        ("needs_reauth", None, 3),
        ("unavailable", None, 3),
        ("unknown", None, 3),
    ],
)
def test_cli_succeeds_only_for_verified_connection(tmp_path, state, verified, code):
    result = run_check(tmp_path, opt_in="1", state=state, verified=verified)
    assert result.returncode == code
    assert json.loads(result.stdout)["state"] == state
    assert result.stderr == ""


@pytest.mark.parametrize(
    "failure", ["import", "constructor", "verification", "none", "malformed"]
)
def test_unexpected_failure_is_nonzero_and_redacted_json(tmp_path, failure):
    result = run_check(tmp_path, opt_in="1", failure=failure)
    assert result.returncode == 1
    assert json.loads(result.stdout) == {
        "status": "failed",
        "reason": "Live read-only verification could not complete.",
    }
    assert "private-exception-canary" not in result.stdout + result.stderr
    assert result.stderr == ""
