import io

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from test_v1_evidence_ingest import MemoryStore

from api.evidence_service import EvidenceService
from open_notebook.exceptions import InvalidInputError


def pdf_bytes(texts):
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }
            )
            page[NameObject("/Resources")] = DictionaryObject(
                {
                    NameObject("/Font"): DictionaryObject(
                        {NameObject("/F1"): writer._add_object(font)}
                    )
                }
            )
            stream = DecodedStreamObject()
            stream.set_data(f"BT /F1 12 Tf 20 700 Td ({text}) Tj ET".encode())
            page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


@pytest.mark.asyncio
async def test_physical_pages_identical_phrase_and_scanned_page(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    versions = []
    for i, texts in enumerate(
        (["Repeated phrase", "Second page", ""], ["Other first", "Repeated phrase"])
    ):
        version = await service.ingest(
            "nb", f"src{i}", f"document{i}", pdf_bytes(texts), filename="doc.pdf"
        )
        versions.append(version)
    first = await service.extract(versions[0]["source_version_id"])
    assert first["status"] == "partial"
    assert first["page_count"] == 3
    assert "page 3" in first["warnings"][0]
    await service.extract(versions[1]["source_version_id"])
    one = (
        await service.retrieve("Repeated phrase", [versions[0]["source_version_id"]])
    )[0]
    two = (
        await service.retrieve("Repeated phrase", [versions[1]["source_version_id"]])
    )[0]
    assert one["locator"]["page_index"] == 0
    assert two["locator"]["page_index"] == 1
    assert one["evidence_id"] != two["evidence_id"]


@pytest.mark.asyncio
async def test_scanned_pdf_needs_ocr_and_malformed_pdf_records_failure(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    scan = await service.ingest(
        "nb", "scan", "scan", pdf_bytes([""]), filename="scan.pdf"
    )
    assert (await service.extract(scan["source_version_id"]))["status"] == "needs_ocr"
    bad = await service.ingest(
        "nb", "bad", "bad", b"%PDF broken", filename="broken.pdf"
    )
    with pytest.raises(InvalidInputError, match="EXTRACTION_FAILED"):
        await service.extract(bad["source_version_id"])
    assert (await service.version(bad["source_version_id"]))["status"] == "failed"


@pytest.mark.asyncio
async def test_page_limit_and_cpu_timeout_are_enforced(tmp_path, monkeypatch):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    version = await service.ingest(
        "nb", "src", "pages", pdf_bytes(["one", "two"]), filename="pages.pdf"
    )
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_PDF_PAGES", "1")
    with pytest.raises(InvalidInputError, match="PAGE_LIMIT"):
        await service.extract(version["source_version_id"])
    monkeypatch.setenv("STUDY_WORKBENCH_EXTRACT_TIMEOUT_SECONDS", "0.000001")
    with pytest.raises(InvalidInputError, match="EXTRACTION_TIMEOUT"):
        await service.extract(version["source_version_id"], force=True)


@pytest.mark.asyncio
async def test_ten_prelabelled_physical_page_locators_and_quotes(tmp_path):
    service = EvidenceService(store=MemoryStore(), data_root=tmp_path)
    expected = [
        "Albedo means reflectivity",
        "Biomass stores chemical energy",
        "Capacitance stores electric charge",
        "Dynamo converts mechanical energy",
        "Entropy measures thermodynamic dispersal",
        "Friction opposes relative motion",
        "Gravity attracts massive bodies",
        "Hydrogen has one proton",
        "Inductance opposes current changes",
        "Joule is a unit of energy",
    ]
    version = await service.ingest(
        "nb", "physical", "Physics pages", pdf_bytes(expected), filename="physics.pdf"
    )
    extraction = await service.extract(version["source_version_id"])
    assert extraction["page_count"] == 10
    for page_index, phrase in enumerate(expected):
        hit = (
            await service.retrieve(phrase.split()[0], [version["source_version_id"]])
        )[0]
        citation = await service.validate_citation(
            {"evidence_id": hit["evidence_id"], "quote": phrase},
            [version["source_version_id"]],
        )
        assert citation["reference_validity"] == "verified"
        assert citation["locator"]["page_index"] == page_index
        block = extraction["blocks"][page_index]
        assert (
            block["text"][
                citation["locator"]["start_offset"] : citation["locator"]["end_offset"]
            ]
            == phrase
        )
