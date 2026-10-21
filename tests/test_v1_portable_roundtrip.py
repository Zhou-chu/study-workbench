"""Portable archives exercise real bytes in disjoint storage roots."""

import asyncio
import copy
import hashlib
import io
import json
import shutil
import stat
import zipfile
from contextlib import asynccontextmanager
from typing import Any

import pytest
import pytest_asyncio

from api.portable_service import PortableService
from open_notebook.exceptions import InvalidInputError


class MemoryStore:
    def __init__(self):
        self.data = {}
        self.locks = {}

    async def get(self, kind, identity):
        return copy.deepcopy(self.data.get((kind, identity)))

    async def list(self, kind, notebook_id=None, **filters):
        return [
            copy.deepcopy(v)
            for (k, _), v in self.data.items()
            if k == kind
            and (notebook_id is None or v.get("notebook_id") == notebook_id)
            and all(v.get(f) == wanted for f, wanted in filters.items())
        ]

    async def put(self, kind, identity, value, create_only=False):
        if create_only and (kind, identity) in self.data:
            raise InvalidInputError("already exists")
        self.data[(kind, identity)] = copy.deepcopy(value)
        return value

    async def delete(self, kind, identity):
        self.data.pop((kind, identity), None)

    @asynccontextmanager
    async def project_lock(self, identity):
        async with self.locks.setdefault(identity, asyncio.Lock()):
            yield


class MemoryProjects:
    def __init__(self, snapshot=None, store=None):
        self.snapshot = snapshot
        self.store = store
        self.restored = []
        self.fail_commit = False

    async def read(self, notebook_id):
        return copy.deepcopy(self.snapshot)

    async def commit(self, project, records):
        if self.fail_commit:
            raise RuntimeError("database unavailable")
        self.restored.append(copy.deepcopy(project))
        for kind, identity, value in records:
            await self.store.put(kind, identity, value, create_only=True)


@pytest_asyncio.fixture
async def populated(tmp_path):
    root = tmp_path / "original-environment"
    root.mkdir()
    content = "太阳能来自恒星。\n".encode()
    (root / "lesson.txt").write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    store = MemoryStore()
    notebook = "notebook:original"
    project = {
        "notebook": {"id": notebook, "name": "太阳能", "description": "Course"},
        "sources": [
            {
                "id": "source:one",
                "title": "Lesson",
                "full_text": content.decode(),
                "asset": None,
            }
        ],
        "notes": [{"id": "note:one", "title": "Summary", "content": "Saved answer"}],
        "chat_sessions": [
            {"id": "chat_session:one", "title": "Study", "parent_id": notebook}
        ],
        "legacy_chat": [
            {
                "chat_session_id": "chat_session:one",
                "notebook_id": notebook,
                "messages": [
                    {
                        "id": "message-old",
                        "type": "human",
                        "content": "Visible old history",
                    }
                ],
            }
        ],
        "source_insights": [],
    }
    rows: dict[str, dict[str, Any]] = {
        "version": {
            "source_version_id": "sv_old",
            "notebook_id": notebook,
            "source_id": "source:one",
            "source_title": "Lesson",
            "origin": "upload",
            "original_status": "available",
            "file_path": "lesson.txt",
            "sha256": digest,
            "byte_size": len(content),
            "mime_type": "text/plain",
            "current_extraction_id": "ex_old",
            "status": "ready",
        },
        "extraction": {
            "extraction_id": "ex_old",
            "notebook_id": notebook,
            "source_version_id": "sv_old",
            "status": "ready",
            "blocks": [{"block_id": "document", "text": content.decode()}],
            "evidence_ids": ["ev_old"],
        },
        "evidence": {
            "evidence_id": "ev_old",
            "notebook_id": notebook,
            "source_version_id": "sv_old",
            "extraction_id": "ex_old",
            "quote": "太阳能来自恒星。",
            "quote_hash": hashlib.sha256("太阳能来自恒星。".encode()).hexdigest(),
            "locator": {"block_id": "document", "start_offset": 0, "end_offset": 8},
        },
        "turn": {
            "turn_id": "turn_old",
            "notebook_id": notebook,
            "chat_session_id": "chat_session:one",
            "scope_snapshot": {"source_version_ids": ["sv_old"]},
            "evidence_ids": ["ev_old"],
            "answer": "Saved answer",
            "citations": [
                {
                    "evidence_id": "ev_old",
                    "source_version_id": "sv_old",
                    "kind": "local_evidence",
                    "reference_validity": "verified",
                }
            ],
        },
        "note_snapshot": {
            "note_id": "note:one",
            "notebook_id": notebook,
            "turn_id": "turn_old",
            "citations": [{"evidence_id": "ev_old", "source_version_id": "sv_old"}],
        },
        "link": {
            "notebook_id": notebook,
            "remote_notebook_id": "remote-notebook",
            "connection_id": "connection-secret",
            "mapping_status": "verified",
        },
        "source_link": {
            "link_id": "link_old",
            "notebook_id": notebook,
            "source_version_id": "sv_old",
            "remote_notebook_id": "remote-notebook",
            "remote_source_id": "remote-source",
            "mapping_status": "verified",
        },
        "job": {
            "job_id": "job_old",
            "notebook_id": notebook,
            "operation": "audio",
            "state": "waiting_remote",
            "remote_task_id": "remote-audio",
            "request_snapshot": {
                "source_version_ids": ["sv_old"],
                "access_token": "SECRET_TOKEN",
            },
            "worker_job_id": "command:old",
        },
        "connection": {
            "connection_id": "connection-secret",
            "notebook_id": notebook,
            "password": "SECRET_PASSWORD",
            "profile": "SECRET_COOKIE",
        },
    }
    for kind, row in rows.items():
        await store.put(kind, str(next(iter(row.values()))), row)
    projects = MemoryProjects(project, store)
    service = PortableService(store=store, project_repository=projects, data_root=root)
    return service, projects, rows, content


