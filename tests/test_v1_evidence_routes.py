"""Evidence HTTP contracts with real local files, parsers and service logic.

Only native database persistence and worker submission are replaced with in-memory
boundaries. Browser checks and external model calls are intentionally not involved.
"""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from starlette.responses import Response
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from api.personal_service import PersonalService
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest_asyncio.fixture
async def routes(tmp_path, monkeypatch):
    import api.routers.evidence as module
    from api.main import invalid_input_error_handler, not_found_error_handler

    store = MemoryStore()
    evidence = EvidenceService(store=store, data_root=tmp_path)
    memberships = {"notebook:a": ["source:a"], "notebook:b": ["source:b"]}
    queue = []

    class NativeSource:
        def __init__(self, title):
            self.title = title
            self.id = None

        async def save(self):
            if self.id is None:
                self.id = f"source:created_{len(native)}"
            native[self.id] = self

        @classmethod
        async def get(cls, identity):
            if identity not in native:
                raise NotFoundError("Source not found")
            return native[identity]

    native: dict[str, NativeSource] = {}
    for identity in ("source:a", "source:b"):
        source = NativeSource(identity)
        source.id = identity
        native[identity] = source

    class NativeNotebook:
        @classmethod
        async def get(cls, identity):
            if identity not in memberships:
                raise NotFoundError("Notebook not found")

            async def get_sources():
                return [native[key] for key in memberships[identity]]

            return SimpleNamespace(id=identity, get_sources=get_sources)

    async def relate(source_id, relation, notebook_id):
        assert relation == "reference"
        memberships[notebook_id].append(source_id)

    async def delete(source_id):
        native.pop(source_id, None)
        for sources in memberships.values():
            if source_id in sources:
                sources.remove(source_id)

    async def submit(command, args):
        queue.append((command, args.copy()))
        return f"command:test_{len(queue)}"

    monkeypatch.setattr(module, "Notebook", NativeNotebook)
    monkeypatch.setattr(module, "Source", NativeSource)
    monkeypatch.setattr(module, "repo_relate", relate)
    monkeypatch.setattr(module, "repo_delete", delete)
    monkeypatch.setattr(module, "get_store", lambda: store)
    monkeypatch.setattr(module, "EvidenceService", lambda: evidence)
    monkeypatch.setattr(
        module, "PersonalService", lambda: PersonalService(store=store, submit=submit)
    )
    monkeypatch.setattr(module, "submit_job", submit)
    app = FastAPI()
    app.include_router(module.router, prefix="/api")

    async def invalid_input_handler(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, InvalidInputError)
        return await invalid_input_error_handler(request, exc)

    async def not_found_handler(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, NotFoundError)
        return await not_found_error_handler(request, exc)

    app.add_exception_handler(InvalidInputError, invalid_input_handler)
    app.add_exception_handler(NotFoundError, not_found_handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client,
            store=store,
            evidence=evidence,
            native=native,
            memberships=memberships,
            queue=queue,
            module=module,
        )


async def upload(
    routes,
    *,
    content=b"Original evidence.\n",
    source_id="source:a",
    key="upload-once",
    title="Evidence",
    notebook_id="notebook:a",
    mime_type="text/plain",
    filename="evidence.txt",
):
    data = {"idempotency_key": key, "title": title}
    if source_id is not None:
        data["source_id"] = source_id
    return await routes.client.post(
        f"/api/personal/notebooks/{notebook_id}/sources/upload",
        data=data,
        files={"file": (filename, content, mime_type)},
    )


def turn_request(version_id, notebook_id="notebook:a"):
    return {
        "notebook_id": notebook_id,
        "engine": "independent",
        "message": "What is the evidence?",
        "source_version_ids": [version_id],
        "idempotency_key": "turn-once",
    }


@pytest.mark.asyncio
async def test_upload_rejects_source_owned_by_another_notebook_without_side_effects(
    routes,
):
    response = await upload(routes, source_id="source:b")
    assert response.status_code == 400
    assert response.json()["detail"] == "SOURCE_OUT_OF_SCOPE"
    assert await routes.store.list("version") == []
    assert await routes.store.list("job") == []
    assert routes.queue == []
    assert routes.memberships["notebook:a"] == ["source:a"]


