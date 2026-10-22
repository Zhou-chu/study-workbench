import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from open_notebook.domain.evidence import SourceVersion
from open_notebook.graphs.grounded_chat import GroundedChatService


@pytest.mark.asyncio
async def test_derived_provenance_survives_reparse_and_model_payload(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    provenance = {
        "kind": "derived",
        "origin_kind": "turn",
        "origin_id": "turn_one",
        "authorship": "ai",
        "captured_at": "2026-10-22T00:00:00Z",
        "origin_title": "AI result",
        "content_sha256": "a" * 64,
        "scope_snapshot": {},
        "citations": [],
    }
    version = await service.ingest(
        "nb",
        "src",
        "Result",
        b"A derived claim.",
        filename="result.md",
        origin="derived_snapshot",
        provenance=provenance,
    )
    parsed_provenance = SourceVersion(**version).provenance
    assert parsed_provenance is not None
    assert parsed_provenance.kind == "derived"
    for _ in range(2):
        extraction = await service.extract(version["source_version_id"], force=True)
        record = await service.evidence(extraction["evidence_ids"][0])
        assert record["evidence_kind"] == "derived_snapshot"
        citation = await service.validate_citation(
            {"evidence_id": record["evidence_id"]}, [version["source_version_id"]]
        )
        assert citation["kind"] == "derived_snapshot"
        assert citation["independent_support"] is False
        hits = await service.retrieve("derived", [version["source_version_id"]])
        messages, _, _ = GroundedChatService._messages("Question", [], hits)
        assert '"evidence_kind": "derived_snapshot"' in messages[1]["content"]
        assert "not independent" in messages[0]["content"]


@pytest.mark.asyncio
async def test_web_snapshot_has_remote_text_semantics(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb",
        "src",
        "Web",
        b"A fetched page.",
        filename="page.md",
        origin="web_snapshot",
        original_status="missing",
        provenance={
            "kind": "web",
            "source_url": "https://example.org/page",
            "retrieved_at": "2026-10-22T00:00:00Z",
            "provider": "firecrawl",
        },
    )
    extraction = await service.extract(version["source_version_id"])
    record = await service.evidence(extraction["evidence_ids"][0])
    assert record["evidence_kind"] == "remote_text_snapshot"
    citation = await service.validate_citation(
        {"evidence_id": record["evidence_id"]}, [version["source_version_id"]]
    )
    assert citation["kind"] == "remote_text_snapshot"
    assert citation["provenance"]["provider"] == "firecrawl"


@pytest.mark.asyncio
async def test_deterministic_web_ingest_keeps_bytes_on_unknown_commit_and_reconciles(
    tmp_path,
):
    class LostAckStore(MemoryStore):
        failed = False

        async def put(self, kind, identity, value, create_only=False):
            result = await super().put(kind, identity, value, create_only)
            if kind == "version" and not self.failed:
                self.failed = True
                raise RuntimeError("lost acknowledgement")
            return result

    service = EvidenceService(store=LostAckStore(), data_root=tmp_path)
    kwargs = {
        "source_version_id": "sv_web_fixed",
        "preserve_on_error": True,
        "filename": "page.md",
        "origin": "web_snapshot",
        "original_status": "missing",
        "provenance": {
            "kind": "web",
            "source_url": "https://example.org/page",
            "retrieved_at": "2026-10-22T00:00:00Z",
            "provider": "firecrawl",
        },
    }
    with pytest.raises(RuntimeError, match="lost acknowledgement"):
        await service.ingest("nb", "src", "Web", b"Retained page", **kwargs)
    assert list(tmp_path.glob("originals/*/*.md"))
    restored = await service.ingest("nb", "src", "Web", b"Retained page", **kwargs)
    assert restored["source_version_id"] == "sv_web_fixed"
    from open_notebook.exceptions import InvalidInputError

    with pytest.raises(InvalidInputError, match="SNAPSHOT_CONFLICT"):
        await service.ingest("nb", "src", "Web", b"Changed page", **kwargs)


@pytest.mark.asyncio
async def test_web_snapshot_reparse_repairs_local_extraction_but_never_revalidates_html(
    tmp_path,
):
    from api.evidence_maintenance import EvidenceMaintenanceService
    from open_notebook.exceptions import InvalidInputError

    evidence = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await evidence.ingest(
        "nb",
        "src",
        "Web",
        b"Retained fetched page.",
        filename="web.md",
        origin="web_snapshot",
        original_status="missing",
        provenance={
            "kind": "web",
            "source_url": "https://example.org/",
            "retrieved_at": "2026-10-22T00:00:00Z",
            "provider": "firecrawl",
        },
    )

    async def enqueue(*_):
        return "command:local"

    maintenance = EvidenceMaintenanceService(evidence=evidence, submit=enqueue)
    job = await maintenance.submit(version["source_version_id"], "reparse", "repair")
    repaired = await maintenance.run(job["job_id"])
    assert repaired["state"] == "succeeded"
    fresh = await evidence.version(version["source_version_id"])
    assert fresh["original_status"] == "missing"
    record = (await evidence.list_evidence(version["source_version_id"]))[0]
    assert record["evidence_kind"] == "remote_text_snapshot"
    with pytest.raises(InvalidInputError, match="ORIGINAL_UNAVAILABLE"):
        await maintenance.submit(
            version["source_version_id"],
            "revalidate",
            "never",
            repaired["result"]["extraction_id"],
        )


def test_snapshot_publication_fsyncs_directory_and_fails_closed_on_unsupported_fs(
    tmp_path, monkeypatch
):
    import os
    import stat

    from api.evidence_service import publish_snapshot_bytes

    actual = os.fsync
    directories = []

    def track(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            directories.append(fd)
        actual(fd)

    monkeypatch.setattr(os, "fsync", track)
    publish_snapshot_bytes(tmp_path / "snapshot.md", b"durable")
    assert directories

    def unsupported(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            raise OSError("directory durability unavailable")
        actual(fd)

    monkeypatch.setattr(os, "fsync", unsupported)
    with pytest.raises(OSError, match="directory durability"):
        publish_snapshot_bytes(tmp_path / "unacknowledged.md", b"safe orphan")


@pytest.mark.parametrize("root_exists", [True, False])
def test_snapshot_durability_boundary_only_syncs_data_root_and_created_parents(
    tmp_path, monkeypatch, root_exists
):
    import os
    from pathlib import Path

    from api.evidence_service import publish_snapshot_bytes

    root = tmp_path / "data"
    if root_exists:
        root.mkdir()
    target = root / "originals" / "sv_test" / "original.md"
    actual = os.open
    directories = []

    def track(path, flags, *args, **kwargs):
        if flags & os.O_DIRECTORY:
            directories.append(Path(path))
        return actual(path, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", track)
    publish_snapshot_bytes(target, b"complete", durability_root=root)
    expected = {root, root / "originals", target.parent}
    if not root_exists:
        expected.add(tmp_path)
    assert set(directories) == expected


def test_evidence_record_limit_is_opt_in_and_never_truncates():
    from api.evidence_service import build_evidence_records, parse_text_bytes
    from open_notebook.exceptions import InvalidInputError

    version = {
        "origin": "derived_snapshot",
        "source_version_id": "sv_bounded",
        "notebook_id": "notebook:one",
        "source_title": "Small paragraphs",
    }
    blocks = parse_text_bytes("\n\n".join(["tiny"] * 1001).encode(), 1024 * 1024)[
        "blocks"
    ]
    assert len(build_evidence_records(version, "ex_bounded", blocks)) == 1001
    with pytest.raises(InvalidInputError, match="EVIDENCE_LIMIT"):
        build_evidence_records(version, "ex_bounded", blocks, max_records=1000)
