"""Direct native-transaction/configuration units with fake wire and time boundaries.

No real HTTP, runtime start, database, private directory or receipt lifecycle.
"""

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from spa_native_runtime_support import helper, transact


def test_environment_is_minimal_and_secrets_are_separated(monkeypatch, tmp_path):
    m = helper()
    monkeypatch.setenv("OPENAI_API_KEY", "ambient-secret")
    monkeypatch.setenv("HTTPS_PROXY", "https://foreign.invalid")
    envs = m.environments(tmp_path, (31001, 31002, 31003))
    db, api, worker, bff = (envs[x] for x in ("db", "api", "worker", "bff"))
    assert api == worker
    assert (
        len(
            {
                api["SURREAL_PASSWORD"],
                api["OPEN_NOTEBOOK_PASSWORD"],
                api["OPEN_NOTEBOOK_ENCRYPTION_KEY"],
            }
        )
        == 3
    )
    assert db["SURREAL_PASS"] == api["SURREAL_PASSWORD"]
    assert "OPEN_NOTEBOOK_PASSWORD" not in db
    assert bff["INTERNAL_API_URL"] == "http://127.0.0.1:31002"
    assert bff["STUDY_WORKBENCH_WEB_ORIGIN"] == "http://127.0.0.1:31003"
    assert bff["NODE_ENV"] != "production"
    assert bff["STUDY_WORKBENCH_BFF_LISTEN_HOST"] == "127.0.0.1"
    for env in envs.values():
        assert "OPENAI_API_KEY" not in env
        assert "HTTPS_PROXY" not in env
        assert env["HOME"] == str(tmp_path / "home")
    assert not any(
        "PASSWORD" in k or "ENCRYPTION" in k or k.startswith("SURREAL") for k in bff
    )
    for key in (
        "STUDY_WORKBENCH_RUNTIME_DIR",
        "STUDY_WORKBENCH_DATA_DIR",
        "OPEN_NOTEBOOK_DATA_DIR",
        "TIKTOKEN_CACHE_DIR",
        "NOTEBOOKLM_HOME",
    ):
        assert Path(api[key]).is_relative_to(tmp_path)
    assert api["PYTHON_DOTENV_DISABLED"] == "1"
    assert api["SURREAL_UNAUTHENTICATED"] == "false"


@pytest.mark.parametrize(
    "ports",
    [
        (18001, 31002, 31003),
        (31001, 5056, 31003),
        (31001, 31002, 13001),
        (8000, 31002, 31003),
        (31001, 31001, 31003),
    ],
)
def test_port_selection_rejects_live_defaults_and_duplicates(monkeypatch, ports):
    m = helper()
    monkeypatch.setattr(m.life, "select_unused_ports", lambda: ports)
    with pytest.raises(ValueError):
        m.select_ports()


def test_wrong_loaded_origin_or_dependency_version_blocks():
    m = helper()
    correct = {
        "origins": {
            "api.main": str(m.ROOT / "api/main.py"),
            "commands": str(m.ROOT / "commands/__init__.py"),
            "open_notebook": str(m.ROOT / "open_notebook/__init__.py"),
        },
        "versions": dict(m.DEPENDENCIES),
    }
    m.validate_modules(correct)
    correct["origins"]["commands"] = "/deployment/commands/__init__.py"
    with pytest.raises(ValueError):
        m.validate_modules(correct)
    correct["origins"]["commands"] = str(m.ROOT / "commands/__init__.py")
    correct["versions"]["surreal-commands"] = "unknown"
    with pytest.raises(ValueError):
        m.validate_modules(correct)


def test_transaction_requires_all_native_steps_and_portable_roundtrip():
    txn, service, client = transact()
    with client:
        result = txn.execute(b"public fixture")
    assert result["portable"]["original_sha256"] == helper().gate.sha(b"public fixture")
    assert result["portable"]["notebook_id"] == "notebook_imported"
    assert result["citation_validation"] == "not_run"
    assert result["upload"]["job_id"] == "job_upload"
    assert len(service.uploads) == 2
    # Multipart boundaries differ. The original key and file bytes must not.
    assert service.uploads[0].split(b'name="idempotency_key"')[1].split(b"\r\n--")[0]
    assert all(b"public fixture" in body for body in service.uploads)
    keys = [
        body.split(b'name="idempotency_key"\r\n\r\n')[1].split(b"\r\n")[0]
        for body in service.uploads
    ]
    assert keys[0] == keys[1]
    search = next(r for r in service.requests if r.url.path.endswith("/search"))
    assert json.loads(search.content) == {
        "query": "public quote",
        "source_version_ids": ["version_original"],
    }
    assert all(
        "origin" not in r.headers and "sec-fetch-site" not in r.headers
        for r in service.requests
    )
    assert txn.counts["attempted"] == txn.counts["completed"] == len(service.requests)
    assert txn.counts["mutations"] == 7
    assert sum(r.url.path.endswith("/imports/portable") for r in service.requests) == 1


