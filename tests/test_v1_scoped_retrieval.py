from pathlib import Path

import pytest
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from open_notebook.exceptions import InvalidInputError


@pytest.mark.asyncio
async def test_chinese_question_matches_labelled_solar_paragraph_only_in_scope(
    tmp_path,
):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    solar = await service.ingest(
        "nb",
        "src1",
        "太阳能",
        Path("tests/fixtures/v1/guide_zh.md").read_bytes(),
        filename="solar.md",
    )
    outside = await service.ingest(
        "nb",
        "src2",
        "排除资料",
        "阴天太阳能的秘密：范围外内容".encode(),
        filename="outside.txt",
    )
    await service.extract(solar["source_version_id"])
    await service.extract(outside["source_version_id"])
    hits = await service.retrieve(
        "阴天太阳能电池还能发电吗？", [solar["source_version_id"]]
    )
    assert hits
    assert "光伏效应" in hits[0]["quote"]
    assert all(h["source_version_id"] == solar["source_version_id"] for h in hits)
    assert all(h["retrieval_method"] == "lexical" and h["score"] > 0 for h in hits)
    assert await service.retrieve("xylophonequasar", [solar["source_version_id"]]) == []
    with pytest.raises(InvalidInputError, match="NO_SOURCES_SELECTED"):
        await service.retrieve("太阳能", [])


