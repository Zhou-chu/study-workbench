"""CPU-only original and evidence integrity, using real parser inputs."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path

import pytest

from api.evidence_service import EvidenceService
from open_notebook.exceptions import InvalidInputError, NotFoundError


class MemoryStore:
    def __init__(self):
        self.data = {}
        self.locks = {}

    async def get(self, kind, id):
        return deepcopy(self.data.get((kind, id)))

    async def list(self, kind, notebook_id=None, **filters):
        return [
            deepcopy(value)
            for (table, _), value in self.data.items()
            if table == kind
            and (notebook_id is None or value.get("notebook_id") == notebook_id)
            and all(value.get(key) == val for key, val in filters.items())
        ]

    async def put(self, kind, id, value, create_only=False):
        if create_only and (kind, id) in self.data:
            raise InvalidInputError("record exists")
        self.data[(kind, id)] = deepcopy(value)
        return deepcopy(value)

    async def delete(self, kind, id):
        self.data.pop((kind, id), None)

    @asynccontextmanager
    async def project_lock(self, notebook_id):
        async with self.locks.setdefault(notebook_id, asyncio.Lock()):
            yield


@pytest.fixture
def evidence_service(tmp_path):
    return EvidenceService(store=MemoryStore(), data_root=tmp_path)


@pytest.mark.asyncio
async def test_original_bytes_and_unicode_offsets_survive_reparse(evidence_service):
    data = Path("tests/fixtures/v1/guide_zh.md").read_bytes()
    version = await evidence_service.ingest(
        "notebook:one", "source:one", "太阳能", data, filename="guide.md"
    )
    assert version["source_version_id"].startswith("sv_")
    assert (
        await evidence_service.resolve_file(version["source_version_id"])
    ).read_bytes() == data
    first = await evidence_service.extract(version["source_version_id"])
    assert first["status"] == "ready"
    record = await evidence_service.evidence(first["evidence_ids"][-1])
    block = next(
        b for b in first["blocks"] if b["block_id"] == record["locator"]["block_id"]
    )
    assert (
        block["text"][
            record["locator"]["start_offset"] : record["locator"]["end_offset"]
        ]
        == record["quote"]
    )
    assert record["locator"]["page_index"] is None
    second = await evidence_service.extract(version["source_version_id"], force=True)
    assert second["extraction_id"] != first["extraction_id"]
    assert await evidence_service.evidence(record["evidence_id"]) == record
    assert (await evidence_service.extract(version["source_version_id"]))[
        "extraction_id"
    ] == second["extraction_id"]
    assert len(await evidence_service.versions("source:one")) == 1


@pytest.mark.asyncio
async def test_changed_source_has_new_immutable_version(evidence_service):
    one = await evidence_service.ingest(
        "nb", "src", "notes", b"first", filename="notes.txt"
    )
    two = await evidence_service.ingest(
        "nb", "src", "notes", b"second", filename="notes.txt"
    )
    assert one["source_version_id"] != two["source_version_id"]
    assert one["sha256"] != two["sha256"]
    assert (
        await evidence_service.resolve_file(one["source_version_id"])
    ).read_bytes() == b"first"


@pytest.mark.asyncio
async def test_rejects_bad_utf8_size_and_unsupported_type(
    evidence_service, monkeypatch
):
    with pytest.raises(InvalidInputError, match="UTF-8"):
        await evidence_service.ingest(
            "nb", "src", "bad", b"\xff\xfe", filename="bad.txt"
        )
    with pytest.raises(InvalidInputError, match="supported"):
        await evidence_service.ingest("nb", "src", "bad", b"x", filename="bad.exe")
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_FILE_MB", "0.000001")
    with pytest.raises(InvalidInputError, match="size"):
        await evidence_service.ingest("nb", "src", "big", b"a" * 20, filename="big.txt")


@pytest.mark.asyncio
async def test_detects_original_tampering_and_path_escape(evidence_service, tmp_path):
    version = await evidence_service.ingest(
        "nb", "src", "safe", b"original", filename="../../safe.txt"
    )
    path = await evidence_service.resolve_file(version["source_version_id"])
    assert path.is_relative_to(tmp_path)
    path.write_bytes(b"tampered")
    with pytest.raises(InvalidInputError, match="integrity"):
        await evidence_service.resolve_file(version["source_version_id"])
    version["file_path"] = "../outside"
    await evidence_service.store.put("version", version["source_version_id"], version)
    with pytest.raises(InvalidInputError, match="path"):
        await evidence_service.resolve_file(version["source_version_id"])
    with pytest.raises(NotFoundError):
        await evidence_service.evidence("missing")


@pytest.mark.asyncio
async def test_separate_service_workers_do_not_duplicate_default_extraction(tmp_path):
    store = MemoryStore()
    first_service = EvidenceService(store=store, data_root=tmp_path)
    second_service = EvidenceService(store=store, data_root=tmp_path)
    version = await first_service.ingest(
        "nb", "src", "shared", b"Shared original", filename="a.txt"
    )
    one, two = await asyncio.gather(
        first_service.extract(version["source_version_id"]),
        second_service.extract(version["source_version_id"]),
    )
    assert one["extraction_id"] == two["extraction_id"]
    assert len(await store.list("extraction")) == 1
    assert len(await store.list("evidence")) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ending", ["\n", "\r\n", "\n\n", "\r\n\r\n", " \t\n", " \t\r\n"]
)
async def test_trailing_line_endings_keep_last_paragraph_and_exact_offsets(
    evidence_service, ending
):
    text = "真实原件与历史引用。" + ending
    version = await evidence_service.ingest(
        "nb",
        "source:trailing",
        "Trailing newline",
        text.encode(),
        filename="trailing.txt",
    )
    extraction = await evidence_service.extract(version["source_version_id"])
    assert extraction["status"] == "ready"
    assert len(extraction["evidence_ids"]) == 1
    record = await evidence_service.evidence(extraction["evidence_ids"][0])
    assert record["quote"] == "真实原件与历史引用。"
    assert record["locator"]["start_offset"] == 0
    assert record["locator"]["end_offset"] == len("真实原件与历史引用。")
    assert extraction["blocks"][0]["text"] == text
    assert (
        text[record["locator"]["start_offset"] : record["locator"]["end_offset"]]
        == record["quote"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("newline", ["\n", "\r\n"])
async def test_paragraph_boundaries_trim_outer_whitespace_without_normalizing_offsets(
    evidence_service, newline
):
    first = "🌞 首段内容。" + newline + "同段第二行。"
    last = "末段历史引用。"
    text = (
        " \t" + first + "  " + newline + " \t" + newline + " " + last + " \t" + newline
    )
    version = await evidence_service.ingest(
        "nb", "source:paragraphs", "Paragraphs", text.encode(), filename="paragraphs.md"
    )
    extraction = await evidence_service.extract(version["source_version_id"])
    records = [
        await evidence_service.evidence(identity)
        for identity in extraction["evidence_ids"]
    ]
    assert [record["quote"] for record in records] == [first, last]
    for record, expected in zip(records, [first, last]):
        locator = record["locator"]
        assert locator["start_offset"] == text.index(expected)
        assert locator["end_offset"] == text.index(expected) + len(expected)
        assert text[locator["start_offset"] : locator["end_offset"]] == expected
