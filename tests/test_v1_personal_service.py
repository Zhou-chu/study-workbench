from contextlib import asynccontextmanager
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest


class MemoryStore:
    def __init__(self):
        self.data = {}

    async def get(self, k, i):
        return deepcopy(self.data.get((k, i)))

    async def put(self, k, i, v, create_only=False):
        self.data[k, i] = deepcopy(v)
        return v

    async def list(self, k, notebook_id=None, **kw):
        if notebook_id is not None:
            kw["notebook_id"] = notebook_id
        return [
            deepcopy(v)
            for (kind, _), v in self.data.items()
            if kind == k and all(v.get(a) == b for a, b in kw.items())
        ]

    @asynccontextmanager
    async def project_lock(self, i):
        yield


@pytest.mark.asyncio
async def test_selection_rejects_foreign_version():
    from api.personal_service import PersonalService
    from open_notebook.exceptions import InvalidInputError

    s = MemoryStore()
    await s.put("version", "sv_a", {"source_version_id": "sv_a", "notebook_id": "nb_a"})
    with pytest.raises(InvalidInputError):
        await PersonalService(s).save_selection(
            "nb_b", {"engine": "independent", "source_version_ids": ["sv_a"]}
        )


@pytest.mark.asyncio
async def test_selection_preserves_codepoint_reader_state():
    from api.personal_service import PersonalService

    s = MemoryStore()
    await s.put("version", "sv_a", {"source_version_id": "sv_a", "notebook_id": "nb_a"})
    value = {
        "engine": "independent",
        "source_version_ids": ["sv_a"],
        "reading": {"source_version_id": "sv_a", "page_index": 2},
    }
    result = await PersonalService(s).save_selection("nb_a", value)
    assert result["reading"]["page_index"] == 2
    assert (await s.get("selection", "nb_a"))["source_version_ids"] == ["sv_a"]


@pytest.mark.asyncio
async def test_turn_submission_idempotent_and_conflicting_parameters_fail():
    from api.personal_service import PersonalService
    from open_notebook.exceptions import InvalidInputError

    s = MemoryStore()
    submit = AsyncMock(return_value="command:test")
    service = PersonalService(s, submit=submit)
    request = {
        "notebook_id": "nb_a",
        "engine": "independent",
        "message": "what?",
        "source_version_ids": ["sv_a"],
        "idempotency_key": "once",
    }
    first = await service.submit_turn("session_a", request)
    second = await service.submit_turn("session_a", request)
    assert first["job_id"] == second["job_id"]
    assert submit.await_count == 1
    with pytest.raises(InvalidInputError):
        await service.submit_turn("session_a", {**request, "message": "other"})


@pytest.mark.asyncio
async def test_enqueue_ack_does_not_overwrite_fast_worker_result():
    from api.personal_service import PersonalService

    store = MemoryStore()

    async def submit(command, args):
        job = await store.get("job", args["job_id"])
        job.update(state="succeeded", result={"turn_id": "turn_done"})
        await store.put("job", args["job_id"], job)
        return "command:done"

    request = {
        "notebook_id": "nb",
        "engine": "independent",
        "message": "what",
        "source_version_ids": ["sv"],
        "idempotency_key": "fast",
    }
    job = await PersonalService(store, submit).submit_turn("session", request)
    assert job["state"] == "succeeded"
    assert job["result"]["turn_id"] == "turn_done"


@pytest.mark.asyncio
async def test_notebooklm_answer_saved_as_canonical_turn(monkeypatch):
    from api.notebooklm_service import NotebookLMService
    from api.personal_service import PersonalService

    store = MemoryStore()
    monkeypatch.setattr(
        NotebookLMService,
        "ask",
        AsyncMock(
            return_value={
                "answer": "public fixture answer",
                "citations": [],
                "scope_snapshot": {"source_version_ids": ["sv"]},
                "evidence_ids": [],
                "connector_version": "0.8.5",
            }
        ),
    )
    request = {
        "notebook_id": "nb",
        "engine": "notebooklm",
        "message": "what",
        "source_version_ids": ["sv"],
        "remote_source_ids": ["rs"],
        "idempotency_key": "google-test",
    }
    service = PersonalService(store, AsyncMock(return_value="command:test"))
    job = await service.submit_turn("session", request)
    result = await service.run_turn(job["job_id"])
    assert result["state"] == "succeeded"
    turns = await store.list("turn", notebook_id="nb")
    assert len(turns) == 1
    assert turns[0]["answer"] == "public fixture answer"
    assert turns[0]["scope_snapshot"]["source_version_ids"] == ["sv"]


@pytest.mark.asyncio
async def test_note_cannot_forge_verified_citation(monkeypatch):
    from api.personal_service import PersonalService

    store = MemoryStore()
    from open_notebook.database import note_repository

    async def create_note(**kwargs):
        return note_repository.NoteWriteResult(
            native={
                "id": "note:test",
                "content": kwargs["fields"]["content"],
                "revision": 1,
            },
            snapshot={**kwargs["snapshot"], "id": "note:test", "revision": 1},
        )

    monkeypatch.setattr(note_repository, "create_note", create_note)
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Note.submit_embedding",
        AsyncMock(return_value=None),
    )
    note = await PersonalService(store).save_note(
        "nb",
        {
            "content": "claim",
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": "ev_missing",
                    "quote": "invented",
                    "reference_validity": "verified",
                }
            ],
            "scope_snapshot": {"source_version_ids": []},
        },
    )
    assert note["citations"][0]["reference_validity"] != "verified"


