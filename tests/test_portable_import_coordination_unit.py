"""Import and export-read decisions without an archive, storage, graph or thread."""

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api import portable_service as subject
from open_notebook.database import note_repository, repository
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

pytestmark = pytest.mark.asyncio


@dataclass
class VirtualVolume:
    events: list[tuple[Any, ...]] = field(default_factory=list)
    fail_move_to: str | None = None


@dataclass(frozen=True)
class VirtualPath:
    volume: VirtualVolume
    path: PurePosixPath

    @property
    def parent(self) -> "VirtualPath":
        return VirtualPath(self.volume, self.path.parent)

    def __truediv__(self, name: str) -> "VirtualPath":
        return VirtualPath(self.volume, self.path / name)

    def resolve(self) -> "VirtualPath":
        return self

    def mkdir(self, *, parents: bool = False, exist_ok: bool = False) -> None:
        self.volume.events.append(("mkdir", str(self.path), parents, exist_ok))

    def replace(self, target: "VirtualPath") -> None:
        self.volume.events.append(("replace", str(self.path), str(target.path)))
        if str(target.path) == self.volume.fail_move_to:
            raise OSError("Synthetic rename failure")


ROOT = PurePosixPath("/synthetic-import")
STAGE = ROOT / "stage"
PREFIX = "restored/restoreid"
DEST = ROOT / PREFIX


@dataclass
class RestoreCase:
    target: subject.PortableService
    volume: VirtualVolume
    manifest: dict[str, Any]
    project: dict[str, Any]
    archive: object
    execute: AsyncMock
    commit: AsyncMock


@pytest.fixture
def restore(monkeypatch: pytest.MonkeyPatch) -> RestoreCase:
    volume = VirtualVolume()
    incoming: dict[str, Any] = {kind: [] for kind in subject.FILES}
    incoming["notebook"] = {"id": "notebook:old", "name": "Reference project"}
    incoming["sources"] = [{"id": "source:old"}]
    incoming["notes"] = [{"id": "note:old", "content": "Retain me", "revision": 2}]
    incoming["version"] = [
        {
            "source_version_id": "sv_old",
            "source_id": "source:old",
            "file_path": "originals/content.pdf",
            "status": "ready",
        }
    ]
    incoming["artifact"] = [
        {"artifact_id": "artifact_old", "file_path": "artifacts/result.txt"}
    ]
    manifest: dict[str, Any] = {
        "entity_counts": {"notebook": 1, "notes": 1},
        "files": dict.fromkeys(
            (*subject.FILES.values(), "originals/content.pdf", "artifacts/result.txt"),
            {},
        ),
    }
    archive = object()
    fake_ids = iter(
        (
            "restoreid",
            "newnotebook",
            "newsource",
            "newnote",
            "newversion",
            "newartifact",
        )
    )
    monkeypatch.setattr(subject, "uuid4", lambda: SimpleNamespace(hex=next(fake_ids)))
    monkeypatch.setattr(
        subject, "Path", lambda folder: VirtualPath(volume, PurePosixPath(folder))
    )

    @contextmanager
    def staging(*, prefix: str, dir: VirtualPath) -> Iterator[str]:
        volume.events.append(("stage-enter", prefix, str(dir.path)))
        try:
            yield str(STAGE)
        finally:
            volume.events.append(("stage-exit",))

    monkeypatch.setattr(
        subject, "tempfile", SimpleNamespace(TemporaryDirectory=staging)
    )

    async def execute(function, *args):
        if function == target._read_archive:
            actual_archive, stage = args
            assert actual_archive is archive
            volume.events.append(("read", str(stage.path)))
            return incoming, manifest
        assert function is subject.shutil.rmtree
        path, ignore_errors = args
        volume.events.append(("remove", str(path.path), ignore_errors))

    async def commit(project, records):
        volume.events.append(("commit", project["notebook"]["id"]))

    execute_mock = AsyncMock(side_effect=execute)
    commit_mock = AsyncMock(side_effect=commit)
    monkeypatch.setattr(subject, "asyncio", SimpleNamespace(to_thread=execute_mock))
    target = subject.PortableService(
        store=object(),
        project_repository=SimpleNamespace(commit=commit_mock),
        data_root=ROOT,
    )
    return RestoreCase(
        target, volume, manifest, incoming, archive, execute_mock, commit_mock
    )