@pytest.mark.parametrize(
    "mode",
    [
        "upload-unknown",
        "export-unknown",
        "replay-mismatch",
        "bad-original",
        "bad-selection",
        "bad-remap",
        "upload-timeout",
        "export-timeout",
    ],
)
def test_incomplete_or_uncertain_transaction_never_passes_or_replays(mode):
    txn, service, client = transact(mode)
    with client, pytest.raises((RuntimeError, TimeoutError)):
        txn.execute(b"public fixture")
    assert len(service.uploads) <= 2
    assert sum(r.url.path.endswith("/exports") for r in service.requests) <= 1
    assert sum(r.url.path.endswith("/imports/portable") for r in service.requests) <= 1
    if mode == "upload-unknown":
        assert len(service.uploads) == 1
    assert txn.counts["attempted"] <= 800
    last = {
        "upload-unknown": "upload",
        "export-unknown": "export",
        "replay-mismatch": "upload_same_key",
        "bad-original": "original",
        "bad-selection": "workspace",
        "bad-remap": "portable_import",
        "upload-timeout": "extract_poll",
        "export-timeout": "export_poll",
    }[mode]
    assert txn.events[-1]["step"] == last


def test_request_guard_prevents_any_http_and_counter_increment():
    def refuse():
        raise RuntimeError("foreign listener")

    txn, service, client = transact(guard=refuse)
    with client, pytest.raises(RuntimeError):
        txn.execute(b"public fixture")
    assert not service.requests
    assert txn.counts["attempted"] == 0


def test_request_limit_and_deadline_prevent_dispatch():
    txn, service, client = transact()
    txn.counts["attempted"] = 800
    with client, pytest.raises((RuntimeError, TimeoutError)):
        txn.execute(b"public fixture")
    assert not service.requests


def test_expected_commit_mismatch_blocks_before_source_gate(monkeypatch):
    m = helper()
    monkeypatch.setattr(m.gate, "git", lambda *args: "b" * 40)
    with pytest.raises(ValueError, match="commit"):
        m.verify_native_source("a" * 40)


def test_post_response_ownership_loss_does_not_publish_success():
    calls = 0

    def guard():
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("listener changed")

    txn, service, client = transact(guard=guard)
    with client, pytest.raises(RuntimeError):
        txn.execute(b"public fixture")
    assert len(service.requests) == 1
    assert txn.counts["attempted"] == 1
    assert txn.counts["completed"] == 0


def test_export_timeout_preserves_original_job_identity():
    txn, service, client = transact("export-timeout")
    with client, pytest.raises(TimeoutError):
        txn.execute(b"public fixture")
    assert txn.result["export"]["job_id"] == "job_export"
    assert txn.result["worker_completion"] == "extraction_succeeded"


@pytest.mark.parametrize(
    "status, expected", [("partial_pass", 0), ("failed", 1), ("cleanup_uncertain", 1)]
)
def test_cli_exit_tracks_actual_result(monkeypatch, status, expected, tmp_path):
    m = helper()
    monkeypatch.setattr(m, "run", lambda *args: {"status": status})
    assert (
        m.main(
            [
                "run",
                "--run-root",
                str(tmp_path / "root"),
                "--fixture",
                "fixture",
                "--gateway",
                "/explicit/gateway",
                "--source-commit",
                "a" * 40,
            ]
        )
        == expected
    )


def test_same_origin_config_completes_provider_free_transaction():
    txn, service, client = transact()
    assert service.config == {
        "apiUrl": "",
        "auth_mode": "legacy_password",
        "web_session_protocol": None,
        "client_contracts": ["workspace-view-v1"],
        "ui_transport_protocol": 1,
    }
    with client:
        result = txn.execute(b"public fixture")
    assert result["portable"]["status"] == "succeeded"
    assert txn.counts["mutations"] == 7


@pytest.mark.parametrize(
    "change",
    [
        {"apiUrl": "http://127.0.0.1:31003"},
        {"apiUrl": "https://foreign.invalid"},
        {"auth_mode": "device_sessions"},
        {"web_session_protocol": "bff-memory-v1"},
        {"client_contracts": []},
        {"ui_transport_protocol": True},
    ],
)
def test_invalid_same_origin_config_never_admits_mutations(change):
    txn, service, client = transact()
    service.config.update(change)
    with client, pytest.raises(RuntimeError):
        txn.execute(b"public fixture")
    assert txn.counts["mutations"] == 0
    assert len(service.requests) == 1


def test_preflight_failure_never_creates_root_or_spawns(tmp_path, monkeypatch):
    m = helper()

    def refuse(*a, **k):
        raise ValueError("untrusted input")

    monkeypatch.setattr(m, "preflight", refuse)
    monkeypatch.setattr(m.life, "start_owned", lambda *a, **k: pytest.fail("spawn"))
    with pytest.raises(ValueError):
        m.run(tmp_path / "no-root", "fixture", Path("/explicit/gateway"), "a" * 40)
    assert not (tmp_path / "no-root").exists()


def test_unknown_process_never_signalled(monkeypatch):
    m = helper()
    monkeypatch.setattr(os, "killpg", lambda *a: pytest.fail("unknown PID signalled"))
    with pytest.raises(TypeError):
        m.life.stop_processes([SimpleNamespace(pid=123456)])