@pytest.mark.asyncio
async def test_submission_returns_stable_turn_id_before_worker():
    from api.personal_service import PersonalService

    s = MemoryStore()
    service = PersonalService(s, AsyncMock(return_value="command:test"))
    request = {
        "notebook_id": "nb",
        "engine": "independent",
        "message": "q",
        "source_version_ids": ["sv"],
        "idempotency_key": "id",
    }
    first = await service.submit_turn("session", request)
    assert first["turn_id"].startswith("turn_")
    assert (await service.submit_turn("session", request))["turn_id"] == first[
        "turn_id"
    ]


@pytest.mark.asyncio
async def test_completion_preserves_worker_ack_written_during_call(monkeypatch):
    from api.notebooklm_service import NotebookLMService
    from api.personal_service import PersonalService

    store = MemoryStore()
    service = PersonalService(store, AsyncMock(return_value="command:test"))
    request = {
        "notebook_id": "nb",
        "engine": "notebooklm",
        "message": "q",
        "source_version_ids": ["sv"],
        "idempotency_key": "race",
    }
    job = await service.submit_turn("session", request)

    async def ask(*a, **kw):
        current = await store.get("job", job["job_id"])
        current["worker_job_id"] = "command:late"
        await store.put("job", job["job_id"], current)
        return {
            "answer": "ok",
            "citations": [],
            "scope_snapshot": {"source_version_ids": ["sv"]},
        }

    monkeypatch.setattr(NotebookLMService, "ask", ask)
    assert (await service.run_turn(job["job_id"]))["worker_job_id"] == "command:late"


@pytest.mark.asyncio
async def test_remote_note_reference_retains_remote_identity(monkeypatch):
    from api.personal_service import PersonalService
    from open_notebook.database import note_repository

    async def create_note(**kwargs):
        return note_repository.NoteWriteResult(
            native={
                "id": "note:test",
                "content": kwargs["fields"]["content"],
                "revision": 1,
            },
            snapshot={**kwargs["snapshot"], "id": "note:test", "revision": 1},
        )

    monkeypatch.setattr(note_repository, "create_note", create_note)
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Note.submit_embedding",
        AsyncMock(return_value=None),
    )
    cite = {
        "citation_id": "c1",
        "kind": "remote_unmapped",
        "source_title": "Remote original",
        "quote": "remote text",
        "evidence_id": None,
        "source_version_id": None,
        "remote_reference": {"url": "https://notebooklm.google.com/notebook/test"},
        "reference_validity": "unverified",
    }
    note = await PersonalService(MemoryStore()).save_note(
        "nb",
        {
            "content": "answer",
            "citations": [cite],
            "scope_snapshot": {"source_version_ids": []},
        },
    )
    assert note["citations"][0]["kind"] == "remote_unmapped"
    assert note["citations"][0]["remote_reference"] == cite["remote_reference"]


@pytest.mark.asyncio
async def test_workspace_keeps_canonical_note_edits(monkeypatch):
    from types import SimpleNamespace

    from api.personal_service import PersonalService
    from open_notebook.domain.notebook import Notebook

    store = MemoryStore()
    await store.put(
        "note_snapshot",
        "note:x",
        {
            "note_id": "note:x",
            "notebook_id": "nb",
            "title": "Old",
            "content": "Old content",
            "citations": [],
        },
    )
    note = SimpleNamespace(
        id="note:x",
        model_dump=lambda **k: {
            "id": "note:x",
            "title": "New",
            "content": "New content",
        },
    )
    nb = SimpleNamespace(
        id="nb",
        name="N",
        get_sources=AsyncMock(return_value=[]),
        get_notes=AsyncMock(return_value=[note]),
    )
    monkeypatch.setattr(Notebook, "get", AsyncMock(return_value=nb))
    from open_notebook.database import note_repository

    monkeypatch.setattr(
        note_repository,
        "read_project_notes_locked",
        AsyncMock(
            return_value=[
                note_repository.NoteWriteResult(
                    native=note.model_dump(), snapshot={"citations": []}
                )
            ]
        ),
    )
    assert (await PersonalService(store).workspace("nb"))["notes"][0][
        "content"
    ] == "New content"


@pytest.mark.asyncio
async def test_bridge_unknown_submission_remains_unknown(monkeypatch):
    from api.notebooklm_service import NotebookLMService
    from api.personal_service import PersonalService
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    store = MemoryStore()
    service = PersonalService(store, AsyncMock(return_value="command:test"))
    request = {
        "notebook_id": "nb",
        "engine": "notebooklm",
        "message": "q",
        "source_version_ids": ["sv"],
        "idempotency_key": "unknown",
    }
    job = await service.submit_turn("session", request)
    monkeypatch.setattr(
        NotebookLMService,
        "ask",
        AsyncMock(
            side_effect=BridgeError(
                "REMOTE_UNAVAILABLE", "Response lost", submission_state="unknown"
            )
        ),
    )
    result = await service.run_turn(job["job_id"])
    assert result["state"] == "submission_unknown"
    assert result["submission_state"] == "unknown"
