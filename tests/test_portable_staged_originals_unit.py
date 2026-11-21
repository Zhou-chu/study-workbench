"""Portable snapshot file projection on an in-memory path and stream boundary."""

from __future__ import annotations

import hashlib
import io
import sys
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from types import ModuleType, SimpleNamespace

import pytest

from api import portable_service as subject
from open_notebook.exceptions import InvalidInputError

ROOT = PurePosixPath("/synthetic-project")
UPLOADS = PurePosixPath("/synthetic-uploads")
STAGE = PurePosixPath("/synthetic-stage")
BODY = b"synthetic document"
DIGEST = hashlib.sha256(BODY).hexdigest()


@dataclass
class Volume:
    files: dict[PurePosixPath, bytes] = field(default_factory=dict)
    copies: list[tuple[PurePosixPath, PurePosixPath]] = field(default_factory=list)
    unlinked: list[PurePosixPath] = field(default_factory=list)
    changed: PurePosixPath | None = None
    stat_calls: dict[PurePosixPath, int] = field(default_factory=dict)


class Sink(io.BytesIO):
    def __init__(self, files: dict[PurePosixPath, bytes], key: PurePosixPath):
        super().__init__()
        self.files = files
        self.key = key

    def close(self) -> None:
        if not self.closed:
            self.files[self.key] = self.getvalue()
        super().close()


@dataclass(frozen=True)
class VirtualPath:
    volume: Volume
    key: PurePosixPath

    def __truediv__(self, name: str | "VirtualPath") -> "VirtualPath":
        key = name.key if isinstance(name, VirtualPath) else name
        return VirtualPath(self.volume, self.key / key)

    @property
    def parent(self) -> "VirtualPath":
        return VirtualPath(self.volume, self.key.parent)

    @property
    def suffix(self) -> str:
        return self.key.suffix

    def is_absolute(self) -> bool:
        return self.key.is_absolute()

    def is_relative_to(self, other: "VirtualPath") -> bool:
        return self.key.is_relative_to(other.key)

    def relative_to(self, other: "VirtualPath") -> PurePosixPath:
        return self.key.relative_to(other.key)

    def is_symlink(self) -> bool:
        return False

    def exists(self) -> bool:
        return self.key in self.volume.files

    def is_file(self) -> bool:
        return self.exists()

    def resolve(self) -> "VirtualPath":
        assert self.key.is_absolute()
        return self

    def mkdir(self, *, parents: bool = False, exist_ok: bool = False) -> None:
        assert self.key.is_relative_to(STAGE)
        assert parents and exist_ok

    def stat(self) -> SimpleNamespace:
        calls = self.volume.stat_calls.get(self.key, 0) + 1
        self.volume.stat_calls[self.key] = calls
        return SimpleNamespace(
            st_size=len(self.volume.files[self.key]),
            st_ino=1,
            st_mtime_ns=int(self.volume.changed == self.key and calls >= 3),
        )

    def open(self, mode: str) -> io.BytesIO:
        if mode == "rb":
            return io.BytesIO(self.volume.files[self.key])
        assert mode == "xb" and self.key.is_relative_to(STAGE) and not self.exists()
        return Sink(self.volume.files, self.key)

    def replace(self, other: "VirtualPath") -> None:
        assert self.key.is_relative_to(STAGE) and other.key.is_relative_to(STAGE)
        self.volume.files[other.key] = self.volume.files.pop(self.key)
        self.volume.copies.append((self.key, other.key))

    def unlink(self) -> None:
        assert self.key.is_relative_to(STAGE)
        self.volume.unlinked.append(self.key)
        del self.volume.files[self.key]


Staging = tuple[subject.PortableService, Volume, VirtualPath]


@pytest.fixture
def staging(
    monkeypatch: pytest.MonkeyPatch,
) -> Staging:
    volume = Volume()
    config = ModuleType("open_notebook.config")
    config.__dict__["UPLOADS_FOLDER"] = str(UPLOADS)
    monkeypatch.setitem(sys.modules, "open_notebook.config", config)

    def path(key: str | PurePosixPath | VirtualPath) -> VirtualPath:
        return (
            key
            if isinstance(key, VirtualPath)
            else VirtualPath(volume, PurePosixPath(key))
        )

    monkeypatch.setattr(subject, "Path", path)
    service = subject.PortableService(
        store=object(), project_repository=object(), data_root=ROOT
    )
    return service, volume, path(STAGE)


def project() -> dict[str, object]:
    return {
        "notebook": {"id": "notebook:fixture"},
        "sources": [],
        "version": [],
        "artifact": [],
    }


def version(file_path: str) -> dict[str, object]:
    return {
        "source_version_id": "sv_fixture",
        "source_id": "source:fixture",
        "original_status": "available",
        "file_path": file_path,
        "byte_size": len(BODY),
        "sha256": DIGEST,
    }


