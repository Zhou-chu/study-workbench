"""Synthetic, offline public projection and authenticated read contracts."""

import copy
import json
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder

from api.workspace_view_projection import project_workspace_view

FIXTURE = Path(__file__).parents[1] / "contracts/v1/fixtures/workspace-view-v1.json"


def example():
    return json.loads(FIXTURE.read_text())


def test_workspace_view_allowlist_preserves_compatibility():
    case = example()
    raw = case["raw_workspace"]
    before = copy.deepcopy(raw)
    view = project_workspace_view(raw)
    wire = view.model_dump(exclude_unset=True)
    assert view.schema_version == "workspace-view-v1"
    assert "file_path" not in view.model_dump_json()
    from api.workspace_view_contracts import SelectionView

    assert isinstance(view.selection, SelectionView)
    assert view.selection.engine == "future-engine"
    assert (
        wire["sources"][0]["versions"][0]["provenance"]
        == raw["sources"][0]["versions"][0]["provenance"]
    )
    assert wire == case["workspace_view"]
    assert raw == before
    assert "source_version_id" not in wire["sources"][1]["versions"][0]
    assert "content" not in wire["notes"][1]
    assert wire["notes"][0]["content"] is None


@pytest.mark.parametrize(
    "value,status",
    [
        (None, "invalid"),
        ({}, "invalid"),
        (
            {
                "dispatch_ack": "unknown",
                "job_id": "parent",
                "turn_id": "turn",
                "retry_safe": False,
                "future": True,
            },
            "unknown",
        ),
        (
            {
                "dispatch_ack": "unknown",
                "job_id": "other",
                "turn_id": "turn",
                "retry_safe": False,
            },
            "invalid",
        ),
    ],
)
def test_bad_dispatch_receipts_stay_non_actionable(value, status):
    raw = example()["raw_workspace"]
    raw["jobs"][0]["dispatch_receipt"] = value
    wire = project_workspace_view(raw).model_dump(exclude_unset=True)
    job = wire["jobs"][0]
    assert job["projection_status"] in ("unknown", "invalid")
    if value is None:
        assert job["dispatch_receipt"] is None
    else:
        assert job["dispatch_receipt"] == {"validity": status}


def test_unknown_request_and_nested_proof_fields_do_not_become_known():
    for field in ("request_snapshot", "result"):
        raw = example()["raw_workspace"]
        raw["jobs"][0][field]["future"] = {"private": "synthetic-secret"}
        job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
        assert job["projection_status"] == "unknown"
        assert job[field]["projection_status"] == "unknown"
        assert "synthetic-secret" not in json.dumps(job)
    raw = example()["raw_workspace"]
    raw["jobs"].extend([None, {"job_id": "parent", "idempotency_key": "other"}])
    raw["turns"].append({"not_an_identity": True})
    raw["jobs"][0]["request_snapshot"]["source_version_ids"] = ["sv_b", "sv_a"]
    view = project_workspace_view(raw).model_dump(exclude_unset=True)
    assert len(view["jobs"]) == 3
    assert view["jobs"][1] == {"projection_status": "invalid"}
    assert view["jobs"][2]["job_id"] == "parent"
    assert view["jobs"][0]["request_snapshot"]["source_version_ids"] == ["sv_b", "sv_a"]
    assert view["turns"][-1]["projection_status"] == "unknown"


def test_proof_disagreements_null_absence_and_history_survive():
    raw = example()["raw_workspace"]
    raw["jobs"][0].pop("dispatch_receipt")
    raw["jobs"].append(
        {
            "operation": "ask",
            "job_id": "child",
            "turn_id": "turn",
            "idempotency_key": "synthetic-key",
            "state": "future-state",
            "restored_history": True,
            "replay_allowed": False,
        }
    )
    raw["jobs"][0]["result"]["retrieval"] = None
    raw["turns"][0]["generation_status"] = "failed"
    raw["turns"][0]["citations"][0]["independent_support"] = None
    view = project_workspace_view(raw).model_dump(exclude_unset=True)
    assert "dispatch_receipt" not in view["jobs"][0]
    assert "retrieval" not in view["turns"][0]
    assert view["jobs"][0]["result"]["retrieval"] is None
    assert view["turns"][0]["generation_status"] == "failed"
    assert view["turns"][0]["citations"][0]["independent_support"] is None
    assert view["jobs"][1]["restored_history"] is True
    assert view["jobs"][1]["replay_allowed"] is False
    assert view["jobs"][1]["state"] == "future-state"


@pytest.mark.asyncio
async def test_routes_keep_old_wire_and_use_same_service_scope_check(monkeypatch):
    from api.routers import evidence
    from open_notebook.exceptions import NotFoundError

    calls = []
    raw = example()["raw_workspace"]

    class Service:
        async def workspace(self, notebook_id):
            calls.append(notebook_id)
            if notebook_id != "notebook:synthetic":
                raise NotFoundError("synthetic missing notebook")
            return copy.deepcopy(raw)

    monkeypatch.setattr(evidence, "PersonalService", Service)
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        old = await client.get("/api/personal/notebooks/notebook:synthetic/workspace")
        new = await client.get(
            "/api/personal/notebooks/notebook:synthetic/workspace-view"
        )
    assert old.json() == jsonable_encoder(raw)
    assert new.json() == example()["workspace_view"]
    with pytest.raises(NotFoundError):
        await evidence.workspace_view("notebook:other")
    assert calls == ["notebook:synthetic", "notebook:synthetic", "notebook:other"]