@pytest.mark.asyncio
async def test_fresh_restore_preserves_bytes_and_remaps_complete_graph(
    populated, tmp_path
):
    service, _, rows, content = populated
    exported = await service.export_project("notebook:original")
    archive = exported["path"].read_bytes()
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        assert "manifest.json" in package.namelist()
        assert any(
            name.startswith("notes/") and name.endswith(".md")
            for name in package.namelist()
        )
        combined = b"\n".join(package.read(name) for name in package.namelist())
        for secret in (
            b"SECRET_TOKEN",
            b"SECRET_PASSWORD",
            b"SECRET_COOKIE",
            b"connection-secret",
            b"command:old",
        ):
            assert secret not in combined
    shutil.rmtree(service.root)
    root = tmp_path / "fresh-environment"
    store = MemoryStore()
    projects = MemoryProjects(store=store)
    importer = PortableService(store=store, project_repository=projects, data_root=root)
    result = await importer.import_archive(io.BytesIO(archive))
    assert result["notebook_id"] != "notebook:original"
    version = (await store.list("version"))[0]
    assert (root / version["file_path"]).read_bytes() == content
    evidence = (await store.list("evidence"))[0]
    turn = (await store.list("turn"))[0]
    assert version["source_version_id"] != "sv_old"
    assert evidence["source_version_id"] == version["source_version_id"]
    assert turn["citations"][0]["evidence_id"] == evidence["evidence_id"]
    assert turn["scope_snapshot"]["source_version_ids"] == [
        version["source_version_id"]
    ]
    assert (await store.list("legacy_chat"))[0]["messages"][0][
        "content"
    ] == "Visible old history"
    assert projects.restored[0]["notes"][0]["content"] == "Saved answer"
    assert (await store.list("source_link"))[0]["mapping_status"] == "unverified"
    assert (await store.list("job"))[0]["replay_allowed"] is False
    assert (await store.list("job"))[0]["state"] == "cancelled_local"
    assert await store.list("connection") == []


def rewrite_zip(data, mutate):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        files = {entry.filename: package.read(entry) for entry in package.infolist()}
    mutate(files)
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as package:
        for name, value in files.items():
            package.writestr(name, value)
    result.seek(0)
    return result


@pytest.mark.asyncio
async def test_tampered_original_rejected_before_any_write(populated, tmp_path):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    data = exported["path"].read_bytes()

    def tamper(files):
        original = next(name for name in files if name.startswith("originals/"))
        files[original] = b"tampered"

    store = MemoryStore()
    projects = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=projects, data_root=tmp_path / "fresh"
    )
    with pytest.raises(InvalidInputError, match="integrity"):
        await importer.import_archive(rewrite_zip(data, tamper))
    assert store.data == {}
    assert projects.restored == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name",
    [
        "../escape",
        "/absolute",
        "C:/windows",
        "originals/../escape",
        "originals\\escape",
    ],
)
async def test_path_traversal_rejected(populated, tmp_path, name):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="path"):
        await service.import_archive(
            rewrite_zip(
                exported["path"].read_bytes(), lambda files: files.update({name: b"x"})
            )
        )


