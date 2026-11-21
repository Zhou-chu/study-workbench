"""Read projection/membership units with synthetic persistence."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, call

import pytest

from api.evidence_service import EvidenceService
from api.personal_store import READ_BATCH_SIZE
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def metadata():
    rows = {
        ("version", "sv_one"): {
            "source_version_id": "sv_one",
            "current_extraction_id": "ex_one",
        },
        ("extraction", "ex_one"): {
            "source_version_id": "sv_one",
            "extraction_id": "ex_one",
            "evidence_ids": ["ev_one"],
            "page_count": 3,
            "warnings": ["partial"],
        },
        ("evidence", "ev_one"): {
            "evidence_id": "ev_one",
            "source_version_id": "sv_one",
            "extraction_id": "ex_one",
            "quote": "合成引用",
        },
    }

    async def get(kind, identity):
        return deepcopy(rows.get((kind, identity)))

    store = SimpleNamespace(
        get=AsyncMock(side_effect=get), prefetch=AsyncMock(), list=AsyncMock()
    )
    service = object.__new__(EvidenceService)
    service.store = store
    return service, rows, store


@pytest.mark.asyncio
async def test_version_projection_and_list_sort_do_not_mutate_records(metadata):
    service, rows, store = metadata
    before = deepcopy(rows)
    result = await service.version("sv_one")
    assert result["page_count"] == 3
    assert result["warnings"] == ["partial"] and result["evidence_count"] == 1
    assert result["extraction"] == rows["extraction", "ex_one"]
    assert store.get.await_args_list == [
        call("version", "sv_one"),
        call("extraction", "ex_one"),
    ]
    store.list.return_value = [
        {"created_at": "2026-02", "id": "later"},
        {"created_at": "2026-01", "id": "earlier"},
    ]
    assert [r["id"] for r in await service.versions("source:one")] == [
        "earlier",
        "later",
    ]
    store.list.assert_awaited_once_with("version", source_id="source:one")
    assert rows == before


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["pointer", "extraction"])
async def test_version_without_retained_extraction_has_explicit_empty_projection(
    metadata, missing
):
    service, rows, _ = metadata
    if missing == "pointer":
        rows["version", "sv_one"].pop("current_extraction_id")
    else:
        rows.pop(("extraction", "ex_one"))
    result = await service.version("sv_one")
    assert result["extraction"] is None and result["page_count"] is None
    assert result["warnings"] == [] and result["evidence_count"] == 0


@pytest.mark.asyncio
async def test_missing_version_and_missing_evidence_are_typed_not_found(metadata):
    service, _, _ = metadata
    with pytest.raises(NotFoundError, match="Source version not found"):
        await service.version("sv_missing")
    with pytest.raises(NotFoundError, match="Evidence not found"):
        await service.evidence("ev_missing")


@pytest.mark.asyncio
async def test_current_evidence_read_uses_declared_order_and_no_prefetch_without_view(
    metadata,
):
    service, rows, store = metadata
    result = await service.list_evidence("sv_one")
    assert result == [rows["evidence", "ev_one"]]
    assert store.get.await_args_list == [
        call("version", "sv_one"),
        call("extraction", "ex_one"),
        call("evidence", "ev_one"),
    ]
    store.prefetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_current_extraction_returns_empty_without_evidence_read(metadata):
    service, rows, store = metadata
    rows["version", "sv_one"].pop("current_extraction_id")
    assert await service.list_evidence("sv_one") == []
    assert store.get.await_args_list == [call("version", "sv_one")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    [
        "missing_extraction",
        "foreign_extraction",
        "payload_id",
        "foreign_version",
        "foreign_evidence_extraction",
    ],
)
async def test_evidence_membership_rejects_dangling_and_cross_version_payloads(
    metadata, corruption
):
    service, rows, _ = metadata
    if corruption == "missing_extraction":
        rows.pop(("extraction", "ex_one"))
    elif corruption == "foreign_extraction":
        rows["extraction", "ex_one"]["source_version_id"] = "sv_other"
    elif corruption == "payload_id":
        rows["evidence", "ev_one"]["evidence_id"] = "ev_other"
    elif corruption == "foreign_version":
        rows["evidence", "ev_one"]["source_version_id"] = "sv_other"
    else:
        rows["evidence", "ev_one"]["extraction_id"] = "ex_other"
    error = (
        NotFoundError
        if corruption in ("missing_extraction", "foreign_extraction")
        else InvalidInputError
    )
    with pytest.raises(error):
        await service.list_evidence("sv_one")


@pytest.mark.asyncio
async def test_explicit_read_view_batches_in_order_and_never_uses_store(metadata):
    service, rows, reads = metadata
    ids = [f"ev_{i}" for i in range(READ_BATCH_SIZE + 1)]
    rows["extraction", "ex_one"]["evidence_ids"] = ids
    for identity in ids:
        rows["evidence", identity] = {
            "evidence_id": identity,
            "source_version_id": "sv_one",
            "extraction_id": "ex_one",
        }
    service.store = SimpleNamespace(
        get=AsyncMock(side_effect=AssertionError("fallback forbidden"))
    )
    records = await service.list_evidence("sv_one", "ex_one", _reads=reads)
    assert [r["evidence_id"] for r in records] == ids
    assert reads.prefetch.await_args_list == [
        call("evidence", ids[:READ_BATCH_SIZE]),
        call("evidence", ids[READ_BATCH_SIZE:]),
    ]
    service.store.get.assert_not_awaited()
