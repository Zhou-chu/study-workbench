"""Portable restore decoding policy with a virtual package and staging volume."""

import hashlib
import io
import json
from dataclasses import dataclass, field, replace
from pathlib import PurePosixPath
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest

from api import portable_service as subject
from open_notebook.exceptions import InvalidInputError

STAGE = PurePosixPath("/synthetic-stage")
ROOT = PurePosixPath("/synthetic-root")
ORIGINAL = "originals/lecture.txt"
BODY = "合成讲义".encode()


def artifact_descriptor(data: bytes) -> dict[str, int | str]:
    return {"byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


class Sink(io.BytesIO):
    def __init__(self, volume: dict[PurePosixPath, bytes], key: PurePosixPath):
        super().__init__()
        self.volume = volume
        self.key = key

    def close(self) -> None:
        if not self.closed:
            self.volume[self.key] = self.getvalue()
        super().close()


@dataclass(frozen=True)
class PathDouble:
    key: PurePosixPath
    staged: dict[PurePosixPath, bytes]

    def resolve(self) -> "PathDouble":
        assert self.key == ROOT
        return self

    def __truediv__(self, name: str) -> "PathDouble":
        return PathDouble(self.key / name, self.staged)

    @property
    def parent(self) -> "PathDouble":
        return PathDouble(self.key.parent, self.staged)

    def mkdir(self, *, parents: bool, exist_ok: bool) -> None:
        assert parents and exist_ok and self.key.is_relative_to(STAGE)

    def open(self, mode: str) -> io.BytesIO:
        assert mode == "xb" and self.key.is_relative_to(STAGE)
        assert self.key not in self.staged
        return Sink(self.staged, self.key)

    def read_bytes(self) -> bytes:
        return self.staged[self.key]


@dataclass(frozen=True)
class Entry:
    filename: str
    file_size: int
    external_attr: int = 0
    flag_bits: int = 0
    compress_type: int = subject.zipfile.ZIP_STORED

    @property
    def compress_size(self) -> int:
        return self.file_size

    def is_dir(self) -> bool:
        return False


@dataclass
class Package:
    entities: dict[str, bytes]
    manifest: dict[str, Any]
    staged: dict[PurePosixPath, bytes] = field(default_factory=dict)
    opened: list[str] = field(default_factory=list)
    closed: bool = False
    override_manifest: bytes | None = None
    member_failure: str | None = None

    def bytes_for(self, name: str) -> bytes:
        if name == "manifest.json":
            if self.override_manifest is not None:
                return self.override_manifest
            return json.dumps(self.manifest, ensure_ascii=False).encode()
        return self.entities[name]

    def getinfo(self, name: str) -> Entry:
        return Entry(name, len(self.bytes_for(name)))

    def infolist(self) -> list[Entry]:
        return [self.getinfo(name) for name in ("manifest.json", *self.entities)]

    def read(self, name: str) -> bytes:
        assert name == "manifest.json"
        return self.bytes_for(name)

    def open(self, name: str) -> io.BytesIO:
        self.opened.append(name)
        if name == self.member_failure:
            raise RuntimeError("Synthetic interrupted decoding")
        return io.BytesIO(self.bytes_for(name))

    def __enter__(self) -> "Package":
        return self

    def __exit__(self, *exc: object) -> None:
        self.closed = True

    def set_entity(self, name: str, data: bytes) -> None:
        self.entities[name] = data
        self.manifest["files"][name] = artifact_descriptor(data)


@dataclass
class Reader:
    service: subject.PortableService
    package: Package
    stream: io.BytesIO
    preflight: Mock
    open_package: Mock

    def read(self) -> tuple[dict, dict]:
        return self.service._read_archive(
            self.stream, PathDouble(STAGE, self.package.staged)
        )


@pytest.fixture
def reader(monkeypatch: pytest.MonkeyPatch) -> Reader:
    entities = {
        name: b"[]" if name.endswith(".json") else b""
        for name in subject.FILES.values()
    }
    entities["notebook.json"] = '{"id":"notebook:fixture","name":"资料"}'.encode()
    entities["notes.json"] = b'[{"id":"note:fixture","content":"saved"}]'
    entities["sources.json"] = b'[{"id":"source:fixture","title":"Lecture"}]'
    entities["versions.json"] = json.dumps(
        [
            {
                "source_version_id": "sv_fixture",
                "source_id": "source:fixture",
                "mime_type": "text/plain",
                "file_path": ORIGINAL,
                **artifact_descriptor(BODY),
            }
        ]
    ).encode()
    entities[ORIGINAL] = BODY
    counts = dict.fromkeys(subject.FILES, 0)
    counts.update(notebook=1, notes=1, sources=1, version=1)
    manifest = {
        "format_version": 2,
        "entity_counts": counts,
        "files": {name: artifact_descriptor(data) for name, data in entities.items()},
    }
    package = Package(entities, manifest)
    preflight = Mock()
    open_package = Mock(return_value=package)
    monkeypatch.setattr(subject, "validate_zip_directory", preflight)
    monkeypatch.setattr(
        subject,
        "zipfile",
        SimpleNamespace(
            ZipFile=open_package,
            BadZipFile=subject.zipfile.BadZipFile,
            ZIP_STORED=subject.zipfile.ZIP_STORED,
            ZIP_DEFLATED=subject.zipfile.ZIP_DEFLATED,
        ),
    )

    def virtual_path(path: PurePosixPath) -> PathDouble:
        assert path == ROOT
        return PathDouble(path, package.staged)

    monkeypatch.setattr(subject, "Path", virtual_path)
    service = subject.PortableService(
        store=object(), project_repository=object(), data_root=ROOT
    )
    return Reader(
        service,
        package,
        io.BytesIO(b"synthetic package receipt"),
        preflight,
        open_package,
    )


@pytest.mark.parametrize("version", [1, 2])
def test_restored_project_keeps_content_and_normalizes_legacy_note_revision(
    reader: Reader, version: int
) -> None:
    reader.package.manifest["format_version"] = version
    reader.stream.seek(8)

    project, manifest = reader.read()

    assert manifest == reader.package.manifest
    assert project["notebook"]["name"] == "资料"
    assert project["notes"] == [
        {"id": "note:fixture", "content": "saved", "revision": 1}
    ]
    assert project["version"][0]["file_path"] == ORIGINAL
    assert project["version"][0]["byte_size"] == len(BODY)
    assert project["evidence"] == [] and project["turn"] == []
    assert reader.package.staged[STAGE / ORIGINAL] == BODY
    assert set(reader.package.opened) == set(reader.package.entities)
    reader.preflight.assert_called_once_with(reader.stream, reader.service.max_entries)
    reader.open_package.assert_called_once_with(reader.stream)
    assert reader.stream.tell() == 0 and reader.package.closed


@pytest.mark.parametrize(
    ("fault", "message"),
    [
        ("bad-manifest-json", "Invalid portable manifest"),
        ("manifest-not-object", "Invalid portable manifest object"),
        ("unsupported-version", "Unsupported portable format version"),
        ("missing-inventory-entry", "Manifest file inventory does not match archive"),
        ("logical-count", "Manifest entity counts do not match archive"),
        ("stale-size", "File integrity size mismatch"),
        ("stale-hash", "File integrity hash mismatch"),
        ("entity-json", "Invalid portable entity JSON"),
        ("entity-jsonl", "Invalid portable entity JSON"),
        ("stale-version-descriptor", "Entity file integrity mismatch"),
        ("member-stream-error", "Archive file integrity verification failed"),
    ],
)
def test_restore_reports_failed_validation_instead_of_returning_partial_project(
    reader: Reader,
    fault: str,
    message: str,
) -> None:
    pack = reader.package
    if fault == "bad-manifest-json":
        pack.override_manifest = b'{"format_version":'
    elif fault == "manifest-not-object":
        pack.override_manifest = b"[]"
    elif fault == "unsupported-version":
        pack.manifest["format_version"] = 99
    elif fault == "missing-inventory-entry":
        del pack.manifest["files"][ORIGINAL]
    elif fault == "logical-count":
        pack.manifest["entity_counts"]["notes"] = 8
    elif fault == "stale-size":
        pack.manifest["files"][ORIGINAL]["byte_size"] = len(BODY) + 1
    elif fault == "stale-hash":
        pack.manifest["files"][ORIGINAL]["sha256"] = "0" * 64
    elif fault == "entity-json":
        pack.set_entity("notes.json", b"[")
    elif fault == "entity-jsonl":
        pack.set_entity("evidence.jsonl", b'{"pending":\n')
    elif fault == "stale-version-descriptor":
        versions = json.loads(pack.entities["versions.json"])
        versions[0]["byte_size"] += 1
        pack.set_entity("versions.json", json.dumps(versions).encode())
    elif fault == "member-stream-error":
        pack.member_failure = ORIGINAL

    with pytest.raises(InvalidInputError, match=message):
        reader.read()

    assert pack.closed
    if fault in {
        "bad-manifest-json",
        "manifest-not-object",
        "unsupported-version",
        "missing-inventory-entry",
    }:
        assert pack.staged == {} and pack.opened == []


@pytest.mark.parametrize(
    ("budget", "message"),
    [
        ("archive", "ZIP exceeds"),
        ("manifest", "manifest exceeds"),
        ("entity", "entity metadata exceeds"),
        ("expanded", "expanded size exceeds"),
    ],
)
def test_restore_enforces_configured_limits(
    reader: Reader, budget: str, message: str
) -> None:
    if budget == "archive":
        reader.service.limits = replace(reader.service.limits, max_archive_bytes=1)
    elif budget == "manifest":
        reader.service.limits = replace(reader.service.limits, max_manifest_bytes=1)
    elif budget == "entity":
        reader.service.limits = replace(reader.service.limits, max_entity_bytes=1)
    else:
        reader.service.max_bytes = 1

    with pytest.raises(InvalidInputError, match=message):
        reader.read()

    if budget == "archive":
        reader.preflight.assert_not_called()
        reader.open_package.assert_not_called()
    else:
        assert reader.package.closed
    assert not reader.package.opened and reader.package.staged == {}