@pytest.mark.asyncio
async def test_symlink_and_zip_bomb_rejected(populated):
    service, _, _, _ = populated
    symlink = io.BytesIO()
    with zipfile.ZipFile(symlink, "w") as package:
        info = zipfile.ZipInfo("link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        package.writestr(info, "/etc/passwd")
    symlink.seek(0)
    with pytest.raises(InvalidInputError, match="symlink"):
        await service.import_archive(symlink)
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("huge", b"0" * 2_000_000)
    bomb.seek(0)
    with pytest.raises(InvalidInputError, match="compression"):
        await service.import_archive(bomb)


@pytest.mark.asyncio
async def test_dangling_reference_fails_export(populated):
    service, _, rows, _ = populated
    rows["turn"]["citations"][0]["evidence_id"] = "ev_absent"
    await service.store.put("turn", "turn_old", rows["turn"])
    with pytest.raises(InvalidInputError, match="reference"):
        await service.export_project("notebook:original")


@pytest.mark.asyncio
async def test_legacy_concurrent_mutation_fails_snapshot(populated):
    service, projects, _, _ = populated
    original = projects.read
    calls = 0

    async def changing(notebook_id):
        nonlocal calls
        result = await original(notebook_id)
        calls += 1
        result["notes"][0]["content"] += str(calls)
        return result

    projects.read = changing
    with pytest.raises(InvalidInputError, match="changed"):
        await service.export_project("notebook:original")


@pytest.mark.asyncio
async def test_failed_atomic_commit_cleans_staged_files(populated, tmp_path):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    projects = MemoryProjects(store=store)
    projects.fail_commit = True
    root = tmp_path / "failed-restore"
    importer = PortableService(store=store, project_repository=projects, data_root=root)
    with pytest.raises(RuntimeError, match="database unavailable"):
        await importer.import_archive(exported["path"])
    assert store.data == {}
    assert not list(root.glob("restored/*"))


def rehash_changed_entities(files, name, transform):
    if name.endswith(".jsonl"):
        value = [json.loads(line) for line in files[name].splitlines() if line]
        transform(value)
        files[name] = b"".join(
            json.dumps(row, ensure_ascii=False).encode() + b"\n" for row in value
        )
    else:
        value = json.loads(files[name])
        transform(value)
        files[name] = json.dumps(value, ensure_ascii=False).encode()
    manifest = json.loads(files["manifest.json"])
    manifest["files"][name] = {
        "sha256": hashlib.sha256(files[name]).hexdigest(),
        "byte_size": len(files[name]),
    }
    files["manifest.json"] = json.dumps(manifest).encode()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutation", ["wrong_quote", "wrong_locator", "outside_scope", "wrong_version"]
)
async def test_recomputed_hashes_cannot_preserve_forged_verified_citations(
    populated, mutation
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")

    def change(turns):
        citation = turns[0]["citations"][0]
        if mutation == "wrong_quote":
            citation["quote"] = "fabricated quote"
        elif mutation == "wrong_locator":
            citation["locator"] = {
                "block_id": "wrong",
                "start_offset": 0,
                "end_offset": 8,
            }
        elif mutation == "outside_scope":
            turns[0]["scope_snapshot"]["source_version_ids"] = []
        else:
            citation["source_version_id"] = None

    archive = rewrite_zip(
        exported["path"].read_bytes(),
        lambda files: rehash_changed_entities(files, "turns.jsonl", change),
    )
    with pytest.raises(InvalidInputError, match="citation"):
        await service.import_archive(archive)


@pytest.mark.asyncio
async def test_restore_rejects_recomputed_dangling_graph(populated):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    archive = rewrite_zip(
        exported["path"].read_bytes(),
        lambda files: rehash_changed_entities(
            files,
            "turns.jsonl",
            lambda rows: rows[0]["scope_snapshot"].update(
                source_version_ids=["sv_missing"]
            ),
        ),
    )
    with pytest.raises(InvalidInputError, match="reference"):
        await service.import_archive(archive)


@pytest.mark.asyncio
async def test_export_job_is_idempotent_and_has_verified_download(
    populated, monkeypatch
):
    import surreal_commands

    service, _, _, _ = populated
    monkeypatch.setattr(
        surreal_commands, "submit_command", lambda *args: "command:test"
    )
    first = await service.request_export("notebook:original", "one-click")
    second = await service.request_export("notebook:original", "one-click")
    assert first["job_id"] == second["job_id"]
    done = await service.run_export(first["job_id"])
    assert done["state"] == "succeeded"
    path = await service.download(done["result"]["export_id"])
    assert path.is_file()
    rerun = await service.run_export(first["job_id"])
    assert rerun == done


@pytest.mark.asyncio
async def test_legacy_history_read_failure_is_explicit(tmp_path, monkeypatch):
    import open_notebook.config
    from api.portable_service import SurrealProjectRepository

    monkeypatch.setattr(
        open_notebook.config,
        "LANGGRAPH_CHECKPOINT_FILE",
        str(tmp_path / "no-history.sqlite"),
    )
    repository = SurrealProjectRepository(MemoryStore())
    with pytest.raises(InvalidInputError, match="history is unavailable"):
        await repository._visible_messages("chat_session:old")


@pytest.mark.asyncio
async def test_restored_verification_is_historical_not_archive_authenticity(
    populated, tmp_path
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=tmp_path / "fresh-trust",
    )
    await importer.import_archive(exported["path"])
    citation = (await store.list("turn"))[0]["citations"][0]
    assert citation["reference_validity"] == "unverified"
    assert citation["archived_reference_validity"] == "verified"


@pytest.mark.asyncio
@pytest.mark.parametrize("claimed_origin", [None, "local_parser"])
async def test_restore_overwrites_evidence_provenance_across_repeated_roundtrips(
    populated, tmp_path, claimed_origin
):
    service, _, rows, _ = populated
    for kind in ("extraction", "evidence"):
        row = rows[kind]
        if claimed_origin is not None:
            row["verification_origin"] = claimed_origin
        await service.store.put(kind, row[f"{kind}_id"], row)
    exported = await service.export_project("notebook:original")

    for generation in range(2):
        store = MemoryStore()
        projects = MemoryProjects(store=store)
        importer = PortableService(
            store=store,
            project_repository=projects,
            data_root=tmp_path / f"provenance-restore-{generation}",
        )
        result = await importer.import_archive(exported["path"])
        for kind in ("extraction", "evidence"):
            restored = await store.list(kind)
            assert len(restored) == 1
            assert restored[0]["verification_origin"] == "restored_archive"
        evidence = (await store.list("evidence"))[0]
        assert evidence["quote"] == rows["evidence"]["quote"]
        assert evidence["locator"] == rows["evidence"]["locator"]

        projects.snapshot = projects.restored[0]
        exported = await importer.export_project(result["notebook_id"])
        with zipfile.ZipFile(exported["path"]) as package:
            extraction = json.loads(package.read("extractions.json"))[0]
            evidence = json.loads(package.read("evidence.jsonl").splitlines()[0])
            assert extraction["verification_origin"] == "restored_archive"
            assert evidence["verification_origin"] == "restored_archive"


@pytest.mark.asyncio
async def test_note_prose_equal_to_identifier_is_not_rewritten(populated, tmp_path):
    service, projects, _, _ = populated
    projects.snapshot["notes"][0]["content"] = "sv_old"
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    destination = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=destination, data_root=tmp_path / "fresh-prose"
    )
    await importer.import_archive(exported["path"])
    assert destination.restored[0]["notes"][0]["content"] == "sv_old"


