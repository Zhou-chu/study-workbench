"""Repository scope capture: real binding logic, synthetic query/lock boundary."""

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
from copy import deepcopy

import pytest

from open_notebook.database import evidence_embedding_repository as module
from open_notebook.exceptions import InvalidInputError

NB = "notebook:scope"


def physical(kind, identity):
    return f"v1_{kind}:{hashlib.sha256(identity.encode()).hexdigest()}"


@pytest.fixture
def harness(monkeypatch):
    events: list[tuple[object, ...]] = []
    versions: list[dict[str, object]] = []
    extractions: list[dict[str, object]] = []
    membership: list[dict[str, object]] = []
    evidence: list[dict[str, object]] = []
    rows: dict[str, list[dict[str, object]] | BaseException] = {
        "scope-notebook": [{"id": NB}],
        "scope-versions": versions,
        "scope-extractions": extractions,
        "scope-membership": membership,
        "canonical-evidence": evidence,
        "scope-epochs": [{"version_id": "v2", "scope_epoch": 4}],
    }
    for i in (2, 1):
        v, x, e, source = f"v{i}", f"x{i}", f"e{i}", f"source:{i}"
        versions.append(
            dict(
                id=physical("version", v),
                source_version_id=v,
                source_id=source,
                notebook_id=NB,
                status="partial",
                current_extraction_id=x,
            )
        )
        extractions.append(
            dict(
                id=physical("extraction", x),
                extraction_id=x,
                source_version_id=v,
                notebook_id=NB,
                status="ready",
                evidence_ids=[e],
            )
        )
        membership.append({"in": source, "out": NB})
        evidence.append(
            dict(
                id=physical("evidence", e),
                evidence_id=e,
                version_id=v,
                extraction_id=x,
                notebook_id=NB,
                quote_hash=str(i) * 64,
            )
        )

    @asynccontextmanager
    async def lock(notebook):
        events.append(("lock", notebook))
        try:
            yield
        finally:
            events.append(("unlock", notebook))

    async def query(sql, params):
        marker = sql.splitlines()[0][3:]
        events.append((marker, deepcopy(params), sql))
        assert events[0] == ("lock", NB)
        result = rows[marker]
        if isinstance(result, BaseException):
            raise result
        return deepcopy(result)

    monkeypatch.setattr(module, "project_lock", lock)
    return module.EvidenceEmbeddingRepository(query=query), rows, events


@pytest.mark.asyncio
async def test_capture_sorted_deduplicated_physical_binding_and_epoch(harness):
    repo, _, events = harness
    result = await repo.capture_scope(NB, ["v2", "v1", "v2"])
    assert result.notebook_id == NB
    assert [(e.version_id, e.extraction_id, e.scope_epoch) for e in result.entries] == [
        ("v1", "x1", 0),
        ("v2", "x2", 4),
    ]
    for i, entry in enumerate(result.entries, 1):
        wire = json.dumps(
            [[f"e{i}", str(i) * 64]],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        assert entry.manifest_hash == hashlib.sha256(wire.encode()).hexdigest()
    assert [e[0] for e in events] == [
        "lock",
        "scope-notebook",
        "scope-versions",
        "scope-extractions",
        "scope-membership",
        "canonical-evidence",
        "scope-epochs",
        "unlock",
    ]
    params = events[2][1]
    assert params["version_ids"] == ["v1", "v2"]
    assert [str(t) for t in params["targets"]] == [
        physical("version", "v1"),
        physical("version", "v2"),
    ]
    canonical = events[5][1]
    assert canonical["pairs"] == [["v1", "x1"], ["v2", "x2"]]
    assert canonical["evidence_ids"] == ["e1", "e2"]
    assert canonical["metadata_limit"] == 3
    assert [str(t) for t in canonical["targets"]] == [
        physical("evidence", "e1"),
        physical("evidence", "e2"),
    ]
    assert "payload.text" not in events[5][2]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "versions, code",
    [
        ([], "NO_SOURCES_SELECTED"),
        ([""], "INDEX_INTEGRITY"),
        ([f"v{i}" for i in range(21)], "SOURCE_LIMIT"),
    ],
)
async def test_capture_rejects_selection_before_query(harness, versions, code):
    repo, _, events = harness
    with pytest.raises(InvalidInputError, match=code):
        await repo.capture_scope(NB, versions)
    assert all(e[0] in ("lock", "unlock") for e in events)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "table, field, value",
    [
        ("scope-versions", "id", physical("version", "wrong")),
        ("scope-versions", "source_version_id", "alien"),
        ("scope-versions", "notebook_id", "notebook:foreign"),
        ("scope-versions", "status", "running"),
        ("scope-versions", "source_id", ""),
        ("scope-versions", "current_extraction_id", ""),
        ("scope-extractions", "id", physical("extraction", "wrong")),
        ("scope-extractions", "extraction_id", "alien"),
        ("scope-extractions", "source_version_id", "alien"),
        ("scope-extractions", "notebook_id", "notebook:foreign"),
        ("scope-extractions", "status", "failed"),
        ("scope-extractions", "evidence_ids", "e2"),
        ("scope-extractions", "evidence_ids", ["e2", "e2"]),
        ("scope-membership", "out", "notebook:foreign"),
    ],
)
async def test_metadata_binding_failure_prevents_canonical_read(
    harness, table, field, value
):
    repo, rows, events = harness
    rows[table][0][field] = value
    with pytest.raises(InvalidInputError):
        await repo.capture_scope(NB, ["v1", "v2"])
    assert "canonical-evidence" not in [e[0] for e in events]
    assert events[-1] == ("unlock", NB)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field, value",
    [
        ("id", physical("evidence", "wrong")),
        ("evidence_id", "alien"),
        ("notebook_id", "notebook:foreign"),
        ("version_id", "v1"),
        ("extraction_id", "x1"),
        ("quote_hash", "A" * 64),
        ("quote_hash", None),
    ],
)
async def test_canonical_binding_failure_prevents_epoch_read(harness, field, value):
    repo, rows, events = harness
    rows["canonical-evidence"][0][field] = value
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await repo.capture_scope(NB, ["v1", "v2"])
    assert "scope-epochs" not in [e[0] for e in events]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "epochs",
    [
        [{"version_id": "alien", "scope_epoch": 1}],
        [{"version_id": "v2", "scope_epoch": True}],
        [{"version_id": "v2", "scope_epoch": -1}],
        [{"version_id": "v2", "scope_epoch": 1}] * 2,
    ],
)
async def test_epoch_integrity_rejected(harness, epochs):
    repo, rows, events = harness
    rows["scope-epochs"] = epochs
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await repo.capture_scope(NB, ["v1", "v2"])
    assert events[-1] == ("unlock", NB)