@pytest.mark.asyncio
async def test_turn_rejects_foreign_version_before_creating_job(routes):
    foreign = await routes.evidence.ingest(
        "notebook:b", "source:b", "Foreign", b"Private foreign text", filename="b.txt"
    )
    response = await routes.client.post(
        "/api/personal/chats/chat:a/turns",
        json=turn_request(foreign["source_version_id"]),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "SOURCE_OUT_OF_SCOPE"
    assert await routes.store.list("job") == []
    assert routes.queue == []


@pytest.mark.asyncio
async def test_scoped_turn_queues_exact_snapshot_and_returns_stable_pending_ids(routes):
    version = await routes.evidence.ingest(
        "notebook:a", "source:a", "Local", b"Local evidence", filename="a.txt"
    )
    body = turn_request(version["source_version_id"])
    first = await routes.client.post("/api/personal/chats/chat:a/turns", json=body)
    again = await routes.client.post("/api/personal/chats/chat:a/turns", json=body)
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    value = first.json()
    assert value["state"] == "queued"
    assert value["turn_id"].startswith("turn_")
    job = await routes.store.get("job", value["job_id"])
    assert job["request_snapshot"]["source_version_ids"] == [
        version["source_version_id"]
    ]
    assert job["notebook_id"] == "notebook:a"
    assert routes.queue == [("personal_turn", {"job_id": value["job_id"]})]


@pytest.mark.asyncio
async def test_upload_replay_keeps_one_version_and_download_preserves_bytes(routes):
    content = "🌞 原始字节与结尾换行。\r\n".encode()
    first = await upload(routes, content=content)
    again = await upload(routes, content=content, mime_type="TEXT/PLAIN; charset=utf-8")
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    value = first.json()
    versions = await routes.client.get("/api/personal/sources/source:a/versions")
    assert len(versions.json()) == 1
    assert versions.json()[0]["source_version_id"] == value["source_version_id"]
    original = await routes.client.get(
        f"/api/personal/source-versions/{value['source_version_id']}/download"
    )
    assert original.status_code == 200
    assert original.content == content
    assert original.headers["cache-control"] == "no-store"
    assert original.headers["content-type"].startswith("text/plain")
    assert len(routes.queue) == 1
    job = await routes.store.get("job", value["job_id"])
    assert job["worker_job_id"] == "command:test_1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changed",
    [
        {"content": b"Different bytes"},
        {"title": "Different title"},
        {"source_id": None},
        {"mime_type": "application/pdf"},
    ],
)
async def test_upload_key_conflicts_do_not_replace_original_or_enqueue_again(
    routes, changed
):
    first = await upload(routes)
    conflict = await upload(routes, **changed)
    assert first.status_code == 200
    assert conflict.status_code == 400
    assert conflict.json()["detail"] == "IDEMPOTENCY_CONFLICT"
    assert len(await routes.store.list("version")) == 1
    assert len(await routes.store.list("job")) == 1
    assert len(routes.queue) == 1
    path = await routes.evidence.resolve_file(first.json()["source_version_id"])
    assert path.read_bytes() == b"Original evidence.\n"
    assert set(routes.native) == {"source:a", "source:b"}


@pytest.mark.asyncio
async def test_worker_queue_failure_preserves_downloadable_original_and_failed_job(
    routes, monkeypatch
):
    async def unavailable(*args):
        raise RuntimeError("Queue connection failed")

    monkeypatch.setattr(routes.module, "submit_job", unavailable)
    response = await upload(routes, source_id=None)
    assert response.status_code == 200
    value = response.json()
    job = await routes.store.get("job", value["job_id"])
    assert job["state"] == "failed"
    assert job["error"]["code"] == "WORKER_UNAVAILABLE"
    assert job["submission_state"] == "not_submitted"
    original = await routes.client.get(
        f"/api/personal/source-versions/{value['source_version_id']}/download"
    )
    assert original.status_code == 200
    assert original.content == b"Original evidence.\n"
    assert value["source_id"] in routes.memberships["notebook:a"]
    assert (await upload(routes, source_id=None)).json() == value
    assert len(await routes.store.list("version")) == 1


@pytest.mark.asyncio
async def test_rejected_upload_rolls_back_new_native_source_without_orphan_job(routes):
    response = await upload(routes, source_id=None, content=b"\xff\xfe")
    assert response.status_code == 400
    assert "UTF-8" in response.json()["detail"]
    assert set(routes.native) == {"source:a", "source:b"}
    assert routes.memberships["notebook:a"] == ["source:a"]
    assert await routes.store.list("version") == []
    assert await routes.store.list("job") == []
    assert routes.queue == []


