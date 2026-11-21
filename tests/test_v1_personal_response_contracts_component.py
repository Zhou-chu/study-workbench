"""Composition of real router schema and portable/public DTO contracts."""

from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from test_v1_evidence_ingest import MemoryStore

from api.routers import evidence, notebooklm


def test_three_routes_have_lossless_public_models():
    app = FastAPI()
    app.include_router(evidence.router, prefix="/api")
    app.include_router(notebooklm.router, prefix="/api")
    paths = app.openapi()["paths"]
    for path, method in [
        ("/api/personal/chats/{chat_session_id}/turns", "post"),
        ("/api/personal/jobs/{job_id}", "get"),
        ("/api/personal/jobs/{job_id}/cancel", "post"),
    ]:
        assert (
            paths[path][method]["responses"]["200"]["content"]["application/json"][
                "schema"
            ]
            != {}
        )
        route = next(
            r
            for r in app.routes
            if isinstance(r, APIRoute)
            and r.path == path
            and method.upper() in r.methods
        )
        assert route.response_model_exclude_unset


def test_actual_archive_remapping_retains_opaque_history(tmp_path):
    from pydantic import TypeAdapter

    from api.personal_contracts import PersonalJobResponse
    from api.portable_service import FILES, PortableService

    project: dict[str, Any] = {kind: [] for kind in FILES}
    project["notebook"] = {"id": "notebook:synthetic"}
    project["job"] = [
        {
            "job_id": "job_old",
            "notebook_id": "notebook:synthetic",
            "state": "future_old_state",
            "attempts": "opaque legacy value",
            "result": ["retained", {"reference_validity": "verified"}],
            "error": {"message": ["historical"]},
        }
    ]
    restored, _ = PortableService(store=MemoryStore(), data_root=tmp_path)._remap(
        project, "restored/synthetic"
    )
    job = restored["job"][0]
    assert job["job_id"] != "job_old"
    assert job["state"] == "cancelled_local"
    assert job["historical_state"] == "future_old_state"
    assert job["replay_allowed"] is False
    adapter: TypeAdapter[Any] = TypeAdapter(PersonalJobResponse)
    assert (
        adapter.dump_python(
            adapter.validate_python(job), mode="json", exclude_unset=True
        )
        == job
    )
    assert job["result"][1]["reference_validity"] == "unverified"
