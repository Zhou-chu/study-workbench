"""Real lexical retrieval chain and file-verification decisions, without external I/O."""

import asyncio
import hashlib
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

import api.evidence_service as module
from open_notebook.exceptions import InvalidInputError, NotFoundError


@pytest.fixture
def search(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_SELECTED_SOURCES", "20")
    version: dict[str, object] = {
        "source_version_id": "sv_one",
        "status": "ready",
        "current_extraction_id": "ex_one",
    }
    rows: dict[tuple[str, str], dict[str, object]] = {("version", "sv_one"): version}
    blocks = []
    ids = []
    for identity, quote in [
        ("ev_z", "solar power"),
        ("ev_a", "solar power"),
        ("ev_other", "lunar"),
    ]:
        block_id = "block_" + identity
        blocks.append({"block_id": block_id, "text": quote})
        ids.append(identity)
        rows["evidence", identity] = {
            "evidence_id": identity,
            "source_version_id": "sv_one",
            "extraction_id": "ex_one",
            "quote": quote,
            "quote_hash": hashlib.sha256(quote.encode()).hexdigest(),
            "locator": {
                "block_id": block_id,
                "start_offset": 0,
                "end_offset": len(quote),
            },
        }
    extraction: dict[str, object] = {
        "source_version_id": "sv_one",
        "evidence_ids": ids,
        "blocks": blocks,
    }
    rows["extraction", "ex_one"] = extraction

    async def get(kind: str, identity: str):
        return deepcopy(rows.get((kind, identity)))

    store = SimpleNamespace(get=AsyncMock(side_effect=get))
    service = object.__new__(module.EvidenceService)
    service.store = store
    return SimpleNamespace(
        service=service, store=store, rows=rows, version=version, extraction=extraction
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query,versions,error",
    [
        ("solar", [], "NO_SOURCES_SELECTED"),
        ("", ["sv_one"], "Question must not be empty"),
        (" \n ", ["sv_one"], "Question must not be empty"),
    ],
)
async def test_invalid_search_request_rejects_before_storage(
    search: SimpleNamespace, query: str, versions: list[str], error: str
) -> None:
    with pytest.raises(InvalidInputError, match=error):
        await search.service.retrieve(query, versions)
    search.store.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_selection_limit_applies_after_deduplication(
    search: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STUDY_WORKBENCH_MAX_SELECTED_SOURCES", "1")
    with pytest.raises(InvalidInputError, match="SOURCE_LIMIT"):
        await search.service.retrieve("solar", ["sv_one", "sv_other"])
    search.store.get.assert_not_awaited()
    hits = await search.service.retrieve("solar", ["sv_one", "sv_one"])
    assert [h["evidence_id"] for h in hits] == ["ev_a", "ev_z"]
    # One list_evidence load, not one per repeated selected ID.
    assert (
        sum(
            c.args == ("evidence", "ev_other") for c in search.store.get.await_args_list
        )
        == 1
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "running", "failed"])
async def test_nonready_source_never_reads_evidence(
    search: SimpleNamespace, status: str
) -> None:
    search.version["status"] = status
    with pytest.raises(
        InvalidInputError, match=f"SOURCE_NOT_READY: sv_one is {status}"
    ):
        await search.service.retrieve("solar", ["sv_one"])
    search.store.get.assert_awaited_once_with("version", "sv_one")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["ready", "partial"])
async def test_ranking_is_stable_verified_and_does_not_modify_canonical_records(
    search: SimpleNamespace, status: str
) -> None:
    search.version["status"] = status
    before = deepcopy(search.rows)
    hits = await search.service.retrieve("solar", ["sv_one"])
    assert [h["evidence_id"] for h in hits] == ["ev_a", "ev_z"]
    assert all(h["score"] > 0 and h["retrieval_method"] == "lexical" for h in hits)
    assert all(
        h["reference_validity"] == "verified" and h["reference_reason"] is None
        for h in hits
    )
    assert search.rows == before


@pytest.mark.asyncio
@pytest.mark.parametrize("limit,expected", [(-4, 1), (0, 1), (1, 1), (1000, 2)])
async def test_result_limit_is_bounded(
    search: SimpleNamespace, limit: int, expected: int
) -> None:
    hits = await search.service.retrieve("solar", ["sv_one"], limit=limit)
    assert len(hits) == expected
    assert hits[0]["evidence_id"] == "ev_a"


@pytest.mark.asyncio
async def test_unmatched_query_returns_no_citation_lookups(
    search: SimpleNamespace,
) -> None:
    assert await search.service.retrieve("unrelated", ["sv_one"]) == []
    assert (
        sum(c.args == ("evidence", "ev_a") for c in search.store.get.await_args_list)
        == 1
    )