@pytest.mark.parametrize(
    ("name", "directory", "suffix", "mime"),
    [
        ("page.PDF", ROOT, ".pdf", "application/pdf"),
        ("source.txt", UPLOADS, ".txt", "text/plain"),
        ("notes.md", ROOT, ".md", "text/markdown"),
        ("image.png", UPLOADS, ".png", "application/octet-stream"),
        ("unknown.longextension", ROOT, ".bin", "application/octet-stream"),
    ],
)
def test_legacy_original_is_staged_and_given_a_version(
    staging: Staging,
    name: str,
    directory: PurePosixPath,
    suffix: str,
    mime: str,
) -> None:
    service, volume, stage = staging
    location = directory / name
    old_path = str(location) if directory == UPLOADS else name
    volume.files[location] = BODY
    asset = {"file_path": old_path}
    source = {
        "id": "source:fixture",
        "asset": asset,
        "created": "2026-05-20T00:00:00Z",
        "title": "资料",
    }
    versions: list[dict[str, object]] = []
    doc = {**project(), "sources": [source], "version": versions}
    files, missing = service._stage_files(doc, stage)

    target = "originals/" + DIGEST + suffix
    assert files == {target: {"byte_size": len(BODY), "sha256": DIGEST}}
    assert missing == []
    (record,) = versions
    assert record["source_id"] == "source:fixture"
    assert record["notebook_id"] == "notebook:fixture"
    assert record["source_title"] == "资料"
    assert record["mime_type"] == mime and record["status"] == "not_extracted"
    assert record["created_at"] == "2026-05-20T00:00:00Z"
    assert record["file_path"] == asset["file_path"] == target
    assert volume.files[STAGE / target] == volume.files[location] == BODY


def test_version_and_legacy_duplicate_share_one_staged_file_and_normalize_nested_references(
    staging: Staging,
):
    service, volume, stage = staging
    volume.files[ROOT / "originals/page.PDF"] = BODY
    old = "originals/page.PDF"
    original = version(old)
    asset = {"file_path": old}
    source = {"id": "source:fixture", "asset": asset, "full_text": old}
    versions = [original]
    artifact_reference = {"nested": [{"file_path": old, "prose": old}]}
    doc = {
        **project(),
        "sources": [source],
        "version": versions,
        "note_snapshot": [artifact_reference],
    }
    files, missing = service._stage_files(doc, stage)

    target = "originals/" + DIGEST + ".pdf"
    assert list(files) == [target] and missing == []
    assert len(versions) == 1
    assert original["file_path"] == asset["file_path"] == target
    assert artifact_reference == {"nested": [{"file_path": target, "prose": old}]}
    assert source["full_text"] == old
    assert len(volume.copies) == len(volume.unlinked) == 1
    assert volume.files[STAGE / target] == BODY


def test_artifact_is_staged_separately_from_identical_original(
    staging: Staging,
) -> None:
    service, volume, stage = staging
    volume.files.update(
        {ROOT / "originals/a.txt": BODY, ROOT / "artifacts/b.txt": BODY}
    )
    artifact = {
        "artifact_id": "artifact:fixture",
        "file_path": "artifacts/b.txt",
        "byte_size": len(BODY),
        "sha256": DIGEST,
    }
    files, missing = service._stage_files(
        {**project(), "version": [version("originals/a.txt")], "artifact": [artifact]},
        stage,
    )
    assert set(files) == {f"originals/{DIGEST}.txt", f"artifacts/{DIGEST}.txt"}
    assert artifact["file_path"] == f"artifacts/{DIGEST}.txt"
    assert missing == [] and len(volume.copies) == 2


@pytest.mark.parametrize("status", ["missing", "retired", None])
def test_metadata_only_source_preserves_text_and_reports_missing_original(
    staging: Staging, status
):
    service, volume, stage = staging
    source = {"id": "source:fixture", "full_text": "已保留正文"}
    row = {"source_version_id": "sv_fixture", "source_id": "source:fixture"}
    if status is not None:
        row["original_status"] = status
    doc = {**project(), "sources": [source], "version": [row]}
    assert service._stage_files(doc, stage) == (
        {},
        [{"source_version_id": "sv_fixture", "reason": status or "missing"}],
    )
    assert source["full_text"] == "已保留正文" and not volume.copies


def test_legacy_text_without_a_local_file_is_not_omitted(staging: Staging) -> None:
    service, volume, stage = staging
    source = {
        "id": "source:fixture",
        "full_text": "已保留正文",
        "asset": {"url": "https://example.org"},
    }
    doc = {**project(), "sources": [source]}
    files, missing = service._stage_files(doc, stage)
    assert files == {} and missing == [
        {
            "source_id": "source:fixture",
            "reason": "No locally available original; source text/metadata preserved",
        }
    ]
    assert source["full_text"] == "已保留正文" and not volume.copies


@pytest.mark.parametrize(
    ("fault", "detail"),
    [
        ("size", "integrity verification"),
        ("hash", "integrity verification"),
        ("changed", "changed during snapshot"),
        ("missing", "Referenced original or artifact file is missing"),
        ("budget", "exceeds the size limit"),
    ],
)
def test_bad_original_never_publishes_a_staged_file(
    staging: Staging, fault: str, detail: str
) -> None:
    service, volume, stage = staging
    path = ROOT / "originals/doc.txt"
    volume.files[path] = BODY
    record = version("originals/doc.txt")
    if fault == "size":
        record["byte_size"] = len(BODY) + 1
    elif fault == "hash":
        record["sha256"] = "0" * 64
    elif fault == "changed":
        volume.changed = path
    elif fault == "missing":
        del volume.files[path]
    else:
        service.max_bytes = len(BODY) - 1
    with pytest.raises(InvalidInputError, match=detail):
        service._stage_files({**project(), "version": [record]}, stage)
    assert not volume.copies
    assert record["file_path"] == "originals/doc.txt"


def test_saved_artifact_cannot_silently_drop_its_binary_reference(
    staging: Staging,
) -> None:
    service, volume, stage = staging
    with pytest.raises(
        InvalidInputError, match="artifact is missing its file reference"
    ):
        service._stage_files(
            {**project(), "artifact": [{"artifact_id": "artifact:fixture"}]}, stage
        )
    assert not volume.copies