@pytest.mark.asyncio
async def test_legacy_original_gets_version_without_fabricated_evidence(
    populated, tmp_path
):
    service, projects, _, content = populated
    service.store.data = {}
    projects.snapshot["sources"][0]["asset"] = {
        "file_path": str(service.root / "lesson.txt")
    }
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=tmp_path / "legacy-restored",
    )
    await importer.import_archive(exported["path"])
    version = (await store.list("version"))[0]
    assert (importer.root / version["file_path"]).read_bytes() == content
    assert version["current_extraction_id"] is None
    assert await store.list("evidence") == []


@pytest.mark.asyncio
async def test_original_cannot_reference_entity_json_file(populated):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")

    def mutate(files):
        manifest = json.loads(files["manifest.json"])

        def change(rows):
            rows[0].update(file_path="notes.json", **manifest["files"]["notes.json"])

        rehash_changed_entities(files, "versions.json", change)

    with pytest.raises(InvalidInputError, match="file"):
        await service.import_archive(rewrite_zip(exported["path"].read_bytes(), mutate))


@pytest.mark.asyncio
@pytest.mark.skipif(
    not __import__("os").getenv("STUDY_WORKBENCH_TEST_SURREAL"),
    reason="requires an isolated SurrealDB fixture",
)
async def test_real_surreal_sqlite_and_originals_restore_into_fresh_environment(
    tmp_path, monkeypatch
):
    from uuid import uuid4

    from langchain_core.messages import AIMessage, HumanMessage
    from langchain_core.runnables import RunnableConfig

    import open_notebook.config
    from api.evidence_service import EvidenceService
    from api.personal_store import PersonalStore
    from api.portable_service import SurrealProjectRepository
    from open_notebook.database.async_migrate import AsyncMigrationManager
    from open_notebook.database.repository import ensure_record_id, repo_query
    from open_notebook.domain.notebook import ChatSession, Notebook, Source

    # The test operator starts a dedicated loopback-only fixture; unique database
    # names prevent reading or overwriting any existing application data.
    database_prefix = "portable_" + uuid4().hex
    monkeypatch.setenv("SURREAL_DATABASE", database_prefix + "_source")
    source_root = tmp_path / "source"
    source_root.mkdir()
    sqlite = tmp_path / "source-checkpoints.sqlite"
    monkeypatch.setattr(open_notebook.config, "LANGGRAPH_CHECKPOINT_FILE", str(sqlite))
    # Use a dedicated graph saver even when earlier tests imported the graph.
    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    from open_notebook.graphs.chat import graph as original_graph

    graph = original_graph.copy() if hasattr(original_graph, "copy") else original_graph
    checkpointer = SqliteSaver(sqlite3.connect(sqlite, check_same_thread=False))
    monkeypatch.setattr(graph, "checkpointer", checkpointer)
    import open_notebook.graphs.chat as graph_module

    monkeypatch.setattr(graph_module, "graph", graph)
    await AsyncMigrationManager().run_migration_up()
    notebook = Notebook(
        name="Fresh restore fixture", description="No account or model calls"
    )
    await notebook.save()
    assert notebook.id is not None
    source = Source(title="Evidence original", full_text="真实原件与历史引用。")
    await source.save()
    await source.add_to_notebook(notebook.id)
    session = ChatSession(title="Existing SQLite history")
    await session.save()
    await session.relate_to_notebook(notebook.id)
    await asyncio.to_thread(
        graph.update_state,
        RunnableConfig(configurable={"thread_id": session.id}),
        {
            "messages": [
                HumanMessage(content="What was saved?", id="human-fixture"),
                AIMessage(content="Visible old history", id="ai-fixture"),
            ]
        },
    )
    store = PersonalStore()
    evidence = EvidenceService(store=store, data_root=source_root)
    version = await evidence.ingest(
        notebook.id,
        source.id,
        "Original.txt",
        "真实原件与历史引用。\n".encode(),
        filename="Original.txt",
    )
    extraction = await evidence.extract(version["source_version_id"])
    assert extraction["status"] == "ready"
    evidence_id = extraction["evidence_ids"][0]
    citation = await evidence.validate_citation(
        {"evidence_id": evidence_id},
        [version["source_version_id"]],
        evidence_ids=[evidence_id],
    )
    note_id = "note:" + uuid4().hex
    turn_id = "turn_" + uuid4().hex
    await repo_query(
        "CREATE $note CONTENT $content; RELATE $note->artifact->$notebook;",
        {
            "note": ensure_record_id(note_id),
            "notebook": ensure_record_id(notebook.id),
            "content": {
                "title": "Public fixture note",
                "revision": 7,
                "content": "真实原件与历史引用。",
                "note_type": "human",
            },
        },
    )
    scope = {
        "source_version_ids": [version["source_version_id"]],
        "remote_source_ids": [],
    }
    await store.put(
        "turn",
        turn_id,
        {
            "turn_id": turn_id,
            "notebook_id": notebook.id,
            "chat_session_id": session.id,
            "engine": "independent",
            "status": "succeeded",
            "message": "Public test question",
            "answer": "真实原件与历史引用。",
            "scope_snapshot": scope,
            "evidence_ids": [evidence_id],
            "citations": [citation],
            "model_id": "synthetic-fixture-no-model-call",
            "created_at": "2026-10-18T00:00:00+00:00",
        },
    )
    await store.put(
        "note_snapshot",
        note_id,
        {
            "note_id": note_id,
            "revision": 7,
            "notebook_id": notebook.id,
            "turn_id": turn_id,
            "scope_snapshot": scope,
            "citations": [citation],
        },
    )
    service = PortableService(
        store=store,
        project_repository=SurrealProjectRepository(store),
        data_root=source_root,
    )
    exported = await service.export_project(notebook.id)
    with zipfile.ZipFile(exported["path"]) as package:
        assert json.loads(package.read("manifest.json"))["format_version"] == 2
    standalone = tmp_path / "transfer.zip"
    shutil.copy2(exported["path"], standalone)
    shutil.rmtree(source_root)
    checkpointer.conn.close()
    sqlite.unlink()
    destination = tmp_path / "destination"
    monkeypatch.setenv("SURREAL_DATABASE", database_prefix + "_destination")
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(destination))
    await AsyncMigrationManager().run_migration_up()
    restored_service = PortableService(
        store=store,
        project_repository=SurrealProjectRepository(store),
        data_root=destination,
    )
    result = await restored_service.import_archive(standalone)
    restored = await Notebook.get(result["notebook_id"])
    assert restored.name == notebook.name
    sources = await restored.get_sources(include_full_text=True)
    assert len(sources) == 1 and sources[0].id != source.id
    versions = await store.list("version", notebook_id=restored.id)
    assert (
        hashlib.sha256(
            (destination / versions[0]["file_path"]).read_bytes()
        ).hexdigest()
        == version["sha256"]
    )
    notes = await restored.get_notes(include_content=True)
    assert len(notes) == 1 and notes[0].content == "真实原件与历史引用。"
    assert notes[0].revision == 7
    monkeypatch.setattr(
        "open_notebook.domain.notebook.submit_command", lambda *a, **k: "synthetic"
    )
    notes[0].content = "Restored revision edit"
    await notes[0].save(expected_revision=7)
    assert notes[0].revision == 8
    assert notes[0].id is not None
    restored_snapshot = await store.get("note_snapshot", notes[0].id)
    assert restored_snapshot is not None
    assert restored_snapshot["revision"] == 8
    assert restored_snapshot["content"] == "Restored revision edit"
    restored_turn = (await store.list("turn", notebook_id=restored.id))[0]
    assert restored_turn["citations"][0]["reference_validity"] == "unverified"
    assert restored_turn["citations"][0]["evidence_id"] != evidence_id
    history = await store.list("legacy_chat", notebook_id=restored.id)
    assert [item["content"] for item in history[0]["messages"]] == [
        "What was saved?",
        "Visible old history",
    ]
    assert (
        await repo_query("SELECT * FROM $old;", {"old": ensure_record_id(notebook.id)})
        == []
    )
    # A second export reads normalized restored history without the deleted SQLite.
    second = await restored_service.export_project(restored.id)
    assert second["manifest"]["entity_counts"]["legacy_chat"] == 1
    # Force a real schema rejection inside the single transaction. None of its
    # notebook/source/note rows may leak out and its payload directory is removed.
    from open_notebook.exceptions import DatabaseOperationError

    corrupt = rewrite_zip(
        standalone.read_bytes(),
        lambda files: rehash_changed_entities(
            files, "notes.json", lambda rows: rows[0].update(content=123)
        ),
    )
    before_notebooks = await repo_query("SELECT id FROM notebook;")
    before_folders = set(destination.glob("restored/*"))
    with pytest.raises(DatabaseOperationError, match="rolled back"):
        await restored_service.import_archive(corrupt)
    assert await repo_query("SELECT id FROM notebook;") == before_notebooks
    assert set(destination.glob("restored/*")) == before_folders