@pytest.mark.asyncio
async def test_restored_archive_hits_remain_unverified(search: SimpleNamespace) -> None:
    search.extraction["verification_origin"] = "restored_archive"
    hits = await search.service.retrieve("solar", ["sv_one"])
    assert all(h["reference_validity"] == "unverified" for h in hits)
    assert all("fresh local extraction" in h["reference_reason"] for h in hits)


@pytest.mark.asyncio
async def test_derived_hits_do_not_claim_independent_support(
    search: SimpleNamespace,
) -> None:
    search.version.update(
        origin="derived_snapshot", provenance={"origin_id": "note:synthetic"}
    )
    hits = await search.service.retrieve("solar", ["sv_one"])
    assert all(h["independent_support"] is False for h in hits)
    assert all(h["provenance"] == {"origin_id": "note:synthetic"} for h in hits)


@pytest.mark.asyncio
async def test_missing_selected_version_is_not_silently_ignored(
    search: SimpleNamespace,
) -> None:
    with pytest.raises(NotFoundError, match="Source version not found"):
        await search.service.retrieve("solar", ["missing"])


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_storage_failure_or_cancellation_propagates_without_partial_results(
    search: SimpleNamespace, cancel: bool
) -> None:
    error = asyncio.CancelledError("cancel") if cancel else OSError("unavailable")
    search.store.get.side_effect = error
    with pytest.raises(type(error)) as caught:
        await search.service.retrieve("solar", ["sv_one"])
    assert caught.value is error
    assert search.store.get.await_count == 1


@pytest.fixture
def file_boundary(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    data = b"canonical bytes"
    version = {
        "file_path": "originals/file.txt",
        "byte_size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    path = Mock(spec=Path)
    path.is_relative_to.return_value = True
    path.is_file.return_value = True
    # Magic path operators are provided by a MagicMock, not a real directory.

    root = MagicMock(spec=Path)
    root.__truediv__.return_value.resolve.return_value = path
    service = object.__new__(module.EvidenceService)
    service.store = SimpleNamespace(get=AsyncMock(return_value=version))
    service.data_root = root
    thread = AsyncMock(return_value=data)
    monkeypatch.setattr(module.asyncio, "to_thread", thread)
    return SimpleNamespace(
        service=service, version=version, path=path, root=root, thread=thread
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("unsafe", ["outside", "absolute"])
async def test_original_path_rejected_before_file_probe(
    file_boundary: SimpleNamespace, unsafe: str
) -> None:
    s = file_boundary
    if unsafe == "outside":
        s.path.is_relative_to.return_value = False
    else:
        s.version["file_path"] = "/absolute/file.txt"
    with pytest.raises(InvalidInputError, match="Unsafe original file path"):
        await s.service.resolve_file("sv_one")
    s.path.is_file.assert_not_called()
    s.thread.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_original_is_not_read(file_boundary: SimpleNamespace) -> None:
    s = file_boundary
    s.path.is_file.return_value = False
    with pytest.raises(NotFoundError, match="Original file is missing"):
        await s.service.resolve_file("sv_one")
    s.thread.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["size", "hash"])
async def test_original_integrity_rejects_length_or_digest_mismatch(
    file_boundary: SimpleNamespace, corruption: str
) -> None:
    s = file_boundary
    s.version["byte_size" if corruption == "size" else "sha256"] = (
        999 if corruption == "size" else "0" * 64
    )
    with pytest.raises(InvalidInputError, match="integrity verification failed"):
        await s.service.resolve_file("sv_one")
    s.thread.assert_awaited_once_with(s.path.read_bytes)


@pytest.mark.asyncio
async def test_verified_original_returns_same_resolved_path(
    file_boundary: SimpleNamespace,
) -> None:
    s = file_boundary
    assert await s.service.resolve_file("sv_one") is s.path
    s.path.is_relative_to.assert_called_once_with(s.root)
    s.thread.assert_awaited_once_with(s.path.read_bytes)


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_original_read_failure_keeps_exception_identity(
    file_boundary: SimpleNamespace, cancel: bool
) -> None:
    error = asyncio.CancelledError("cancel") if cancel else OSError("unreadable")
    file_boundary.thread.side_effect = error
    with pytest.raises(type(error)) as caught:
        await file_boundary.service.resolve_file("sv_one")
    assert caught.value is error


@pytest.mark.asyncio
async def test_result_limit_never_exceeds_one_hundred(search: SimpleNamespace) -> None:
    identities = [f"ev_{index:03d}" for index in range(101)]
    template = search.rows["evidence", "ev_z"]
    for identity in identities:
        search.rows["evidence", identity] = {
            **deepcopy(template),
            "evidence_id": identity,
        }
    search.extraction["evidence_ids"] = identities
    hits = await search.service.retrieve("solar", ["sv_one"], limit=1000)
    assert [hit["evidence_id"] for hit in hits] == identities[:100]
    # The excluded result is read for scoring, but not re-read for citation validation.
    assert (
        sum(
            c.args == ("evidence", identities[-1])
            for c in search.store.get.await_args_list
        )
        == 1
    )
