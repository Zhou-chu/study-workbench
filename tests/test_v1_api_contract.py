"""Offline contract snapshot and public synthetic runtime examples (not new models)."""

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from test_v1_evidence_ingest import MemoryStore

ROOT = Path(__file__).resolve().parents[1]
EXPORTER = ROOT / "scripts/v1/export_contract.py"
CONTRACT = ROOT / "contracts/v1/openapi.json"
FIXTURES = ROOT / "contracts/v1/fixtures"


def export(*args, cwd=None, env=None):
    return subprocess.run(
        [sys.executable, "-B", str(EXPORTER), *args],
        cwd=cwd or ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
    )


def fixture(name):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def test_snapshot_matches_actual_app_from_arbitrary_cwd(tmp_path):
    before = CONTRACT.stat()
    result = export("--check", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert CONTRACT.stat().st_mtime_ns == before.st_mtime_ns
    assert list(tmp_path.iterdir()) == []


def test_export_is_deterministic_and_ignores_ambient_configuration(tmp_path):
    output = tmp_path / "schema.json"
    env = {
        **os.environ,
        "OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB": "invalid",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE": "/must/not/read",
        "OPEN_NOTEBOOK_DATA_DIR": str(tmp_path / "must-not-create"),
        "PYTHON_DOTENV_DISABLED": "0",
    }
    (tmp_path / ".env").write_text("OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB=invalid\n")
    result = export("--output", str(output), cwd=tmp_path, env=env)
    assert result.returncode == 0, result.stderr
    assert output.read_bytes() == CONTRACT.read_bytes()
    assert not (tmp_path / "must-not-create").exists()
    assert sorted(p.name for p in tmp_path.iterdir()) == [".env", "schema.json"]


def test_export_disables_dotenv_on_actual_app_discovery_path(tmp_path):
    import shutil

    # Copy only the exporter into an isolated minimal repository. No developer
    # .env is opened or changed; api.main's normal dotenv discovery reaches this
    # synthetic repository-root .env when loading is enabled.
    root = tmp_path / "synthetic_repo"
    script = root / "scripts" / "v1" / "export_contract.py"
    script.parent.mkdir(parents=True)
    shutil.copyfile(EXPORTER, script)
    api = root / "api"
    api.mkdir()
    (api / "__init__.py").write_text("")
    (root / ".env").write_text("CONTRACT_SYNTHETIC_DOTENV_POISON=loaded\n")
    (api / "main.py").write_text(
        "import os\n"
        "from dotenv import load_dotenv\n"
        "from fastapi import FastAPI\n"
        "load_dotenv()\n"
        "assert not os.getenv('CONTRACT_SYNTHETIC_DOTENV_POISON'), 'synthetic dotenv loaded'\n"
        "app = FastAPI(title='Synthetic dotenv isolation test')\n"
    )
    # Positive control: prove the poison really is discoverable from api.main,
    # rather than merely planting a file outside dotenv's search path.
    control = subprocess.run(
        [sys.executable, "-B", "-c", "import api.main"],
        cwd=root,
        env={"PYTHON_DOTENV_DISABLED": "0"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert control.returncode != 0
    assert "synthetic dotenv loaded" in control.stderr
    result = subprocess.run(
        [sys.executable, "-B", str(script)],
        cwd=tmp_path,
        env={"PYTHON_DOTENV_DISABLED": "0"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stderr
    schema = json.loads((root / "contracts/v1/openapi.json").read_text())
    assert schema["info"]["title"] == "Synthetic dotenv isolation test"


def test_check_drift_and_missing_snapshot_never_write(tmp_path):
    output = tmp_path / "schema.json"
    output.write_text("{}\n")
    before = output.stat()
    result = export("--check", "--output", str(output), cwd=tmp_path)
    assert result.returncode == 1
    assert "drift" in result.stderr.lower()
    assert output.read_text() == "{}\n"
    assert output.stat().st_mtime_ns == before.st_mtime_ns
    missing = tmp_path / "absent" / "schema.json"
    result = export("--check", "--output", str(missing), cwd=tmp_path)
    assert result.returncode == 1
    assert not missing.parent.exists()


def test_schema_records_real_paths_requests_and_known_response_gaps():
    schema = json.loads(CONTRACT.read_text())
    paths = schema["paths"]
    assert len(paths) > 100  # Whole app, not a personal-router substitute.
    assert "/api/notebooks" in paths
    turn = schema["components"]["schemas"]["TurnRequest"]
    assert turn["properties"]["engine"]["enum"] == ["notebooklm", "independent"]
    assert {v["type"] for v in turn["properties"]["model_id"]["anyOf"]} == {
        "string",
        "null",
    }
    ids = [
        op["operationId"]
        for item in paths.values()
        for op in item.values()
        if isinstance(op, dict) and "operationId" in op
    ]
    assert len(ids) == len(set(ids))
    workspace = paths["/api/personal/notebooks/{notebook_id}/workspace"]["get"]
    assert workspace["responses"]["200"]["content"]["application/json"]["schema"] == {}
    portable = paths["/api/personal/imports/portable"]["post"]
    assert "201" in portable["responses"]
    assert portable["requestBody"]["content"]["multipart/form-data"]["schema"][
        "required"
    ] == ["file"]
    for path in (
        "/api/personal/exports/{export_id}/download",
        "/api/personal/source-versions/{source_version_id}/download",
    ):
        assert "get" in paths[path]


@pytest.mark.asyncio
async def test_workspace_fixture_matches_existing_service(monkeypatch):
    from api.personal_service import PersonalService
    from open_notebook.domain.notebook import Notebook

    expected = fixture("workspace")

    async def empty():
        return []

    async def get(_):
        return SimpleNamespace(
            **expected["notebook"], get_sources=empty, get_notes=lambda **kw: empty()
        )

    monkeypatch.setattr(Notebook, "get", get)
    actual = await PersonalService(store=MemoryStore()).workspace(
        expected["notebook"]["id"]
    )
    assert actual == expected


@pytest.mark.asyncio
async def test_job_fixture_is_real_submission_with_stable_ids(monkeypatch):
    from api.personal_service import PersonalService
    from api.routers.evidence import TurnRequest

    example = fixture("job")
    request = TurnRequest.model_validate(example["request"]).model_dump()
    monkeypatch.setattr("api.personal_service.now", lambda: "2026-01-01T00:00:00+00:00")

    async def submit(command, args):
        assert command == "personal_turn"
        return "command:synthetic"

    service = PersonalService(store=MemoryStore(), submit=submit)
    actual = await service.submit_turn("chat:synthetic", request)
    assert actual == example["response"]
    assert await service.submit_turn("chat:synthetic", request) == actual


@pytest.mark.asyncio
async def test_error_fixtures_match_actual_handlers():
    from api.main import invalid_input_error_handler, personal_bridge_error_handler
    from open_notebook.exceptions import InvalidInputError
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    request = Request({"type": "http", "headers": []})
    for example in fixture("errors"):
        if example["exception"] == "BridgeError":
            response = await personal_bridge_error_handler(
                request, BridgeError(example["code"], example["message"])
            )
        else:
            response = await invalid_input_error_handler(
                request, InvalidInputError(example["message"])
            )
        assert response.status_code == example["status"]
        assert json.loads(response.body) == example["body"]


def test_note_conflict_fixture_does_not_claim_unimplemented_guarantee():
    example = fixture("note-conflict")
    assert example["implemented"] is False
    assert example["http_response"] is None
    operation = json.loads(CONTRACT.read_text())["paths"][
        "/api/personal/notebooks/{notebook_id}/notes/{note_id}"
    ]["patch"]
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema["additionalProperties"] is True
    assert "expected_revision" not in request_schema.get("properties", {})
    assert "409" not in operation["responses"]


def test_snapshot_is_unmodified_actual_app_schema():
    from api.main import app

    assert json.loads(CONTRACT.read_text()) == app.openapi()


@pytest.mark.asyncio
async def test_turn_fixture_unmapped_citation_uses_runtime_mapper():
    from api.notebooklm_service import NotebookLMService
    from open_notebook.integrations.notebooklm.contracts import RemoteReference

    example = fixture("turn")
    # A bridge is deliberately not constructed: mapping is purely local.
    service = object.__new__(NotebookLMService)
    service.store = MemoryStore()
    actual = await service.map_reference(
        {
            "remote_source_ids": ["remote-synthetic"],
            "source_version_ids": [],
            "scope_snapshot": {"mappings": []},
        },
        RemoteReference.model_validate(example["unmapped_reference"]),
        1,
    )
    assert actual == example["unmapped_citation"]


@pytest.mark.asyncio
async def test_turn_cancelled_event_is_local_stop_waiting(monkeypatch):
    from api.routers import evidence

    expected = fixture("turn")["cancelled_event"]
    store = MemoryStore()
    await store.put("job", "synthetic", {**expected, "job_id": "synthetic"})
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    response = await evidence.turn_events(expected["turn_id"])
    chunks = [chunk async for chunk in response.body_iterator]
    assert len(chunks) == 1
    assert chunks[0].startswith("event: stage\ndata: ")
    assert json.loads(chunks[0].split("data: ", 1)[1]) == expected
    assert response.media_type == "text/event-stream"


def test_export_child_guards_network_and_disk(tmp_path):
    code = """
import runpy, socket, pathlib
module = runpy.run_path(EXPORTER)
module['_schema']()
for action in (lambda: socket.create_connection(('127.0.0.1', 1)), lambda: pathlib.Path(TARGET).write_text('unexpected')):
    try:
        action()
    except RuntimeError:
        pass
    else:
        raise AssertionError('export guard allowed side effect')
""".replace("EXPORTER", repr(str(EXPORTER))).replace(
        "TARGET", repr(str(tmp_path / "forbidden"))
    )
    result = subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=tmp_path,
        env={"PYTHON_DOTENV_DISABLED": "1"},
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stderr
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_archived_citation_is_not_fresh_verification(tmp_path):
    from api.evidence_service import EvidenceService
    from open_notebook.domain.evidence import (
        EvidenceCitation,
        EvidenceRecord,
        Extraction,
    )

    example = fixture("turn")["archived_citation"]
    EvidenceRecord.model_validate(example["evidence"])
    Extraction.model_validate(example["extraction"])
    EvidenceCitation.model_validate(example["response"])
    store = MemoryStore()
    await store.put("evidence", "ev_synthetic", example["evidence"])
    await store.put("extraction", "ex_synthetic", example["extraction"])
    actual = await EvidenceService(store=store, data_root=tmp_path).validate_citation(
        {"evidence_id": "ev_synthetic"}, ["sv_synthetic"]
    )
    assert actual == example["response"]


def test_public_examples_are_explicit_synthetic_data_with_utc_timestamp():
    from datetime import datetime, timedelta

    from open_notebook.domain.evidence import EvidenceCitation

    job = fixture("job")["response"]
    assert job["notebook_id"] == "notebook:synthetic"
    assert datetime.fromisoformat(job["created_at"]).utcoffset() == timedelta(0)
    citation = EvidenceCitation.model_validate(fixture("turn")["unmapped_citation"])
    assert citation.source_version_id is None
    assert citation.reference_validity == "unverified"
    for path in FIXTURES.glob("*.json"):
        text = path.read_text()
        assert not any(
            value in text
            for value in (
                "/home/",
                "Bearer ",
                "sk-proj-",
                "storage_state",
                "access_token",
                "refresh_token",
                "@gmail.com",
            )
        )