@pytest.mark.asyncio
async def test_recomputed_archive_cannot_restore_active_html_original(populated):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    archive = rewrite_zip(
        exported["path"].read_bytes(),
        lambda files: rehash_changed_entities(
            files, "versions.json", lambda rows: rows[0].update(mime_type="text/html")
        ),
    )
    with pytest.raises(InvalidInputError, match="MIME"):
        await service.import_archive(archive)


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_manifest", [None, [], "not-an-object", 123])
async def test_malformed_manifest_is_typed_input_error(populated, invalid_manifest):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    archive = rewrite_zip(
        exported["path"].read_bytes(),
        lambda files: files.update(
            {"manifest.json": json.dumps(invalid_manifest).encode()}
        ),
    )
    with pytest.raises(InvalidInputError):
        await service.import_archive(archive)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "alteration",
    [{"page_index": 99}, {"page_label": "forged-page"}, {"bbox": [0, 0, 10, 10]}],
)
async def test_evidence_cannot_forge_page_or_geometry_even_with_matching_quote(
    populated, alteration
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    archive = rewrite_zip(
        exported["path"].read_bytes(),
        lambda files: rehash_changed_entities(
            files, "evidence.jsonl", lambda rows: rows[0]["locator"].update(alteration)
        ),
    )
    with pytest.raises(InvalidInputError, match="locator"):
        await service.import_archive(archive)


@pytest.mark.asyncio
async def test_remote_scope_and_completed_asset_close_nested_job_references(
    populated, tmp_path
):
    service, _, rows, _ = populated
    rows["turn"]["scope_snapshot"]["remote_source_ids"] = ["google-source-only"]
    await service.store.put("turn", "turn_old", rows["turn"])
    audio = b"ID3-fixture-audio-bytes"
    (service.root / "audio.mp3").write_bytes(audio)
    artifact = {
        "artifact_id": "artifact_old",
        "notebook_id": "notebook:original",
        "file_path": "audio.mp3",
        "sha256": hashlib.sha256(audio).hexdigest(),
        "byte_size": len(audio),
        "mime_type": "audio/mpeg",
        "scope_snapshot": {
            "source_version_ids": ["sv_old"],
            "remote_source_ids": ["google-source-only"],
        },
    }
    await service.store.put("artifact", "artifact_old", artifact)
    rows["job"].update(state="succeeded", result={"artifact": artifact})
    await service.store.put("job", "job_old", rows["job"])
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=tmp_path / "audio-restore",
    )
    await importer.import_archive(exported["path"])
    restored = (await store.list("artifact"))[0]
    assert (importer.root / restored["file_path"]).read_bytes() == audio
    assert (await store.list("job"))[0]["result"]["artifact"]["file_path"] == restored[
        "file_path"
    ]


