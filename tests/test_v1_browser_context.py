"""Browser acceptance authorization is tested offline; never launch Playwright."""

import builtins
import hashlib
import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest


def gate():
    assert importlib.util.find_spec("scripts.v1.browser_context"), (
        "browser context gate missing"
    )
    return importlib.import_module("scripts.v1.browser_context")


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


@pytest.fixture
def synthetic_context(tmp_path, monkeypatch):
    lib = gate()
    root = tmp_path / "source"
    root.mkdir()
    run = tmp_path / "run"
    run.mkdir(mode=0o700)
    navigation = run / "navigation-cases.json"
    navigation.write_text("[]")
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    token = "synthetic-parent-token"
    body: dict[str, Any] = {
        "schema": 1,
        "parent_pid": 900,
        "parent_start_ticks": 100,
        "run_id": "a" * 32,
        "token_sha256": hashlib.sha256(token.encode()).hexdigest(),
        "source_root": str(root),
        "artifact_path": str(artifact),
        "manifest_sha256": "b" * 64,
        "ports": {"database": 18001, "api": 5056, "frontend": 13001},
        "processes": {
            name: {"pid": pid, "identity": [pid, pid, 101]}
            for name, pid in (("database", 901), ("api", 902), ("frontend", 903))
        },
        "notebook_id": "notebook:fixture",
        "navigation_cases": str(navigation),
        "out": str(run / "screenshots"),
    }
    path = run / "browser-run-context.json"

    def save():
        path.write_text(json.dumps(body))
        path.chmod(0o600)

    save()
    monkeypatch.setattr(lib, "ROOT", root)
    monkeypatch.setattr(lib.os, "getppid", lambda: 900)
    monkeypatch.setattr(
        lib, "process_identity", lambda pid: (pid, pid, 100 if pid == 900 else 101)
    )
    monkeypatch.setattr(lib, "process_state", lambda pid: "S")
    monkeypatch.setattr(lib, "listener_inodes", lambda port: {str(port)})
    monkeypatch.setattr(
        lib,
        "owned_socket_inodes",
        lambda proc: {
            str(body["ports"][name])
            for name in body["ports"]
            if body["processes"][name]["pid"] == proc.pid
        },
    )
    verify = Mock(return_value={"manifest_sha256": "b" * 64})
    monkeypatch.setattr(lib, "verify_artifact", verify)
    monkeypatch.setenv("STUDY_WORKBENCH_ACCEPTANCE_TOKEN", token)
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic-fixture-password")
    return lib, body, path, save, verify


def test_valid_parent_context_derives_local_target(synthetic_context):
    lib, body, path, save, verify = synthetic_context
    context = lib.load_context(path)
    assert context.base == "http://127.0.0.1:13001"
    assert context.notebook == "notebook:fixture"
    verify.assert_called_once_with(
        Path(body["source_root"]), Path(body["artifact_path"])
    )


@pytest.mark.parametrize("problem", ["parent", "token", "foreign", "stale", "dead"])
def test_invalid_context_never_reaches_browser(synthetic_context, monkeypatch, problem):
    lib, body, path, save, verify = synthetic_context
    if problem == "parent":
        monkeypatch.setattr(lib.os, "getppid", lambda: 999)
    elif problem == "token":
        monkeypatch.setenv("STUDY_WORKBENCH_ACCEPTANCE_TOKEN", "wrong")
    elif problem == "foreign":
        monkeypatch.setattr(lib, "owned_socket_inodes", lambda proc: {"foreign"})
    elif problem == "stale":
        verify.side_effect = ValueError("stale artifact")
    else:
        monkeypatch.setattr(lib, "process_state", lambda pid: "Z")
    browser = importlib.import_module("scripts.v1.browser_check")
    launch = Mock(side_effect=AssertionError("browser must not run"))
    monkeypatch.setattr(browser, "run_browser", launch)
    monkeypatch.setattr(sys, "argv", ["browser_check", "--run-context", str(path)])
    with pytest.raises((ValueError, RuntimeError)):
        browser.main()
    launch.assert_not_called()
    assert not (path.parent / "screenshots").exists()


@pytest.mark.parametrize(
    "problem", ["mode", "symlink", "output", "navigation", "source", "ports"]
)
def test_context_path_and_schema_boundaries(synthetic_context, tmp_path, problem):
    lib, body, path, save, verify = synthetic_context
    if problem == "mode":
        path.chmod(0o644)
    elif problem == "symlink":
        target = tmp_path / "context"
        path.rename(target)
        path.symlink_to(target)
    else:
        if problem == "output":
            body["out"] = str(tmp_path / "foreign-output")
        if problem == "navigation":
            body["navigation_cases"] = str(tmp_path / "private-file")
        if problem == "source":
            body["source_root"] = str(tmp_path / "foreign-source")
        if problem == "ports":
            body["ports"]["api"] = body["ports"]["frontend"]
        save()
    with pytest.raises((ValueError, RuntimeError)):
        lib.load_context(path)


def test_recheck_rejects_context_or_artifact_change(synthetic_context):
    lib, body, path, save, verify = synthetic_context
    context = lib.load_context(path)
    body["manifest_sha256"] = "c" * 64
    save()
    with pytest.raises(ValueError, match="changed"):
        context.recheck()


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


@pytest.mark.parametrize("problem", ["foreign-origin", "ownership-lost"])
def test_network_guard_aborts_without_continuing_a_write(
    synthetic_context, monkeypatch, problem
):
    lib, body, path, save, verify = synthetic_context
    guard = lib.load_context(path)
    browser = importlib.import_module("scripts.v1.browser_check")
    route = Mock()
    route.request.url = "http://127.0.0.1:13001/api/notebooks"
    if problem == "foreign-origin":
        route.request.url = "http://127.0.0.1:13000/api/notebooks"
    else:
        monkeypatch.setattr(lib, "owned_socket_inodes", lambda proc: {"foreign"})
    with pytest.raises(RuntimeError):
        browser.route_owned_request(guard, route)
    route.abort.assert_called_once()
    route.continue_.assert_not_called()


def test_fifo_context_rejected_before_open(synthetic_context, monkeypatch):
    lib, _body, path, _save, _verify = synthetic_context
    path.unlink()
    os.mkfifo(path, 0o600)
    open_file = Mock(side_effect=AssertionError("must not open FIFO"))
    with monkeypatch.context() as patch:
        patch.setattr(lib.os, "open", open_file)
        with pytest.raises(ValueError, match="regular file"):
            lib.read_context(path)
    open_file.assert_not_called()