async def test_restore_publishes_only_binary_payloads_before_commit(
    restore: RestoreCase,
) -> None:
    result = await restore.target.import_archive(restore.archive)
    moves = [event[1:] for event in restore.volume.events if event[0] == "replace"]
    assert moves == [
        (
            str(STAGE / "originals/content.pdf"),
            str(STAGE / ".payloads/originals/content.pdf"),
        ),
        (
            str(STAGE / "artifacts/result.txt"),
            str(STAGE / ".payloads/artifacts/result.txt"),
        ),
        (str(STAGE / ".payloads"), str(DEST)),
    ]
    assert restore.volume.events[-3:] == [
        ("replace", str(STAGE / ".payloads"), str(DEST)),
        ("commit", "notebook:newnotebook"),
        ("stage-exit",),
    ]
    assert result["notebook_id"] == "notebook:newnotebook"
    assert result["entity_counts"] == {"notebook": 1, "notes": 1}
    assert result["missing"] == []
    notes = " ".join(result["warnings"])
    assert "re-verification" in notes and "not be replayed" in notes
    assert "Credentials and embeddings were not restored" in notes
    assert restore.execute.await_count == 1


async def test_restore_commits_remapped_payload_paths_and_transaction_records(
    restore: RestoreCase,
) -> None:
    result = await restore.target.import_archive(restore.archive)
    assert restore.commit.await_args is not None
    project, records = restore.commit.await_args.args
    assert project["notes"] == [
        {"id": "note:newnote", "content": "Retain me", "revision": 2}
    ]
    assert result["id_map"]["sv_old"] == "sv_newversion"
    keyed = {(kind, key): record for kind, key, record in records}
    assert keyed == {
        ("version", "sv_newversion"): {
            "source_version_id": "sv_newversion",
            "source_id": "source:newsource",
            "file_path": PREFIX + "/originals/content.pdf",
            "status": "ready",
        },
        ("artifact", "artifact_newartifact"): {
            "artifact_id": "artifact_newartifact",
            "file_path": PREFIX + "/artifacts/result.txt",
        },
    }


async def test_restore_without_binaries_still_commits_project_and_preserves_missing_report(
    restore: RestoreCase,
) -> None:
    restore.manifest["files"] = dict.fromkeys(subject.FILES.values(), {})
    del restore.project["version"][0]["file_path"]
    del restore.project["artifact"][0]["file_path"]
    restore.manifest["missing"] = [{"kind": "original", "reason": "Unavailable"}]
    result = await restore.target.import_archive(restore.archive)
    assert result["missing"] == [{"kind": "original", "reason": "Unavailable"}]
    assert [event[1:] for event in restore.volume.events if event[0] == "replace"] == [
        (str(STAGE / ".payloads"), str(DEST))
    ]
    restore.commit.assert_awaited_once()


@pytest.mark.parametrize(
    "failure",
    [TypeError, KeyError, AttributeError, RecursionError, UnicodeError],
)
async def test_archive_schema_failure_never_publishes_or_commits(
    restore: RestoreCase, failure: type[Exception]
) -> None:
    exc = failure("Synthetic decoder failure")
    restore.execute.side_effect = exc
    with pytest.raises(
        InvalidInputError, match="Invalid portable entity or manifest schema"
    ) as caught:
        await restore.target.import_archive(restore.archive)
    assert caught.value.__cause__ is exc
    assert [event[0] for event in restore.volume.events] == [
        "mkdir",
        "stage-enter",
        "stage-exit",
    ]
    restore.commit.assert_not_awaited()