@pytest.mark.asyncio
async def test_oversize_upload_is_rejected_before_creating_source(routes, monkeypatch):
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_FILE_MB", "0.000001")
    response = await upload(routes, source_id=None, content=b"x" * 30)
    assert response.status_code == 400
    assert response.json()["detail"] == "FILE_TOO_LARGE"
    assert set(routes.native) == {"source:a", "source:b"}
    assert await routes.store.list("version") == []


@pytest.mark.asyncio
async def test_invalid_upload_key_and_missing_notebook_have_no_writes(routes):
    bad_key = await upload(routes, key="x" * 201)
    missing = await upload(routes, notebook_id="notebook:missing")
    assert bad_key.status_code == 400
    assert bad_key.json()["detail"] == "INVALID_IDEMPOTENCY_KEY"
    assert missing.status_code == 404
    assert await routes.store.list("version") == []
    assert await routes.store.list("job") == []


@pytest_asyncio.fixture
async def historical(routes):
    version = await routes.evidence.ingest(
        "notebook:a",
        "source:a",
        "Historical",
        "🌞 原始证据。\n".encode(),
        filename="a.txt",
    )
    old = await routes.evidence.extract(version["source_version_id"])
    current = await routes.evidence.extract(version["source_version_id"], force=True)
    other = await routes.evidence.ingest(
        "notebook:b", "source:b", "Other", b"Other evidence", filename="b.txt"
    )
    other_ex = await routes.evidence.extract(other["source_version_id"])
    return SimpleNamespace(
        version=version, old=old, current=current, other=other, other_ex=other_ex
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case,code",
    [
        ("foreign_evidence", "EVIDENCE_VERSION_MISMATCH"),
        ("different_extraction", "EVIDENCE_EXTRACTION_MISMATCH"),
        ("foreign_extraction", "EXTRACTION_VERSION_MISMATCH"),
        ("missing_extraction", "EXTRACTION_VERSION_MISMATCH"),
    ],
)
async def test_reader_rejects_cross_version_or_conflicting_historical_ids(
    routes, historical, case, code
):
    params = {
        "foreign_evidence": {"evidence_id": historical.other_ex["evidence_ids"][0]},
        "different_extraction": {
            "evidence_id": historical.old["evidence_ids"][0],
            "extraction_id": historical.current["extraction_id"],
        },
        "foreign_extraction": {"extraction_id": historical.other_ex["extraction_id"]},
        "missing_extraction": {"extraction_id": "ex_missing"},
    }[case]
    response = await routes.client.get(
        f"/api/personal/source-versions/{historical.version['source_version_id']}",
        params=params,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == code


@pytest.mark.asyncio
async def test_historical_reader_returns_requested_old_extraction_and_exact_codepoints(
    routes, historical
):
    version_id = historical.version["source_version_id"]
    old_id = historical.old["evidence_ids"][0]
    response = await routes.client.get(
        f"/api/personal/source-versions/{version_id}", params={"evidence_id": old_id}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["extraction"]["extraction_id"] == historical.old["extraction_id"]
    assert (
        body["version"]["current_extraction_id"] == historical.current["extraction_id"]
    )
    assert [item["evidence_id"] for item in body["evidence"]] == [old_id]
    record = body["evidence"][0]
    locator = record["locator"]
    text = body["extraction"]["blocks"][0]["text"]
    assert text[locator["start_offset"] : locator["end_offset"]] == "🌞 原始证据。"
    standalone = await routes.client.get(f"/api/personal/evidence/{old_id}")
    assert standalone.json() == record
    missing = await routes.client.get(
        f"/api/personal/source-versions/{version_id}",
        params={"evidence_id": "ev_missing"},
    )
    assert missing.status_code == 404


def parse_events(text):
    return [
        (
            chunk.split("\n", 1)[0].removeprefix("event: "),
            json.loads(chunk.split("data: ", 1)[1]),
        )
        for chunk in text.strip().split("\n\n")
        if chunk
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["succeeded", "failed"])
async def test_sse_terminal_turn_sends_one_final_event_then_closes(routes, state):
    turn = {
        "turn_id": "turn:terminal",
        "status": state,
        "answer": "最终答案" if state == "succeeded" else "",
        "error": {"code": "MODEL_ERROR"} if state == "failed" else None,
    }
    await routes.store.put("turn", turn["turn_id"], turn)
    response = await asyncio.wait_for(
        routes.client.get("/api/personal/turns/turn:terminal/events"), timeout=2
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-store"
    assert parse_events(response.text) == [("final", turn)]


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["failed", "submission_unknown", "cancelled_local"])
async def test_sse_terminal_job_without_turn_sends_state_and_error_then_closes(
    routes, state
):
    error = {
        "code": "OUTCOME_UNKNOWN" if state == "submission_unknown" else "STOPPED",
        "message": "Terminal fixture",
    }
    await routes.store.put(
        "job",
        "job:terminal",
        {
            "job_id": "job:terminal",
            "turn_id": "turn:pending",
            "state": state,
            "error": error,
        },
    )
    response = await asyncio.wait_for(
        routes.client.get("/api/personal/turns/turn:pending/events"), timeout=2
    )
    assert response.status_code == 200
    assert parse_events(response.text) == [
        ("stage", {"turn_id": "turn:pending", "state": state, "error": error})
    ]


@pytest.mark.asyncio
async def test_sse_missing_turn_returns_explicit_error_and_closes(routes):
    response = await asyncio.wait_for(
        routes.client.get("/api/personal/turns/turn:missing/events"), timeout=2
    )
    assert response.status_code == 200
    assert parse_events(response.text) == [("error", {"code": "TURN_NOT_FOUND"})]


@pytest.mark.asyncio
async def test_new_source_without_persisted_identity_fails_before_file_or_relationship(
    routes, monkeypatch
):
    async def missing_identity(self):
        self.id = None

    monkeypatch.setattr(routes.module.Source, "save", missing_identity)
    with pytest.raises(RuntimeError, match="Source save returned no identity"):
        await upload(routes, source_id=None)
    assert routes.memberships["notebook:a"] == ["source:a"]
    assert set(routes.native) == {"source:a", "source:b"}
    assert await routes.store.list("version") == []
    assert await routes.store.list("job") == []
    assert routes.queue == []


@pytest.mark.asyncio
async def test_upload_key_detects_filename_change_that_changes_parser_fallback(routes):
    first = await upload(
        routes, mime_type="application/octet-stream", filename="evidence.txt"
    )
    conflict = await upload(
        routes, mime_type="application/octet-stream", filename="evidence.pdf"
    )
    assert first.status_code == 200
    assert conflict.status_code == 400
    assert conflict.json()["detail"] == "IDEMPOTENCY_CONFLICT"
    versions = await routes.store.list("version")
    assert len(versions) == 1
    assert versions[0]["mime_type"] == "text/plain"
    assert len(routes.queue) == 1


@pytest.mark.asyncio
async def test_reparse_and_revalidation_http_contracts_are_durable(routes):
    from api.evidence_maintenance import EvidenceMaintenanceService

    response = await upload(routes)
    version_id = response.json()["source_version_id"]
    original = await routes.evidence.extract(version_id)
    original["verification_origin"] = "restored_archive"
    await routes.store.put("extraction", original["extraction_id"], original)
    response = await routes.client.post(
        f"/api/personal/source-versions/{version_id}/revalidate",
        json={
            "extraction_id": original["extraction_id"],
            "idempotency_key": "validate-once",
        },
    )
    assert response.status_code == 200
    job = response.json()
    assert job["state"] == "queued"
    assert routes.queue[-1] == ("maintain_evidence", {"job_id": job["job_id"]})
    await EvidenceMaintenanceService(evidence=routes.evidence).run(job["job_id"])
    detail = (
        await routes.client.get(
            f"/api/personal/source-versions/{version_id}",
            params={"extraction_id": original["extraction_id"]},
        )
    ).json()
    assert detail["evidence"][0]["reference_validity"] == "verified"
    assert detail["extraction"]["revalidation"]["verified_count"] == 1
    second = await routes.client.post(
        f"/api/personal/source-versions/{version_id}/reparse",
        json={"idempotency_key": "parse-again"},
    )
    assert second.status_code == 200
    assert second.json()["operation"] == "reparse"
    assert second.json()["job_id"] != job["job_id"]
    assert (
        await routes.client.post(
            f"/api/personal/source-versions/{version_id}/reparse",
            json={"idempotency_key": ""},
        )
    ).status_code == 422
    assert (
        await routes.client.post(
            f"/api/personal/source-versions/{version_id}/revalidate",
            json={"idempotency_key": "x", "extraction_id": "wrong"},
        )
    ).status_code == 400