@pytest.mark.asyncio
async def test_remote_text_snapshot_does_not_claim_original_coverage(populated):
    service, _, rows, _ = populated
    rows["version"].update(origin="remote_text_snapshot", original_status="missing")
    await service.store.put("version", "sv_old", rows["version"])
    exported = await service.export_project("notebook:original")
    assert exported["manifest"]["missing"] == [
        {"source_version_id": "sv_old", "reason": "missing"}
    ]


@pytest.mark.asyncio
async def test_unknown_commit_keeps_bytes_for_possibly_committed_records(
    populated, tmp_path, monkeypatch
):
    from api.portable_service import CommitOutcomeUnknown

    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    projects = MemoryProjects(store=store)

    async def unknown(project, records):
        raise CommitOutcomeUnknown("lost acknowledgement")

    monkeypatch.setattr(projects, "commit", unknown)
    root = tmp_path / "uncertain-restore"
    importer = PortableService(store=store, project_repository=projects, data_root=root)
    with pytest.raises(CommitOutcomeUnknown):
        await importer.import_archive(exported["path"])
    assert len(list(root.glob("restored/*/originals/*"))) == 1


@pytest.mark.asyncio
async def test_concurrent_export_workers_publish_one_attempt(populated, monkeypatch):
    import surreal_commands

    service, _, _, _ = populated
    monkeypatch.setattr(surreal_commands, "submit_command", lambda *args: "command:one")
    job = await service.request_export("notebook:original", "simultaneous")
    one, two = await asyncio.gather(
        service.run_export(job["job_id"]), service.run_export(job["job_id"])
    )
    assert one == two
    assert one["attempts"] == 1


@pytest.mark.asyncio
async def test_restore_recomputes_scope_hash_after_local_identity_remap(
    populated, tmp_path
):
    service, _, rows, _ = populated
    scope = {
        "engine": "independent",
        "selection_origin": "local",
        "source_version_ids": ["sv_old"],
        "remote_source_ids": [],
        "remote_notebook_id": None,
        "mapping_version": 1,
    }
    original_hash = hashlib.sha256(
        json.dumps(
            scope, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()
    rows["turn"].update(
        scope_snapshot={**scope, "scope_hash": original_hash}, scope_hash=original_hash
    )
    await service.store.put("turn", "turn_old", rows["turn"])
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=tmp_path / "scope-restore",
    )
    await importer.import_archive(exported["path"])
    turn = (await store.list("turn"))[0]
    restored_scope = {
        k: v for k, v in turn["scope_snapshot"].items() if k != "scope_hash"
    }
    expected = hashlib.sha256(
        json.dumps(
            restored_scope, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()
    assert turn["scope_hash"] == expected != original_hash


def test_default_constructor_resolves_configured_data_root(tmp_path, monkeypatch):
    configured = tmp_path / "configured-root"
    monkeypatch.setenv("STUDY_WORKBENCH_DATA_DIR", str(configured))
    service = PortableService()
    assert service.root == configured.resolve()


@pytest.mark.asyncio
async def test_restore_discards_claimed_revalidation_report(populated, tmp_path):
    service, _, rows, _ = populated
    extraction = rows["extraction"]
    extraction["revalidation"] = {
        "fresh_extraction_id": extraction["extraction_id"],
        "evidence_ids": [rows["evidence"]["evidence_id"]],
        "verified_count": 1,
    }
    await service.store.put("extraction", extraction["extraction_id"], extraction)
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=tmp_path / "revalidation-trust",
    )
    await importer.import_archive(exported["path"])
    restored = (await store.list("extraction"))[0]
    assert "revalidation" not in restored
    from api.evidence_service import EvidenceService

    record = (await store.list("evidence"))[0]
    checked = await EvidenceService(store, importer.root).validate_citation(
        {"evidence_id": record["evidence_id"]}, [record["source_version_id"]]
    )
    assert checked["reference_validity"] == "unverified"


@pytest.mark.asyncio
async def test_export_metadata_32mib_regression_fails_durably(populated, monkeypatch):
    import surreal_commands

    service, projects, _, _ = populated
    projects.snapshot["notes"][0]["content"] = "x" * (32 * 1024 * 1024)
    monkeypatch.setattr(
        surreal_commands, "submit_command", lambda *args: "command:test"
    )
    job = await service.request_export("notebook:original", "oversized-metadata")
    with pytest.raises(InvalidInputError, match="metadata notes.json"):
        await service.run_export(job["job_id"])
    failed = await service.store.get("job", job["job_id"])
    assert failed["state"] == "failed"
    assert "33554432-byte" in failed["error"]["message"]
    assert not failed.get("result")
    assert not await service.store.list("export")
    assert not list(service.root.glob("exports/*.zip"))


@pytest.mark.asyncio
async def test_shared_archive_expansion_and_manifest_boundaries(populated, tmp_path):
    from dataclasses import replace

    service, _, _, _ = populated
    baseline = await service.export_project("notebook:original")
    wire_size = baseline["path"].stat().st_size
    with zipfile.ZipFile(baseline["path"]) as package:
        expanded = sum(row.file_size for row in package.infolist())
        manifest_size = package.getinfo("manifest.json").file_size
    service.limits = replace(service.limits, max_archive_bytes=wire_size)
    service.max_bytes = expanded
    exact = await service.export_project("notebook:original")
    stage = tmp_path / "read-exact"
    stage.mkdir()
    service._read_archive(exact["path"], stage)
    service.max_bytes = expanded - 1
    with pytest.raises(InvalidInputError, match="size or entry"):
        await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="expanded size"):
        service._read_archive(exact["path"], tmp_path / "read-over")
    service.max_bytes = expanded
    service.limits = replace(service.limits, max_archive_bytes=wire_size - 1)
    with pytest.raises(InvalidInputError, match="ZIP exceeds"):
        await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="ZIP exceeds"):
        service._read_archive(exact["path"], tmp_path / "wire-over")
    service.limits = replace(
        service.limits,
        max_archive_bytes=wire_size,
        max_manifest_bytes=manifest_size - 1,
    )
    with pytest.raises(InvalidInputError, match="manifest exceeds"):
        await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="manifest exceeds"):
        service._read_archive(exact["path"], tmp_path / "manifest-over")