@pytest.mark.asyncio
async def test_client_capabilities_are_authenticated_read_only_real_limits(monkeypatch):
    from api.auth import PasswordAuthMiddleware
    from api.portable_limits import get_portable_limits
    from api.routers import evidence
    from api.source_upload_limits import get_source_upload_max_bytes

    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "synthetic-password")
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_FILE_MB", "1.5")
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    app.add_middleware(PasswordAuthMiddleware)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        denied = await client.get("/api/personal/client-capabilities")
        allowed = await client.get(
            "/api/personal/client-capabilities",
            headers={"Authorization": "Bearer synthetic-password"},
        )
    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json() == {
        "contract_version": "client-capabilities-v1",
        "supported_contracts": ["workspace-view-v1"],
        "limits": {
            "source_upload_max_bytes": get_source_upload_max_bytes(),
            "portable": get_portable_limits().public(),
        },
    }
    assert get_source_upload_max_bytes() == 1572864
    monkeypatch.delenv("STUDY_WORKBENCH_MAX_FILE_MB")
    assert get_source_upload_max_bytes() == 50 * 1024 * 1024


def test_input_marker_cannot_erase_unknown_fields():
    raw = example()["raw_workspace"]
    raw["jobs"][0]["request_snapshot"].update(future=True, projection_status=None)
    job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
    assert job["request_snapshot"]["projection_status"] == "unknown"
    assert job["projection_status"] == "unknown"


@pytest.mark.parametrize(
    "case", example()["recovery_jobs"], ids=lambda case: case["name"]
)
def test_recovery_golden_python_wire_for_ts(case):
    raw = example()["raw_workspace"]
    raw["jobs"] = [case["raw_job"]]
    job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
    assert job == case["job_view"]
    if case.get("non_actionable"):
        assert job["projection_status"] in ("unknown", "invalid")
    assert "SYNTHETIC_PRIVATE_EXTENSION" not in json.dumps(job)
    assert "SYNTHETIC_PROVIDER_ERROR" not in json.dumps(job)
    assert "file_path" not in json.dumps(job)


@pytest.mark.asyncio
async def test_upload_and_capabilities_share_actual_budget(monkeypatch):
    from io import BytesIO

    from fastapi import UploadFile

    from api.routers import evidence
    from open_notebook.exceptions import InvalidInputError

    async def get(_):
        return object()

    monkeypatch.setattr(evidence.Notebook, "get", get)
    monkeypatch.setattr(evidence, "EvidenceService", object)
    monkeypatch.setattr(evidence, "get_source_upload_max_bytes", lambda: 2)
    with pytest.raises(InvalidInputError, match="FILE_TOO_LARGE"):
        await evidence.upload(
            "notebook:synthetic",
            UploadFile(BytesIO(b"123"), filename="synthetic.txt"),
            idempotency_key="synthetic",
        )
    assert (await evidence.client_capabilities())["limits"][
        "source_upload_max_bytes"
    ] == 2


@pytest.mark.parametrize("key,value", [("retry_safe", 0), ("retry_safe", "false")])
def test_dispatch_false_is_not_coerced_from_other_json_types(key, value):
    raw = example()["raw_workspace"]
    raw["jobs"][0]["dispatch_receipt"][key] = value
    job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
    assert job["dispatch_receipt"] == {"validity": "invalid"}


def test_reserved_projection_marker_null_is_not_a_known_raw_request():
    raw = example()["raw_workspace"]
    raw["jobs"][0]["request_snapshot"]["projection_status"] = None
    job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
    assert job["request_snapshot"]["projection_status"] == "unknown"


def test_current_grounded_turn_metadata_is_shape_known_without_internal_hash_or_usage():
    raw = example()["raw_workspace"]
    turn = raw["jobs"][0]["result"]
    turn.update(
        scope_hash="synthetic-scope",
        request_hash="synthetic-internal-hash",
        model_id="model:synthetic",
        pipeline_version="1",
        grounding_status="references_verified",
        usage={"private": "SYNTHETIC_PROVIDER_USAGE"},
        budget={
            "context_tokens": 8192,
            "output_tokens": 2048,
            "estimated_input_tokens": 1000,
            "estimator": "utf8_byte_upper_bound",
            "retrieved_evidence_count": 2,
            "included_evidence_count": 2,
        },
    )
    turn["scope_snapshot"]["mapping_version"] = 1
    job = project_workspace_view(raw).model_dump(exclude_unset=True)["jobs"][0]
    assert "projection_status" not in job
    assert job["result"]["scope_snapshot"]["mapping_version"] == 1
    assert job["result"]["grounding_status"] == "references_verified"
    assert job["result"]["budget"]["included_evidence_count"] == 2
    assert "request_hash" not in job["result"]
    assert "SYNTHETIC_PROVIDER_USAGE" not in json.dumps(job)


@pytest.mark.parametrize(
    "value",
    [
        {"validity": "valid"},
        {
            "validity": "unknown",
            "receipt": {
                "dispatch_ack": "unknown",
                "job_id": "parent",
                "turn_id": "turn",
                "retry_safe": False,
            },
        },
    ],
)
def test_receipt_view_union_has_exact_branches(value):
    from pydantic import TypeAdapter, ValidationError

    from api.workspace_view_contracts import DispatchReceiptView

    with pytest.raises(ValidationError):
        TypeAdapter(DispatchReceiptView).validate_python(value)