@pytest.mark.parametrize(
    "failure", [InvalidInputError, asyncio.CancelledError, OSError]
)
async def test_archive_boundaries_preserve_non_schema_errors_without_publishing(
    restore: RestoreCase, failure: type[BaseException]
) -> None:
    exc = failure("Synthetic read failure")
    restore.execute.side_effect = exc
    with pytest.raises(failure) as caught:
        await restore.target.import_archive(restore.archive)
    assert caught.value is exc
    assert restore.volume.events[-1] == ("stage-exit",)
    assert not any(event[0] == "replace" for event in restore.volume.events)
    restore.commit.assert_not_awaited()


@pytest.mark.parametrize(
    "path",
    [STAGE / ".payloads/originals/content.pdf", DEST],
)
async def test_publish_move_failure_stops_before_commit(
    restore: RestoreCase, path: PurePosixPath
) -> None:
    restore.volume.fail_move_to = str(path)
    with pytest.raises(OSError, match="Synthetic rename failure"):
        await restore.target.import_archive(restore.archive)
    assert restore.volume.events[-2][0] == "replace"
    assert restore.volume.events[-2][-1] == str(path)
    assert restore.volume.events[-1] == ("stage-exit",)
    restore.commit.assert_not_awaited()
    assert restore.execute.await_count == 1


@pytest.mark.parametrize("failure", [DatabaseOperationError, RuntimeError])
async def test_definite_commit_failure_requests_removal_of_published_binary_only(
    restore: RestoreCase, failure: type[Exception]
) -> None:
    exc = failure("Rejected before transaction completion")

    async def fail(*args):
        restore.volume.events.append(("commit-failure",))
        raise exc

    restore.commit.side_effect = fail
    with pytest.raises(failure) as caught:
        await restore.target.import_archive(restore.archive)
    assert caught.value is exc
    assert restore.volume.events[-3:] == [
        ("commit-failure",),
        ("remove", str(DEST), True),
        ("stage-exit",),
    ]
    restore.commit.assert_awaited_once()


@pytest.mark.parametrize("cause", [None, asyncio.CancelledError, OSError])
async def test_unknown_commit_outcome_never_requests_removal_or_replay(
    restore: RestoreCase, cause: type[BaseException] | None
) -> None:
    exc = subject.CommitOutcomeUnknown("Synthetic unconfirmed transaction")

    async def fail(*args):
        if cause is None:
            raise exc
        raise exc from cause()

    restore.commit.side_effect = fail
    with pytest.raises(subject.CommitOutcomeUnknown) as caught:
        await restore.target.import_archive(restore.archive)
    assert caught.value is exc
    if cause is not None:
        assert isinstance(caught.value.__cause__, cause)
    assert restore.volume.events[-2:] == [
        ("replace", str(STAGE / ".payloads"), str(DEST)),
        ("stage-exit",),
    ]
    assert restore.execute.await_count == 1
    restore.commit.assert_awaited_once()


@dataclass
class ReadCase:
    target: subject.SurrealProjectRepository
    get: AsyncMock
    sources: AsyncMock
    notes: AsyncMock
    repository_query: AsyncMock
    history: AsyncMock
    store_get: AsyncMock


@pytest.fixture
def read(monkeypatch: pytest.MonkeyPatch) -> ReadCase:
    notebook = Notebook(id="notebook:sample", name="Reference", description="")
    get = AsyncMock(return_value=notebook)
    sources = AsyncMock(return_value=[])
    notes = AsyncMock(return_value=[])
    repository_query = AsyncMock(return_value=[])
    history = AsyncMock(return_value=[])
    store_get = AsyncMock(return_value=None)
    target = subject.SurrealProjectRepository(SimpleNamespace(get=store_get))
    monkeypatch.setattr(Notebook, "get", get)
    monkeypatch.setattr(Notebook, "get_sources", sources)
    monkeypatch.setattr(note_repository, "read_project_notes_locked", notes)
    monkeypatch.setattr(repository, "repo_query", repository_query)
    monkeypatch.setattr(target, "_visible_messages", history)
    return ReadCase(target, get, sources, notes, repository_query, history, store_get)