@pytest.mark.asyncio
async def test_entity_exact_limit_roundtrips_and_one_byte_over_fails(
    populated, tmp_path
):
    from dataclasses import replace

    from api.portable_service import _json

    service, projects, _, _ = populated
    projects.snapshot["notes"][0]["content"] = "x" * 5000
    projects.snapshot["notes"][0]["revision"] = 1
    size = len(_json(projects.snapshot["notes"]))
    service.limits = replace(service.limits, max_entity_bytes=size)
    exported = await service.export_project("notebook:original")
    stage = tmp_path / "entity-exact"
    stage.mkdir()
    service._read_archive(exported["path"], stage)
    service.limits = replace(service.limits, max_entity_bytes=size - 1)
    with pytest.raises(InvalidInputError, match="metadata notes.json"):
        await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="metadata exceeds"):
        service._read_archive(exported["path"], tmp_path / "entity-over")


@pytest.mark.asyncio
async def test_export_entry_boundary_and_minimum_ratio_roundtrip(populated, tmp_path):
    service, _, _, _ = populated
    service.max_ratio = 1
    baseline = await service.export_project("notebook:original")
    with zipfile.ZipFile(baseline["path"]) as package:
        service.max_entries = len(package.infolist())
        assert all(row.compress_size == row.file_size for row in package.infolist())
    exact = await service.export_project("notebook:original")
    stage = tmp_path / "entries-exact"
    stage.mkdir()
    service._read_archive(exact["path"], stage)
    service.max_entries -= 1
    with pytest.raises(InvalidInputError, match="size or entry"):
        await service.export_project("notebook:original")
    with pytest.raises(InvalidInputError, match="entry count"):
        service._read_archive(exact["path"], tmp_path / "entries-over")
    assert not list(service.root.glob("exports/*.partial"))


def test_import_entry_preflight_precedes_zipfile_allocation(tmp_path, monkeypatch):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        for index in range(3):
            package.writestr(f"member-{index}", b"")
    service = PortableService(store=MemoryStore(), data_root=tmp_path)
    service.max_entries = 2

    def forbidden_constructor(*args, **kwargs):
        raise AssertionError("Oversized directory must fail before ZipFile allocation")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_constructor)
    with pytest.raises(InvalidInputError, match="entry count"):
        service._read_archive(archive, tmp_path / "stage")


@pytest.mark.parametrize(
    "native,snapshot,wanted", [(None, None, 1), (1, None, 1), (None, 1, 1), (7, 7, 7)]
)
def test_portable_note_revision_normalization(native, snapshot, wanted):
    from api.portable_service import normalize_note_revisions

    notes = [{"id": "note:one"}]
    snapshots = [{"note_id": "note:one"}]
    if native is not None:
        notes[0]["revision"] = native
    if snapshot is not None:
        snapshots[0]["revision"] = snapshot
    normalize_note_revisions(notes, snapshots)
    assert notes[0]["revision"] == snapshots[0]["revision"] == wanted