@pytest.mark.asyncio
async def test_empty_evidence_skips_canonical_io_but_captures_epoch(harness):
    repo, rows, events = harness
    for extraction in rows["scope-extractions"]:
        extraction["evidence_ids"] = []
    result = await repo.capture_scope(NB, ["v1", "v2"])
    assert all(
        e.manifest_hash == hashlib.sha256(b"[]").hexdigest() for e in result.entries
    )
    assert "canonical-evidence" not in [e[0] for e in events]
    assert result.entries[1].scope_epoch == 4


@pytest.mark.asyncio
async def test_assert_scope_revalidates_then_rejects_epoch_drift(harness):
    repo, rows, events = harness
    snapshot = await repo.capture_scope(NB, ["v1", "v2"])
    await repo.assert_scope(snapshot)
    rows["scope-epochs"][0]["scope_epoch"] += 1
    with pytest.raises(InvalidInputError, match="SCOPE_CHANGED"):
        await repo.assert_scope(snapshot)
    assert [e[0] for e in events].count("canonical-evidence") == 3
    assert [e[0] for e in events].count("unlock") == 3


@pytest.mark.asyncio
async def test_query_cancellation_releases_barrier_without_reading_later_phase(harness):
    repo, rows, events = harness
    cancelled = asyncio.CancelledError()
    rows["scope-extractions"] = cancelled
    with pytest.raises(asyncio.CancelledError) as caught:
        await repo.capture_scope(NB, ["v1", "v2"])
    assert caught.value is cancelled
    assert [e[0] for e in events] == [
        "lock",
        "scope-notebook",
        "scope-versions",
        "scope-extractions",
        "unlock",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "table",
    ["scope-notebook", "scope-versions", "scope-extractions", "canonical-evidence"],
)
async def test_missing_projection_never_returns_partial_scope(harness, table):
    repo, rows, events = harness
    rows[table].pop()
    with pytest.raises(InvalidInputError):
        await repo.capture_scope(NB, ["v1", "v2"])
    assert "scope-epochs" not in [e[0] for e in events]


@pytest.mark.asyncio
async def test_duplicate_evidence_across_versions_rejected_before_projection(harness):
    repo, rows, events = harness
    rows["scope-extractions"][0]["evidence_ids"] = ["e1"]
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await repo.capture_scope(NB, ["v1", "v2"])
    assert "canonical-evidence" not in [e[0] for e in events]


@pytest.mark.asyncio
async def test_duplicate_projection_cannot_replace_missing_canonical_identity(harness):
    repo, rows, _ = harness
    rows["canonical-evidence"][0] = deepcopy(rows["canonical-evidence"][1])
    with pytest.raises(InvalidInputError, match="INDEX_INTEGRITY"):
        await repo.capture_scope(NB, ["v1", "v2"])