async def test_project_read_preserves_saved_note_revisions_and_available_snapshots(
    read: ReadCase,
) -> None:
    note = {"id": "note:current", "revision": 5, "content": "Current"}
    old = {"id": "note:old", "revision": 1}
    snapshot = {"source": "saved dialog"}
    read.notes.return_value = [
        note_repository.NoteWriteResult(native=note, snapshot=snapshot),
        note_repository.NoteWriteResult(native=old, snapshot=None),
    ]
    result = await read.target.read("notebook:sample")
    assert result["notes"] == [note, old] and result["note_snapshot"] == [snapshot]
    assert result["notebook"]["id"] == "notebook:sample"
    assert result["source_insights"] == []
    read.notes.assert_awaited_once_with("notebook:sample")
    read.sources.assert_awaited_once_with(include_full_text=True)
    read.repository_query.assert_awaited_once()


async def test_project_read_deduplicates_relationships_and_merges_preserved_visible_history(
    read: ReadCase,
) -> None:
    source = Source(id="source:sample", full_text="Retained source")
    read.sources.return_value = [source]
    notebook_session = {
        "session": {"id": "chat_session:notebook", "title": "Notebook session"},
        "parent_id": "notebook:sample",
    }
    source_session = {
        "session": {"id": "chat_session:source", "title": "Source session"},
        "parent_id": "source:sample",
    }
    returned_insights = [{"id": "source_insight:sample", "source": "source:sample"}]
    read.repository_query.side_effect = [
        [{"session": None}, notebook_session, notebook_session, source_session],
        returned_insights,
    ]
    stored = {"id": "msg:both", "content": "Previously saved"}
    new = {"id": "msg:new", "content": "New"}
    read.store_get.side_effect = [{"messages": [stored]}, None]
    read.history.side_effect = [[{"id": "msg:both", "content": "Duplicate"}, new], []]

    result = await read.target.read("notebook:sample")

    assert [session["id"] for session in result["chat_sessions"]] == [
        "chat_session:notebook",
        "chat_session:source",
    ]
    assert result["legacy_chat"][0]["messages"] == [stored, new]
    assert result["legacy_chat"][1]["messages"] == []
    assert result["sources"][0]["full_text"] == "Retained source"
    assert result["source_insights"] == returned_insights
    assert [c.kwargs for c in read.history.await_args_list] == [
        {"source_chat": False, "allow_missing": True},
        {"source_chat": True, "allow_missing": False},
    ]
    relations, insights = read.repository_query.await_args_list
    assert [str(rid) for rid in relations.args[1]["parents"]] == [
        "notebook:sample",
        "source:sample",
    ]
    assert [str(rid) for rid in insights.args[1]["sources"]] == ["source:sample"]


async def test_project_read_missing_notebook_short_circuits_dependent_reads(
    read: ReadCase,
) -> None:
    read.get.return_value = None
    with pytest.raises(NotFoundError):
        await read.target.read("notebook:missing")
    read.sources.assert_not_awaited()
    read.notes.assert_not_awaited()
    read.repository_query.assert_not_awaited()
    read.history.assert_not_awaited()


@pytest.mark.parametrize("boundary", ["sources", "notes", "relations", "history"])
async def test_project_read_does_not_return_partial_project_after_cancel(
    read: ReadCase, boundary: str
) -> None:
    failure = asyncio.CancelledError()
    if boundary == "sources":
        read.sources.side_effect = failure
    elif boundary == "notes":
        read.notes.side_effect = failure
    elif boundary == "relations":
        read.repository_query.side_effect = failure
    else:
        read.repository_query.return_value = [
            {"session": {"id": "chat_session:sample"}, "parent_id": "notebook:sample"}
        ]
        read.history.side_effect = failure

    with pytest.raises(asyncio.CancelledError) as caught:
        await read.target.read("notebook:sample")
    assert caught.value is failure
    assert read.history.await_count == int(boundary == "history")
