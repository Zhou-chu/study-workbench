"""Non-collected synthetic transport helpers; no test-module imports."""

import importlib
import json

import httpx
import pytest


def helper():
    try:
        return importlib.import_module("scripts.v1.spa_native_runtime")
    except ModuleNotFoundError:
        pytest.fail("Foreground native runner is not implemented")


class FixtureService:
    """Stateful fake wire boundary; runner code owns the real transaction."""

    def __init__(self, mode="ok"):
        self.mode = mode
        # Exact publicRuntimeConfig producer contract for legacy-password mode.
        self.config = {
            "apiUrl": "",
            "auth_mode": "legacy_password",
            "web_session_protocol": None,
            "client_contracts": ["workspace-view-v1"],
            "ui_transport_protocol": 1,
        }
        self.requests = []
        self.uploads = []
        self.note = None
        self.selection = None
        self.exported = False
        self.imported = False

    def workspace(self, imported=False):
        version = "version_imported" if imported else "version_original"
        return {
            "notebook": {
                "id": "notebook_imported" if imported else "notebook_original"
            },
            "selection": {**(self.selection or {}), "source_version_ids": [version]},
            "sources": [
                {
                    "source_id": "source_original",
                    "versions": [{"source_version_id": version}],
                }
            ],
            "notes": [self.note] if self.note else [],
            "jobs": [
                {
                    "job_id": "job_upload",
                    "state": "running"
                    if self.mode == "upload-timeout"
                    else "succeeded",
                },
                *(
                    [
                        {
                            "job_id": "job_export",
                            "state": "running"
                            if self.mode == "export-timeout"
                            else "succeeded",
                            "result": {"export_id": "export_original"},
                        }
                    ]
                    if self.exported
                    else []
                ),
            ],
        }

    def __call__(self, request):
        self.requests.append(request)
        p = request.url.path
        if p == "/config":
            return httpx.Response(
                200,
                json=self.config,
            )
        if p == "/api/auth/status":
            return httpx.Response(200, json={"auth_enabled": True})
        if "synthetic-denied" in p:
            assert "authorization" not in request.headers
            return httpx.Response(401)
        if p == "/api/notebooks":
            return httpx.Response(200, json={"id": "notebook_original"})
        if p.endswith("/sources/upload"):
            self.uploads.append(request.content)
            if self.mode == "upload-unknown":
                raise httpx.ReadTimeout("secret response URL", request=request)
            return httpx.Response(
                200,
                json={
                    "source_id": "source_original",
                    "source_version_id": "version_original",
                    "job_id": "job_changed"
                    if self.mode == "replay-mismatch" and len(self.uploads) == 2
                    else "job_upload",
                },
            )
        if p.endswith("/workspace") or p.endswith("/workspace-view"):
            body = self.workspace("notebook_imported" in p)
            if self.mode == "bad-selection":
                body["selection"]["source_version_ids"] = []
            return httpx.Response(200, json=body)
        if p.endswith("/selection"):
            self.selection = json.loads(request.content)
            return httpx.Response(200, json=self.selection)
        if p == "/api/personal/search":
            return httpx.Response(200, json={"hits": [{"quote": "public quote"}]})
        if p.endswith("/notes"):
            self.note = {"id": "note_original", **json.loads(request.content)}
            return httpx.Response(200, json=self.note)
        if p.endswith("/exports"):
            self.exported = True
            if self.mode == "export-unknown":
                raise httpx.ReadTimeout("do not leak bearer", request=request)
            return httpx.Response(202, json={"job_id": "job_export"})
        if p == "/api/personal/imports/portable":
            self.imported = True
            return httpx.Response(
                201,
                json={
                    "notebook_id": "notebook_original"
                    if self.mode == "bad-remap"
                    else "notebook_imported"
                },
            )
        if p == "/api/personal/exports/export_original/download":
            return httpx.Response(200, content=b"synthetic zip")
        if p.endswith("/download"):
            return httpx.Response(
                200,
                content=b"corrupt"
                if self.mode == "bad-original"
                else b"public fixture",
            )
        if "/source-versions/" in p:
            return httpx.Response(
                200,
                json={
                    "extraction": {"status": "ready"},
                    "evidence": [{"quote": "public quote"}],
                },
            )
        pytest.fail(f"Unexpected wire request: {p}")


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def transact(mode="ok", guard=lambda: None):
    m = helper()
    service = FixtureService(mode)
    clock = Clock()
    client = httpx.Client(
        base_url="http://127.0.0.1:31003",
        trust_env=False,
        transport=httpx.MockTransport(service),
    )
    txn = m.Transaction(
        client, guard, "memory-only-bearer", clock=clock, sleep=clock.sleep
    )
    return txn, service, client
