"""Archive writer policy with in-memory path and packaging boundaries."""

import hashlib
import json
from dataclasses import dataclass, field, replace
from pathlib import PurePosixPath
from types import SimpleNamespace
from typing import Any

import pytest

from api import portable_service as subject
from open_notebook.exceptions import InvalidInputError

STAGE = PurePosixPath("/synthetic-staging")
TARGET = PurePosixPath("/synthetic-published/export.zip")
PARTIAL = TARGET.with_suffix(".partial")


@dataclass
class Volume:
    data: dict[PurePosixPath, bytes] = field(default_factory=dict)
    members: dict[str, bytes] = field(default_factory=dict)
    actions: list[tuple[str, object]] = field(default_factory=list)
    package_size: int = 512
    fault: str | None = None


@dataclass(frozen=True)
class VirtualPath:
    volume: Volume
    key: PurePosixPath

    def __truediv__(self, member: str) -> "VirtualPath":
        return VirtualPath(self.volume, self.key / member)

    def resolve(self) -> "VirtualPath":
        assert self.key == TARGET.parent
        return self

    def with_suffix(self, suffix: str) -> "VirtualPath":
        return VirtualPath(self.volume, self.key.with_suffix(suffix))

    @property
    def parent(self) -> "VirtualPath":
        return VirtualPath(self.volume, self.key.parent)

    def write_bytes(self, raw: bytes) -> None:
        assert self.key.is_relative_to(STAGE)
        self.volume.data[self.key] = raw

    def mkdir(self, *, exist_ok: bool, parents: bool = False) -> None:
        assert exist_ok and self.key in (STAGE / "notes", TARGET.parent)
        assert parents == (self.key == TARGET.parent)

    def stat(self) -> SimpleNamespace:
        assert self.key == PARTIAL
        return SimpleNamespace(st_size=len(self.volume.data[self.key]))

    def replace(self, destination: "VirtualPath") -> None:
        assert self.key == PARTIAL and destination.key == TARGET
        self.volume.actions.append(("publish", destination.key))
        self.volume.data[destination.key] = self.volume.data.pop(self.key)

    def unlink(self, *, missing_ok: bool) -> None:
        assert self.key == PARTIAL and missing_ok
        self.volume.actions.append(("cleanup", self.key))
        self.volume.data.pop(self.key, None)


@dataclass
class Writer:
    service: subject.PortableService
    volume: Volume
    project: dict[str, Any]
    files: dict[str, Any]
    fault: OSError

    def write(self, missing: list[dict[str, str]] | None = None) -> dict:
        return self.service._write_archive(
            self.project,
            self.files,
            missing or [],
            VirtualPath(self.volume, STAGE),
            VirtualPath(self.volume, TARGET),
        )


@pytest.fixture
def writer(monkeypatch: pytest.MonkeyPatch) -> Writer:
    volume = Volume()
    fault = OSError("Synthetic packaging failure")

    class Package:
        def __init__(self, path: VirtualPath, mode: str, compression: int):
            assert (path.key, mode, compression) == (
                PARTIAL,
                "w",
                subject.zipfile.ZIP_STORED,
            )
            volume.actions.append(("open", path.key))
            volume.data[path.key] = b"x" * volume.package_size

        def __enter__(self) -> "Package":
            return self

        def __exit__(self, *exc: object) -> None:
            volume.actions.append(("close", PARTIAL))
            if volume.fault == "close":
                raise fault

        def write(self, path: VirtualPath, member: str) -> None:
            if volume.fault == member:
                raise fault
            assert path.key == STAGE / member
            volume.members[member] = volume.data[path.key]

    monkeypatch.setattr(
        subject, "zipfile", SimpleNamespace(ZipFile=Package, ZIP_STORED=0)
    )
    monkeypatch.setattr(subject, "_now", lambda: "2026-06-01T12:00:00+00:00")

    def virtual_root(path: PurePosixPath) -> VirtualPath:
        assert path == TARGET.parent
        return VirtualPath(volume, path)

    monkeypatch.setattr(subject, "Path", virtual_root)
    service = subject.PortableService(
        store=object(), project_repository=object(), data_root=TARGET.parent
    )
    assert isinstance(service.root, VirtualPath) and service.root.key == TARGET.parent
    project: dict[str, Any] = {kind: [] for kind in subject.FILES}
    project["notebook"] = {"id": "notebook:fixture", "name": "课程"}
    return Writer(service, volume, project, {}, fault)


