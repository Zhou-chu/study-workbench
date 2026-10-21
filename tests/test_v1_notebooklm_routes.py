import importlib
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from v1_notebooklm_helpers import MemoryStore

from api.notebooklm_service import NotebookLMService
from open_notebook.integrations.notebooklm.sdk_adapter import SDKNotebookLMBridge


@pytest.fixture
def client(tmp_path, monkeypatch):
    try:
        routes = importlib.import_module("api.routers.notebooklm")
    except ModuleNotFoundError:
        return None
    store = MemoryStore()
    service = NotebookLMService(
        store=store, bridge=SDKNotebookLMBridge(tmp_path / "storage.json"), enqueue=None
    )
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    app.dependency_overrides[routes.get_notebooklm_service] = lambda: service
    monkeypatch.setattr(routes.Notebook, "get", AsyncMock(return_value=object()))
    return TestClient(app), service


def test_connect_is_unavailable_honestly_and_reuses_flow(client):
    assert client is not None, "NotebookLM API routes not implemented"
    http, _ = client
    first = http.post("/api/personal/connections/notebooklm/connect").json()
    second = http.post("/api/personal/connections/notebooklm/connect").json()
    assert first["state"] == "unavailable"
    assert first["flow_id"] == second["flow_id"]
    assert (
        http.get(
            "/api/personal/connections/notebooklm/connect/" + first["flow_id"]
        ).json()["state"]
        == "unavailable"
    )


def test_status_and_capabilities_are_not_fake_connected(client):
    assert client is not None, "NotebookLM API routes not implemented"
    http, _ = client
    assert (
        http.get("/api/personal/connections/notebooklm").json()["state"]
        == "disconnected"
    )
    caps = http.get("/api/personal/notebooklm/capabilities").json()
    assert caps["sdk_version"] == "0.8.5"
    assert (
        next(c for c in caps["operations"] if c["name"] == "ask")["support"]
        == "unsupported"
    )


def test_audio_api_requires_nonempty_scope_and_idempotency(client):
    assert client is not None, "NotebookLM API routes not implemented"
    http, _ = client
    url = "/api/personal/notebooks/notebook:local/artifacts/audio"
    assert (
        http.post(
            url,
            json={
                "remote_notebook_id": "nb",
                "remote_source_ids": [],
                "idempotency_key": "x",
            },
        ).status_code
        == 422
    )
    assert (
        http.post(
            url, json={"remote_notebook_id": "nb", "remote_source_ids": ["a"]}
        ).status_code
        == 422
    )
    response = http.post(
        url,
        json={
            "remote_notebook_id": "nb",
            "remote_source_ids": ["a"],
            "idempotency_key": "x",
        },
    )
    assert response.status_code == 200
    assert response.json()["state"] == "queued"


def test_download_api_does_not_accept_urls_or_paths(client):
    assert client is not None, "NotebookLM API routes not implemented"
    http, _ = client
    result = http.post(
        "/api/personal/notebooklm/artifacts/audio/download",
        json={
            "notebook_id": "notebook:local",
            "remote_notebook_id": "nb",
            "idempotency_key": "x",
            "url": "http://127.0.0.1/private",
            "output_path": "../../secret",
        },
    )
    assert result.status_code == 422


@pytest.mark.asyncio
async def test_generic_job_lookup_can_read_other_personal_jobs(client):
    assert client is not None, "NotebookLM API routes not implemented"
    http, service = client
    await service.store.put(
        "job",
        "job_other",
        {
            "job_id": "job_other",
            "notebook_id": "notebook:local",
            "state": "queued",
            "operation": "upload",
        },
    )
    assert http.get("/api/personal/jobs/job_other").json()["operation"] == "upload"


@pytest.mark.asyncio
async def test_restored_audio_download_uses_verified_relative_path(client, tmp_path):
    import hashlib

    assert client is not None
    http, service = client
    service.data_root = tmp_path
    path = tmp_path / "restored" / "import-id" / "artifacts" / "clip.mp3"
    path.parent.mkdir(parents=True)
    data = b"ID3audio"
    path.write_bytes(data)
    await service.store.put(
        "artifact",
        "artifact_local",
        {
            "artifact_id": "artifact_local",
            "notebook_id": "notebook:local",
            "file_path": "restored/import-id/artifacts/clip.mp3",
            "sha256": hashlib.sha256(data).hexdigest(),
            "byte_size": len(data),
            "mime_type": "audio/mpeg",
        },
    )
    response = http.get("/api/personal/artifacts/artifact_local/download")
    assert response.status_code == 200
    assert response.content == data
    assert response.headers["cache-control"] == "private, no-store"


def test_status_poll_recovers_existing_local_maintenance_job(
    client, tmp_path, monkeypatch
):
    import asyncio

    from api.evidence_maintenance import EvidenceMaintenanceService
    from api.evidence_service import EvidenceService

    http, google = client
    evidence = EvidenceService(store=google.store, data_root=tmp_path)
    queued = []

    async def enqueue(command, args):
        queued.append((command, args))
        return "command:recovered"

    maintenance = EvidenceMaintenanceService(evidence=evidence, submit=enqueue)

    async def prepare():
        version = await evidence.ingest(
            "nb", "src", "Text", b"original", filename="a.txt"
        )
        job = await maintenance.submit(version["source_version_id"], "reparse", "once")
        job.update(state="running", next_dispatch_at="2000-01-01T00:00:00+00:00")
        await google.store.put("job", job["job_id"], job)
        return job

    job = asyncio.run(prepare())
    monkeypatch.setattr(
        "api.evidence_maintenance.EvidenceMaintenanceService", lambda: maintenance
    )
    response = http.get("/api/personal/jobs/" + job["job_id"])
    assert response.status_code == 200
    assert len(queued) == 2 and queued[0] == queued[1]
    assert response.json()["worker_job_id"] == "command:recovered"
