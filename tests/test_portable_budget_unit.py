"""Budget configuration and in-memory archive-verifier policy, no runtime launch."""

import hashlib
import importlib.util
import io
import json
import zipfile
from dataclasses import FrozenInstanceError
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.portable_limits import get_portable_limits

MAX_SAFE_BUDGET = 2**53 - 1 - 1024 * 1024
KEYS = [
    "STUDY_WORKBENCH_PORTABLE_MAX_BYTES",
    "STUDY_WORKBENCH_PORTABLE_MAX_ENTRIES",
    "STUDY_WORKBENCH_PORTABLE_MAX_RATIO",
]


@pytest.fixture(autouse=True)
def clean_budget(monkeypatch):
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.mark.parametrize("key", KEYS)
@pytest.mark.parametrize("value", ["0", "-1", str(MAX_SAFE_BUDGET + 1), "1.5", "false"])
def test_each_budget_rejects_out_of_contract_integer(monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(ValueError):
        get_portable_limits()


@pytest.mark.parametrize("budget", [1, MAX_SAFE_BUDGET])
def test_exact_budget_boundaries_keep_request_json_safe(monkeypatch, budget):
    monkeypatch.setenv(KEYS[0], str(budget))
    limits = get_portable_limits()
    assert limits.max_archive_bytes == limits.max_expanded_bytes == budget
    assert limits.max_request_bytes == budget + 1024 * 1024
    assert limits.max_request_bytes <= 2**53 - 1
    assert json.loads(json.dumps(limits.public())) == limits.public()


def test_public_values_are_complete_detached_and_configuration_is_not_cached(
    monkeypatch,
):
    original = get_portable_limits()
    expected = dict(
        max_archive_bytes=1024**3,
        max_expanded_bytes=1024**3,
        max_entity_bytes=32 * 1024**2,
        max_manifest_bytes=8 * 1024**2,
        multipart_overhead_bytes=1024**2,
        max_entries=10000,
        max_compression_ratio=200,
        max_request_bytes=1025 * 1024**2,
    )
    assert original.public() == expected
    detached = original.public()
    detached["max_entries"] = 1
    assert original.max_entries == 10000
    with pytest.raises(FrozenInstanceError):
        setattr(original, "max_entries", 1)
    for key, value in zip(KEYS, [7, 8, 9]):
        monkeypatch.setenv(key, str(value))
    new = get_portable_limits()
    assert (new.max_archive_bytes, new.max_entries, new.max_compression_ratio) == (
        7,
        8,
        9,
    )
    assert original.public() == expected


@pytest.fixture
def verifier(monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / "scripts/v1"))
    spec = importlib.util.spec_from_file_location(
        "portable_budget_review", root / "scripts/v1/portable_limits_check.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MemoryArchive(io.BytesIO):
    def stat(self):
        return SimpleNamespace(st_size=len(self.getvalue()))


def archive_case(mode="valid", compression=zipfile.ZIP_STORED):
    # Independent synthetic fixture, never production fixture() or user archive.
    payload = b"abc"
    digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    artifact = dict(file_path="artifacts/synthetic.bin", sha256=digest, byte_size=3)
    artifacts = [artifact]
    if mode == "artifact_hash":
        artifact["sha256"] = "incorrect"
    if mode == "artifact_size":
        artifact["byte_size"] = 4
    if mode == "artifact_path":
        artifact["file_path"] = "artifacts/missing.bin"
    if mode == "artifact_count":
        artifacts = []
    members = {
        "artifacts/synthetic.bin": payload,
        "artifacts.json": json.dumps(artifacts).encode(),
    }
    member_specs = {
        name: {"sha256": hashlib.sha256(value).hexdigest(), "byte_size": len(value)}
        for name, value in members.items()
    }
    manifest = {"format_version": 1, "files": member_specs}
    if mode == "version":
        manifest["format_version"] = 2
    if mode == "member_hash":
        member_specs["artifacts/synthetic.bin"]["sha256"] = "incorrect"
    if mode == "member_size":
        member_specs["artifacts/synthetic.bin"]["byte_size"] = 4
    if mode == "unlisted":
        members["unlisted.txt"] = b"not declared"
    if mode == "missing":
        members.pop("artifacts/synthetic.bin")
    members["manifest.json"] = json.dumps(manifest).encode()
    stream = MemoryArchive()
    with zipfile.ZipFile(stream, "w", compression=compression) as z:
        for name, content in members.items():
            z.writestr(name, content)
    stream.seek(0)
    return stream, digest, sum(map(len, members.values()))


@pytest.mark.parametrize(
    "compression,stored", [(zipfile.ZIP_STORED, True), (zipfile.ZIP_DEFLATED, False)]
)
def test_verifier_reads_real_archive_bytes_and_reports_compression(
    verifier, monkeypatch, compression, stored
):
    stream, digest, expanded = archive_case(compression=compression)
    calls = []

    # file_hash is physical-path I/O; real member hashing remains unpatched.
    def physical_hash(path):
        assert path is stream
        calls.append(path)
        return "synthetic-outer-hash"

    monkeypatch.setattr(verifier, "file_hash", physical_hash)
    result = verifier.verify_archive(stream, digest, 3)
    assert result == dict(
        archive_bytes=len(stream.getvalue()),
        archive_sha256="synthetic-outer-hash",
        manifest_members_verified=2,
        expanded_bytes=expanded,
        all_members_stored=stored,
    )
    assert calls == [stream]


@pytest.mark.parametrize(
    "mode,exception",
    [
        ("version", AssertionError),
        ("member_hash", AssertionError),
        ("member_size", AssertionError),
        ("unlisted", AssertionError),
        ("missing", AssertionError),
        ("artifact_hash", AssertionError),
        ("artifact_size", AssertionError),
        ("artifact_count", AssertionError),
        ("artifact_path", KeyError),
    ],
)
def test_verifier_rejects_corrupt_manifest_or_artifact_before_outer_hash(
    verifier, monkeypatch, mode, exception
):
    stream, digest, _ = archive_case(mode)

    def forbidden(path):
        pytest.fail("invalid archive must not reach success report")

    monkeypatch.setattr(verifier, "file_hash", forbidden)
    with pytest.raises(exception):
        verifier.verify_archive(stream, digest, 3)