@pytest.mark.asyncio
async def test_unready_sources_rejected_instead_of_silently_omitted(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest("nb", "src", "pending", b"pending", filename="a.txt")
    with pytest.raises(InvalidInputError, match="SOURCE_NOT_READY"):
        await service.retrieve("pending", [version["source_version_id"]])


@pytest.mark.asyncio
async def test_citations_verify_identity_scope_quote_and_codepoint_offsets(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "src", "unicode", "🌞 前言。\n\n太阳能可发电。".encode(), filename="a.txt"
    )
    ex = await service.extract(version["source_version_id"])
    evidence = await service.evidence(ex["evidence_ids"][-1])
    valid = await service.validate_citation(
        {"evidence_id": evidence["evidence_id"], "quote": "太阳能"},
        [version["source_version_id"]],
    )
    assert valid["reference_validity"] == "verified"
    assert valid["quote"] == "太阳能"
    assert valid["locator"]["start_offset"] == 7
    assert valid["locator"]["end_offset"] == 10
    wrong = await service.validate_citation(
        {"evidence_id": evidence["evidence_id"], "quote": "不存在"},
        [version["source_version_id"]],
    )
    assert wrong["reference_validity"] == "invalid"
    out = await service.validate_citation(
        {"evidence_id": evidence["evidence_id"]}, ["sv_elsewhere"]
    )
    assert out["reference_validity"] == "out_of_scope"
    fake = await service.validate_citation(
        {"evidence_id": "ev_fabricated", "quote": "太阳能"},
        [version["source_version_id"]],
    )
    assert fake["reference_validity"] == "invalid"
    mismatched = await service.validate_citation(
        {"evidence_id": evidence["evidence_id"], "source_version_id": "wrong"},
        [version["source_version_id"]],
    )
    assert mismatched["reference_validity"] == "invalid"


@pytest.mark.asyncio
async def test_twenty_prelabelled_chinese_questions_find_expected_original_paragraph(
    tmp_path,
):
    import json

    gold = json.loads(Path("tests/fixtures/v1/retrieval_gold.json").read_text())
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    versions = {}
    for source in gold["sources"]:
        version = await service.ingest(
            "gold",
            source["key"],
            source["title"],
            source["text"].encode(),
            filename=source["key"] + ".txt",
        )
        await service.extract(version["source_version_id"])
        versions[source["key"]] = version["source_version_id"]
    assert len(gold["questions"]) == 20
    for question in gold["questions"]:
        hits = await service.retrieve(question["question"], list(versions.values()))
        assert hits, question["question"]
        assert hits[0]["source_version_id"] == versions[question["source_key"]], (
            question["question"]
        )
        assert question["expected"] in hits[0]["quote"], question["question"]


@pytest.mark.asyncio
async def test_malformed_model_citation_is_invalid_without_throwing(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    citation = await service.validate_citation(
        {"evidence_id": {"forged": True}, "quote": ["not text"]}, ["sv_valid"]
    )
    assert citation["reference_validity"] == "invalid"
    assert citation["evidence_id"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("marked_kind", ["evidence", "extraction", "both"])
async def test_restored_archive_provenance_stays_unverified_in_citations_and_search(
    tmp_path, marked_kind
):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb",
        "src",
        "Archived solar",
        "🌞 前言。\n\n太阳能可发电。".encode(),
        filename="archive.txt",
    )
    extraction = await service.extract(version["source_version_id"])
    record = await service.evidence(extraction["evidence_ids"][-1])
    for kind, value, key in [
        ("evidence", record, "evidence_id"),
        ("extraction", extraction, "extraction_id"),
    ]:
        if marked_kind in (kind, "both"):
            value["verification_origin"] = "restored_archive"
            await service.store.put(kind, value[key], value)
    citation = await service.validate_citation(
        {
            "evidence_id": record["evidence_id"],
            "quote": "太阳能",
            "reference_validity": "verified",
        },
        [version["source_version_id"]],
    )
    assert citation["reference_validity"] == "unverified"
    assert "archive" in citation["reason"].lower()
    assert citation["quote"] == "太阳能"
    assert citation["source_title"] == "Archived solar"
    assert citation["locator"]["start_offset"] == 7
    assert citation["locator"]["end_offset"] == 10
    hits = await service.retrieve("太阳能", [version["source_version_id"]])
    assert hits[0]["reference_validity"] == "unverified"
    assert hits[0]["quote"] == record["quote"]
    invalid = await service.validate_citation(
        {"evidence_id": record["evidence_id"], "quote": "不存在"},
        [version["source_version_id"]],
    )
    assert invalid["reference_validity"] == "invalid"


@pytest.mark.asyncio
async def test_fresh_reparse_verifies_new_evidence_without_upgrading_archived_history(
    tmp_path,
):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "src", "Archived solar", b"Solar electricity.", filename="archive.txt"
    )
    old = await service.extract(version["source_version_id"])
    old_record = await service.evidence(old["evidence_ids"][0])
    for kind, value, key in [
        ("evidence", old_record, "evidence_id"),
        ("extraction", old, "extraction_id"),
    ]:
        value["verification_origin"] = "restored_archive"
        await service.store.put(kind, value[key], value)
    fresh = await service.extract(version["source_version_id"], force=True)
    new_record = await service.evidence(fresh["evidence_ids"][0])
    assert fresh["extraction_id"] != old["extraction_id"]
    assert fresh.get("verification_origin") is None
    assert new_record.get("verification_origin") is None
    history = await service.validate_citation(
        {"evidence_id": old_record["evidence_id"]}, [version["source_version_id"]]
    )
    current = await service.validate_citation(
        {"evidence_id": new_record["evidence_id"]}, [version["source_version_id"]]
    )
    assert history["reference_validity"] == "unverified"
    assert current["reference_validity"] == "verified"
    hits = await service.retrieve("Solar", [version["source_version_id"]])
    assert hits[0]["reference_validity"] == "verified"
    assert hits[0]["evidence_id"] == new_record["evidence_id"]


@pytest.mark.asyncio
async def test_editing_imported_note_cannot_upgrade_archived_evidence(
    tmp_path, monkeypatch
):
    from api.personal_service import PersonalService

    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "src", "Archived solar", b"Solar electricity.", filename="archive.txt"
    )
    extraction = await service.extract(version["source_version_id"])
    extraction["verification_origin"] = "restored_archive"
    await service.store.put("extraction", extraction["extraction_id"], extraction)
    await service.store.put(
        "note_snapshot",
        "note:imported",
        {"notebook_id": "nb", "note_id": "note:imported"},
    )

    from open_notebook.database.note_repository import NoteWriteResult

    async def update(**kwargs):
        return NoteWriteResult(
            native={
                "id": "note:imported",
                "content": kwargs["fields"]["content"],
                "revision": 2,
            },
            snapshot=kwargs["snapshot"],
        )

    monkeypatch.setattr("open_notebook.database.note_repository.update_note", update)
    monkeypatch.setattr(
        "open_notebook.domain.notebook.Note.submit_embedding", lambda self: None
    )
    note = await PersonalService(store=service.store).save_note(
        "nb",
        {
            "content": "Edited restored note",
            "scope_snapshot": {"source_version_ids": [version["source_version_id"]]},
            "citations": [
                {
                    "citation_id": "c1",
                    "evidence_id": extraction["evidence_ids"][0],
                    "reference_validity": "verified",
                }
            ],
        },
        note_id="note:imported",
    )
    assert note["citations"][0]["reference_validity"] == "unverified"
    assert note["citations"][0]["quote"] == "Solar electricity."
    assert note["citations"][0]["locator"] is not None
