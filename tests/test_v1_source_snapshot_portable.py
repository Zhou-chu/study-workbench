import hashlib
import io

import pytest
from test_v1_portable_roundtrip import (  # noqa: F401
    MemoryProjects,
    MemoryStore,
)
from test_v1_portable_roundtrip import (
    populated as _populated,
)

from api.evidence_service import EvidenceService
from api.portable_service import PortableService
from open_notebook.exceptions import InvalidInputError

populated = _populated


async def add_derived(service, projects):
    body = b"Saved result not an independent confirmation"
    evidence = EvidenceService(store=service.store, data_root=service.root)
    version = await evidence.ingest(
        "notebook:original",
        "source:derived",
        "Derived",
        body,
        filename="derived.md",
        origin="derived_snapshot",
        provenance={
            "kind": "derived",
            "origin_kind": "note",
            "origin_id": "note:one",
            "note_revision": 1,
            "origin_title": "Derived",
            "authorship": "unknown",
            "captured_at": "2026-10-22T00:00:00Z",
            "content_sha256": hashlib.sha256(body).hexdigest(),
            "scope_snapshot": {"source_version_ids": ["sv_old"]},
            "citations": [],
        },
    )
    await evidence.extract(version["source_version_id"])
    projects.snapshot["sources"].append(
        {"id": "source:derived", "title": "Derived", "asset": None}
    )
    return version


@pytest.mark.asyncio
async def test_deleted_note_does_not_break_snapshot_roundtrip_and_reparse_keeps_derived(
    populated, tmp_path
):
    service, projects, _, _ = populated
    await add_derived(service, projects)
    projects.snapshot["notes"] = []
    await service.store.delete("note_snapshot", "note:one")
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    destination = tmp_path / "restored"
    importer = PortableService(
        store=store,
        project_repository=MemoryProjects(store=store),
        data_root=destination,
    )
    await importer.import_archive(io.BytesIO(exported["path"].read_bytes()))
    version = next(
        item
        for item in await store.list("version")
        if item.get("origin") == "derived_snapshot"
    )
    assert version["provenance"]["origin_id"] == "note:one"  # historical absent origin
    evidence = EvidenceService(store=store, data_root=destination)
    record = (await evidence.list_evidence(version["source_version_id"]))[0]
    citation = await evidence.validate_citation(
        {"evidence_id": record["evidence_id"]}, [version["source_version_id"]]
    )
    assert citation["kind"] == "derived_snapshot"
    assert citation["independent_support"] is False
    assert citation["reference_validity"] == "unverified"
    fresh = await evidence.extract(version["source_version_id"], force=True)
    fresh_record = await evidence.evidence(fresh["evidence_ids"][0])
    assert fresh_record["evidence_kind"] == "derived_snapshot"


@pytest.mark.asyncio
async def test_archive_rejects_missing_or_inconsistent_derived_provenance(populated):
    service, projects, _, _ = populated
    version = await add_derived(service, projects)
    version = await service.store.get("version", version["source_version_id"])
    for provenance in [
        None,
        {**version["provenance"], "content_sha256": "0" * 64},
        {**version["provenance"], "note_revision": None},
    ]:
        await service.store.put(
            "version",
            version["source_version_id"],
            {**version, "provenance": provenance},
        )
        with pytest.raises(InvalidInputError, match="provenance"):
            await service.export_project("notebook:original")


@pytest.mark.asyncio
async def test_web_archive_keeps_text_attribution_but_marks_removed_structured_url(
    populated, tmp_path
):
    service, projects, _, _ = populated
    evidence = EvidenceService(store=service.store, data_root=service.root)
    body = (
        b"Source: https://example.org/lesson\nRetrieved: 2026-10-22\n\nA web snapshot."
    )
    await evidence.ingest(
        "notebook:original",
        "source:web",
        "Web",
        body,
        filename="web.md",
        origin="web_snapshot",
        original_status="missing",
        provenance={
            "kind": "web",
            "source_url": "https://example.org/lesson",
            "retrieved_at": "2026-10-22T00:00:00Z",
            "provider": "firecrawl",
        },
    )
    projects.snapshot["sources"].append(
        {"id": "source:web", "title": "Web", "asset": None}
    )
    exported = await service.export_project("notebook:original")
    store = MemoryStore()
    root = tmp_path / "restored-web"
    await PortableService(
        store=store, project_repository=MemoryProjects(store=store), data_root=root
    ).import_archive(io.BytesIO(exported["path"].read_bytes()))
    version = next(
        item
        for item in await store.list("version")
        if item.get("origin") == "web_snapshot"
    )
    assert "source_url" not in version["provenance"]
    assert version["provenance"]["historical_url_omitted"] is True
    assert b"https://example.org/lesson" in (root / version["file_path"]).read_bytes()
    from open_notebook.domain.evidence import WebProvenance

    assert WebProvenance(**version["provenance"]).source_url is None
    with pytest.raises(InvalidInputError, match="requires the fetched source URL"):
        await evidence.ingest(
            "notebook:original",
            "source:bad",
            "Bad",
            body,
            filename="bad.md",
            origin="web_snapshot",
            provenance=version["provenance"],
        )
