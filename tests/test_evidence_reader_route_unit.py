"""Reader selector and response decisions, with independent evidence services replaced.

No ASGI dispatch, file response sending, persistence or citation validation engine.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, call

import pytest

from api.routers import evidence as routes
from open_notebook.exceptions import InvalidInputError, NotFoundError

pytestmark = pytest.mark.asyncio
VERSION = "sv_selected"


@pytest.fixture
def reader(monkeypatch: pytest.MonkeyPatch):
    current = {"extraction_id": "ex_current", "source_version_id": VERSION}
    historic = {"extraction_id": "ex_old", "source_version_id": VERSION}
    row = {
        "evidence_id": "ev_old",
        "source_version_id": VERSION,
        "extraction_id": "ex_old",
        "quote": "历史原文",
    }
    store = object()
    service = SimpleNamespace(
        store=store,
        version=AsyncMock(
            return_value={
                "source_version_id": VERSION,
                "source_title": "资料",
                "extraction": current,
            }
        ),
        evidence=AsyncMock(return_value=row),
        list_evidence=AsyncMock(return_value=[dict(row)]),
        validate_citation=AsyncMock(return_value={"reference_validity": "verified"}),
        resolve_file=AsyncMock(return_value="/synthetic-original.pdf"),
        versions=AsyncMock(return_value=[{"source_version_id": VERSION}]),
    )
    reads = SimpleNamespace(get=AsyncMock(return_value=historic))
    factory = Mock(return_value=service)
    context = Mock(return_value=reads)
    monkeypatch.setattr(routes, "EvidenceService", factory)
    monkeypatch.setattr(routes, "EvidenceReadContext", context)
    return SimpleNamespace(
        service=service,
        reads=reads,
        context=context,
        current=current,
        historic=historic,
        row=row,
    )


@pytest.mark.parametrize("selector", ["current", "extraction", "evidence", "both"])
async def test_reader_uses_exact_selector_and_projects_citation_verdict(
    reader, selector
):
    evidence_id = "ev_old" if selector in ("evidence", "both") else None
    extraction_id = "ex_old" if selector in ("extraction", "both") else None
    result = await routes.version(VERSION, evidence_id, extraction_id)
    selected = None if selector == "current" else "ex_old"
    assert result == {
        "version": {"source_version_id": VERSION, "source_title": "资料"},
        "extraction": reader.current if selected is None else reader.historic,
        "evidence": [
            {**reader.row, "reference_validity": "verified", "reference_reason": None}
        ],
    }
    reader.context.assert_called_once_with(reader.service.store)
    reader.service.version.assert_awaited_once_with(VERSION, _reads=reader.reads)
    reader.service.list_evidence.assert_awaited_once_with(
        VERSION, extraction_id=selected, _reads=reader.reads
    )
    reader.service.validate_citation.assert_awaited_once_with(
        {"evidence_id": "ev_old"}, [VERSION], _reads=reader.reads
    )
    if selected:
        reader.reads.get.assert_awaited_once_with("extraction", "ex_old")
    else:
        reader.reads.get.assert_not_awaited()
    if evidence_id:
        reader.service.evidence.assert_awaited_once_with(
            evidence_id, _reads=reader.reads
        )
    else:
        reader.service.evidence.assert_not_awaited()


@pytest.mark.parametrize(
    "fault,code",
    [
        ("evidence-version", "EVIDENCE_VERSION_MISMATCH"),
        ("evidence-extraction", "EVIDENCE_EXTRACTION_MISMATCH"),
        ("missing-extraction", "EXTRACTION_VERSION_MISMATCH"),
        ("extraction-version", "EXTRACTION_VERSION_MISMATCH"),
    ],
)
async def test_reader_rejects_cross_identity_before_listing(reader, fault, code):
    if fault == "evidence-version":
        reader.service.evidence.return_value = {
            **reader.row,
            "source_version_id": "sv_other",
        }
    elif fault == "evidence-extraction":
        reader.service.evidence.return_value = {
            **reader.row,
            "extraction_id": "ex_other",
        }
    elif fault == "missing-extraction":
        reader.reads.get.return_value = None
    else:
        reader.reads.get.return_value = {
            **reader.historic,
            "source_version_id": "sv_other",
        }
    with pytest.raises(InvalidInputError, match=code):
        await routes.version(VERSION, "ev_old", "ex_old")
    reader.service.list_evidence.assert_not_awaited()
    reader.service.validate_citation.assert_not_awaited()
    if fault.startswith("evidence-"):
        reader.reads.get.assert_not_awaited()


async def test_reader_preserves_each_record_verdict_and_reason(reader):
    reader.service.list_evidence.return_value = [
        reader.row.copy(),
        {**reader.row, "evidence_id": "ev_other"},
    ]
    reader.service.validate_citation.side_effect = [
        {"reference_validity": "unverified", "reason": "HISTORICAL"},
        {"reference_validity": "invalid", "reason": "CHANGED"},
    ]
    result = await routes.version(VERSION)
    assert [
        (r["evidence_id"], r["quote"], r["reference_validity"], r["reference_reason"])
        for r in result["evidence"]
    ] == [
        ("ev_old", "历史原文", "unverified", "HISTORICAL"),
        ("ev_other", "历史原文", "invalid", "CHANGED"),
    ]
    assert reader.service.validate_citation.await_args_list == [
        call({"evidence_id": identity}, [VERSION], _reads=reader.reads)
        for identity in ("ev_old", "ev_other")
    ]


async def test_empty_reader_has_no_spurious_citation_checks(reader):
    reader.service.version.return_value = {"source_version_id": VERSION}
    reader.service.list_evidence.return_value = []
    assert await routes.version(VERSION) == {
        "version": {"source_version_id": VERSION},
        "extraction": None,
        "evidence": [],
    }
    reader.service.validate_citation.assert_not_awaited()


@pytest.mark.parametrize(
    "boundary", ["version", "evidence", "list_evidence", "validate_citation"]
)
@pytest.mark.parametrize("kind", ["missing", "cancelled"])
async def test_reader_propagates_service_failure_without_retry(reader, boundary, kind):
    error = (
        NotFoundError("Synthetic missing evidence")
        if kind == "missing"
        else asyncio.CancelledError()
    )
    dependency = getattr(reader.service, boundary)
    dependency.side_effect = error
    with pytest.raises(type(error)) as caught:
        await routes.version(VERSION, "ev_old")
    assert caught.value is error
    dependency.assert_awaited_once()


@pytest.mark.parametrize(
    "validity,reason", [("verified", None), ("invalid", "SOURCE_CHANGED")]
)
async def test_evidence_detail_uses_record_scope_and_returns_verdict(
    reader, validity, reason
):
    reader.service.validate_citation.return_value = {
        "reference_validity": validity,
        "reason": reason,
    }
    result = await routes.evidence("ev_old")
    assert result == {
        **reader.row,
        "reference_validity": validity,
        "reference_reason": reason,
    }
    reader.service.validate_citation.assert_awaited_once_with(
        {"evidence_id": "ev_old"}, [VERSION]
    )
    assert "reference_validity" not in reader.row


@pytest.mark.parametrize("mime", ["application/pdf", "text/plain", "text/markdown"])
async def test_download_builds_inline_no_store_response_without_sending_file(
    reader, mime
):
    reader.service.version.return_value = {
        "mime_type": mime,
        "source_title": "合成资料.pdf",
    }
    response = await routes.download(VERSION)
    assert response.path == "/synthetic-original.pdf"
    assert (
        response.media_type == mime and response.headers["cache-control"] == "no-store"
    )
    assert response.headers["content-disposition"].startswith(
        "inline; filename*=utf-8''"
    )
    assert response.filename == "合成资料.pdf" and response.stat_result is None
    reader.service.resolve_file.assert_awaited_once_with(VERSION)


@pytest.mark.parametrize(
    "mime", ["text/html", "application/octet-stream", "application/pdf; charset=utf-8"]
)
async def test_download_rejects_unsupported_mime_before_resolving_bytes(reader, mime):
    reader.service.version.return_value = {"mime_type": mime}
    with pytest.raises(InvalidInputError, match="UNSAFE_ORIGINAL_TYPE"):
        await routes.download(VERSION)
    reader.service.resolve_file.assert_not_awaited()


async def test_versions_returns_saved_identity_list(reader):
    assert await routes.versions("source:fixture") == [{"source_version_id": VERSION}]
    reader.service.versions.assert_awaited_once_with("source:fixture")