@pytest.mark.parametrize(
    "native,snapshot",
    [(True, 1), (1.0, 1), ("1", 1), (0, 1), (-1, 1), (7, 6), (None, 7), (7, None)],
)
def test_portable_rejects_bad_or_mismatched_note_revision(native, snapshot):
    from api.portable_service import normalize_note_revisions

    notes = [{"id": "note:one"}]
    snapshots = [{"note_id": "note:one"}]
    if native is not None:
        notes[0]["revision"] = native
    if snapshot is not None:
        snapshots[0]["revision"] = snapshot
    with pytest.raises(InvalidInputError):
        normalize_note_revisions(notes, snapshots)


# Frozen compatibility model of the gate in 07654a46 and 51a58f1.
# Deliberately independent of current FORMAT_VERSION and git availability.
# This models the historical gate, NOT an entire historical application runtime.
def historical_format1_gate(manifest):
    if (
        type(manifest.get("format_version")) is not int
        or manifest["format_version"] != 1
    ):
        raise InvalidInputError("Unsupported portable format version")


def set_archive_format(files, version):
    manifest = json.loads(files["manifest.json"])
    if version == "missing":
        manifest.pop("format_version", None)
    else:
        manifest["format_version"] = version
    files["manifest.json"] = json.dumps(manifest).encode()


@pytest.mark.asyncio
async def test_new_export_is_format2_and_old_gate_rejects_before_restore(populated):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    with zipfile.ZipFile(exported["path"]) as package:
        manifest = json.loads(package.read("manifest.json"))
        assert manifest["format_version"] == 2
        assert b"format 2." in package.read("README.md")
    historical_format1_gate({"format_version": 1})  # positive legacy control
    writes = []
    with pytest.raises(InvalidInputError, match="Unsupported portable format"):
        historical_format1_gate(manifest)
        writes.append("restore reached")
    assert writes == []


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("revision", [None, 7])
async def test_supported_archive_versions_preserve_revision_semantics(
    populated, tmp_path, version, revision
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")

    def mutate(files):
        set_archive_format(files, version)
        for name in ("notes.json", "note-snapshots.json"):

            def change(rows):
                for row in rows:
                    if revision is None:
                        row.pop("revision", None)
                    else:
                        row["revision"] = revision

            rehash_changed_entities(files, name, change)

    store = MemoryStore()
    projects = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=projects, data_root=tmp_path / "restored"
    )
    await importer.import_archive(rewrite_zip(exported["path"].read_bytes(), mutate))
    assert projects.restored[0]["notes"][0]["revision"] == (revision or 1)
    assert (await store.list("note_snapshot"))[0]["revision"] == (revision or 1)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "version", [0, 3, True, False, 1.0, 2.0, "2", None, [], {}, "missing"]
)
async def test_invalid_archive_version_rejected_without_writes(
    populated, tmp_path, version
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    projects = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=projects, data_root=tmp_path / "destination"
    )
    archive = rewrite_zip(
        exported["path"].read_bytes(), lambda files: set_archive_format(files, version)
    )
    with pytest.raises(InvalidInputError, match="Unsupported portable format"):
        await importer.import_archive(archive)
    assert store.data == {}
    assert projects.restored == []
    assert not list(importer.root.glob("restored/*"))
    assert not list(importer.root.glob(".import-*"))


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize(
    "native,snapshot",
    [(7, 6), (None, 7), (True, 1), ("7", 7), (1.0, 1), (0, 1), (-1, 1)],
)
async def test_supported_formats_reject_bad_revisions_without_writes(
    populated, tmp_path, version, native, snapshot
):
    service, _, _, _ = populated
    exported = await service.export_project("notebook:original")

    def mutate(files):
        set_archive_format(files, version)
        for name, revision in (
            ("notes.json", native),
            ("note-snapshots.json", snapshot),
        ):

            def change(rows):
                if revision is None:
                    rows[0].pop("revision", None)
                else:
                    rows[0]["revision"] = revision

            rehash_changed_entities(files, name, change)

    store = MemoryStore()
    projects = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=projects, data_root=tmp_path / "destination"
    )
    with pytest.raises(InvalidInputError, match="revision"):
        await importer.import_archive(
            rewrite_zip(exported["path"].read_bytes(), mutate)
        )
    assert store.data == {}
    assert projects.restored == []
    assert not list(importer.root.glob("restored/*"))
    assert not list(importer.root.glob(".import-*"))


@pytest.mark.asyncio
@pytest.mark.parametrize("note_shape", ["snapshot", "native_only", "no_notes"])
async def test_format2_export_is_unconditional_and_restores_revision7(
    populated, tmp_path, note_shape
):
    service, projects, _, _ = populated
    projects.snapshot["notes"][0]["revision"] = 7
    for key, row in list(service.store.data.items()):
        if key[0] == "note_snapshot":
            if note_shape == "snapshot":
                row["revision"] = 7
            else:
                del service.store.data[key]
    if note_shape == "no_notes":
        projects.snapshot["notes"] = []
    exported = await service.export_project("notebook:original")
    with zipfile.ZipFile(exported["path"]) as package:
        assert json.loads(package.read("manifest.json"))["format_version"] == 2
    store = MemoryStore()
    restored = MemoryProjects(store=store)
    importer = PortableService(
        store=store, project_repository=restored, data_root=tmp_path / "destination"
    )
    await importer.import_archive(exported["path"])
    notes = restored.restored[0]["notes"]
    snapshots = await store.list("note_snapshot")
    if note_shape == "no_notes":
        assert notes == []
    else:
        assert notes[0]["revision"] == 7
    if note_shape == "snapshot":
        assert snapshots[0]["revision"] == 7
    else:
        assert snapshots == []