def test_writer_publishes_manifest_for_binary_and_json_members(writer: Writer) -> None:
    version = {"source_version_id": "sv_fixture"}
    writer.project["version"] = [version, {"source_version_id": "sv_another"}]
    writer.project["evidence"] = [{"evidence_id": "ev_one"}, {"evidence_id": "ev_two"}]
    member = "originals/example.pdf"
    raw = b"synthetic original"
    writer.volume.data[STAGE / member] = raw
    writer.files[member] = {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "byte_size": len(raw),
    }
    missing = [{"source_version_id": "sv_another", "reason": "missing"}]

    manifest = writer.write(missing)

    assert manifest == json.loads(writer.volume.members["manifest.json"])
    assert manifest["missing"] == missing
    assert manifest["created_at"] == "2026-06-01T12:00:00+00:00"
    assert manifest["entity_counts"]["notebook"] == 1
    assert manifest["entity_counts"]["version"] == 2
    assert "manifest.json" not in manifest["files"]
    assert list(writer.volume.members) == [*sorted(manifest["files"]), "manifest.json"]
    assert writer.volume.members[member] == raw
    assert (
        json.loads(writer.volume.members["versions.json"]) == writer.project["version"]
    )
    evidence_jsonl = writer.volume.members["evidence.jsonl"]
    assert evidence_jsonl.endswith(b"\n")
    assert [json.loads(line) for line in evidence_jsonl.splitlines()] == writer.project[
        "evidence"
    ]
    assert (
        json.loads(writer.volume.members[subject.FILES["notebook"]])["name"] == "课程"
    )
    for name, descriptor in manifest["files"].items():
        data = writer.volume.members[name]
        assert descriptor == {
            "sha256": hashlib.sha256(data).hexdigest(),
            "byte_size": len(data),
        }
    assert writer.volume.actions == [
        ("open", PARTIAL),
        ("close", PARTIAL),
        ("publish", TARGET),
        ("cleanup", PARTIAL),
    ]


def test_saved_note_markdown_keeps_evidence_page_fallback_and_remote_text(
    writer: Writer,
) -> None:
    writer.project["notes"] = [{"id": "note:one", "title": "摘记", "content": "已保存"}]
    writer.project["version"] = [
        {
            "source_version_id": "sv_one",
            "source_title": "原件",
            "file_path": "originals/example.pdf",
        }
    ]
    writer.project["evidence"] = [
        {
            "evidence_id": "ev_one",
            "source_version_id": "sv_one",
            "locator": {"page_index": 0},
            "quote": "实际原文",
        }
    ]
    writer.project["note_snapshot"] = [
        {
            "note_id": "note:one",
            "citations": [
                {"evidence_id": "ev_one", "quote": "不使用旧引文"},
                {
                    "evidence_id": "ev_remote",
                    "locator": {"block_id": "section-2"},
                    "quote": "远程原文",
                },
                {"evidence_id": "ev_unmapped", "source_title": "题录"},
            ],
        }
    ]

    writer.write()

    assert writer.volume.members["notes/note-1.md"].decode() == (
        "# 摘记\n\n已保存\n\n"
        "- [原件](../originals/example.pdf), PDF page 1\n  实际原文\n\n"
        "- Remote reference, block section-2\n  远程原文\n\n"
        "- 题录, block unmapped\n  "
    )


def test_writer_keeps_unfinished_job_summary_and_blank_note_in_packet(
    writer: Writer,
) -> None:
    writer.project["notes"] = [{"id": "note:one"}]
    writer.project["job"] = [
        {"job_id": "job_done", "state": "succeeded", "operation": "extract"},
        {
            "job_id": "job_pending",
            "state": "queued",
            "operation": "extract",
            "attempts": 2,
        },
    ]
    manifest = writer.write()
    assert manifest["unfinished_jobs"] == [
        {"job_id": "job_pending", "state": "queued", "operation": "extract"}
    ]
    assert writer.volume.members["notes/note-1.md"] == b"# Untitled note\n\n"
    assert manifest["coverage"]["legacy_history"] == "normalized_visible_messages"
    assert manifest["coverage"]["credentials"] == "excluded"


@pytest.mark.parametrize(
    ("budget", "message"),
    [
        ("entity", "entity metadata"),
        ("manifest", "manifest exceeds"),
        ("expanded", "size or entry limit"),
        ("entries", "size or entry limit"),
        ("archive", "ZIP exceeds"),
    ],
)
def test_writer_never_publishes_over_budget_archive(
    writer: Writer, budget: str, message: str
) -> None:
    if budget == "entity":
        writer.service.limits = replace(writer.service.limits, max_entity_bytes=1)
    elif budget == "manifest":
        writer.service.limits = replace(writer.service.limits, max_manifest_bytes=1)
    elif budget == "expanded":
        writer.service.max_bytes = 1
    elif budget == "entries":
        writer.service.max_entries = 1
    else:
        writer.service.limits = replace(writer.service.limits, max_archive_bytes=1)
    with pytest.raises(InvalidInputError, match=message):
        writer.write()

    assert TARGET not in writer.volume.data and PARTIAL not in writer.volume.data
    assert writer.volume.actions == (
        [("open", PARTIAL), ("close", PARTIAL), ("cleanup", PARTIAL)]
        if budget == "archive"
        else []
    )


@pytest.mark.parametrize("failure", ["manifest.json", "close"])
def test_writer_keeps_previous_export_when_packaging_fails(
    writer: Writer, failure: str
) -> None:
    writer.volume.data[TARGET] = b"existing saved archive"
    writer.volume.fault = failure
    with pytest.raises(OSError) as caught:
        writer.write()
    assert caught.value is writer.fault
    assert writer.volume.data[TARGET] == b"existing saved archive"
    assert PARTIAL not in writer.volume.data
    assert writer.volume.actions == [
        ("open", PARTIAL),
        ("close", PARTIAL),
        ("cleanup", PARTIAL),
    ]
