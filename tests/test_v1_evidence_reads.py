"""Request-local reader batching over real services and a physical query boundary.

No database, parser, provider, or HTTP listener is started. Unordered query rows
deliberately carry untrusted logical identifiers, as retained payloads can.
"""

import hashlib
from copy import deepcopy
from typing import Any

import pytest
from starlette.responses import JSONResponse

from api.evidence_service import EvidenceService
from api.personal_store import PersonalStore
from open_notebook.exceptions import InvalidInputError, NotFoundError


def physical(kind, identity):
    return f"v1_{kind}:" + hashlib.sha256(identity.encode()).hexdigest()


class PhysicalQueries:
    def __init__(self):
        self.rows = {}
        self.calls = []

    def put(self, kind, identity, payload):
        key = physical(kind, identity)
        self.rows[key] = {
            "id": key,
            "app_id": "untrusted",
            "payload": deepcopy(payload),
        }

    async def query(self, sql, variables=None):
        variables = variables or {}
        self.calls.append((sql, deepcopy(variables)))
        if sql == "SELECT payload FROM $target;":
            row = self.rows.get(str(variables["target"]))
            return (
                [
                    {
                        key: deepcopy(value)
                        for key, value in row.items()
                        if key == "payload"
                    }
                ]
                if row
                else []
            )
        assert sql == "SELECT id, payload FROM $targets;"
        targets = variables["targets"]
        assert 0 < len(targets) <= 128
        assert len({str(target) for target in targets}) == len(targets)
        return [
            {
                key: deepcopy(value)
                for key, value in self.rows[str(target)].items()
                if key in ("id", "payload")
            }
            for target in reversed(targets)
            if str(target) in self.rows
        ]


@pytest.fixture
def reader(tmp_path, monkeypatch):
    import api.personal_store as store_module
    import api.routers.evidence as routes

    queries = PhysicalQueries()
    monkeypatch.setattr(store_module, "repo_query", queries.query)
    monkeypatch.setattr(
        routes, "EvidenceService", lambda: EvidenceService(PersonalStore(), tmp_path)
    )
    return queries, routes.version


def seed(queries, count=1):
    quote = "🌞 原始 evidence."
    version = {
        "source_version_id": "sv",
        "current_extraction_id": "ex",
        "origin": "upload",
        "status": "ready",
        "source_title": "Original",
    }
    extraction: dict[str, Any] = {
        "extraction_id": "ex",
        "source_version_id": "sv",
        "status": "ready",
        "blocks": [{"block_id": "b", "text": quote, "page_index": None}],
        "evidence_ids": [f"ev_{index}" for index in range(count)],
        "warnings": ["retained warning"],
        "page_count": 1,
    }
    records = [
        {
            "evidence_id": identity,
            "source_version_id": "sv",
            "extraction_id": "ex",
            "source_title": "Original",
            "quote": quote,
            "quote_hash": hashlib.sha256(quote.encode()).hexdigest(),
            "evidence_kind": "text",
            "locator": {
                "block_id": "b",
                "page_index": None,
                "start_offset": 0,
                "end_offset": len(quote),
            },
        }
        for identity in extraction["evidence_ids"]
    ]
    queries.put("version", "sv", version)
    queries.put("extraction", "ex", extraction)
    for record in records:
        queries.put("evidence", record["evidence_id"], record)
    return version, extraction, records


def expected_detail(version, extraction, records):
    return {
        "version": {
            **version,
            "page_count": 1,
            "warnings": ["retained warning"],
            "evidence_count": len(extraction["evidence_ids"]),
        },
        "extraction": extraction,
        "evidence": [
            {**record, "reference_validity": "verified", "reference_reason": None}
            for record in records
        ],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "count,query_count", [(0, 2), (1, 3), (128, 3), (129, 4), (172, 4)]
)
async def test_detail_batches_physical_reads_without_changing_response_bytes(
    reader, count, query_count
):
    queries, detail = reader
    version, extraction, records = seed(queries, count)
    retained = deepcopy(queries.rows)
    actual = await detail("sv")
    assert (
        JSONResponse(actual).body
        == JSONResponse(expected_detail(version, extraction, records)).body
    )
    assert queries.rows == retained
    assert len(queries.calls) == query_count


@pytest.mark.asyncio
async def test_detail_keeps_duplicate_order_despite_unordered_batch_rows(reader):
    queries, detail = reader
    version, extraction, records = seed(queries, 3)
    extraction["evidence_ids"] = ["ev_2", "ev_0", "ev_2", "ev_1"]
    queries.put("extraction", "ex", extraction)
    actual = await detail("sv")
    assert actual == expected_detail(
        version, extraction, [records[2], records[0], records[2], records[1]]
    )
    assert actual["evidence"][0] is not actual["evidence"][2]
    assert len(queries.calls) == 3


@pytest.mark.asyncio
async def test_detail_rejects_payload_identity_alias_before_reusing_verdict(reader):
    queries, detail = reader
    _, _, records = seed(queries, 2)
    records[0]["evidence_id"] = "ev_1"
    records[0]["quote_hash"] = "corrupt"
    queries.put("evidence", "ev_0", records[0])
    with pytest.raises(
        InvalidInputError, match="Stored evidence integrity check failed"
    ):
        await detail("sv")
    assert len(queries.calls) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("malformed", [None, [], "", "x" * 513])
@pytest.mark.parametrize("missing_first", [False, True])
async def test_detail_preserves_missing_before_malformed_identity_order(
    reader, malformed, missing_first
):
    queries, detail = reader
    _, extraction, _ = seed(queries)
    extraction["evidence_ids"] = (
        ["missing", malformed] if missing_first else [malformed, "missing"]
    )
    queries.put("extraction", "ex", extraction)
    error = NotFoundError if missing_first else ValueError
    message = "Evidence not found" if missing_first else "Invalid record identity"
    with pytest.raises(error, match=message):
        await detail("sv")


@pytest.mark.asyncio
async def test_detail_does_not_fetch_later_chunk_after_known_missing(reader):
    queries, detail = reader
    _, extraction, _ = seed(queries, 129)
    extraction["evidence_ids"][0] = "missing"
    queries.put("extraction", "ex", extraction)
    with pytest.raises(NotFoundError, match="Evidence not found"):
        await detail("sv")
    assert len(queries.calls) == 3
    assert all(
        str(target) != physical("evidence", "ev_128")
        for _, variables in queries.calls
        for target in variables.get("targets", [])
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change,validity,reason",
    [
        ("hash", "invalid", "Stored evidence integrity check failed"),
        ("text", "invalid", "Stored evidence integrity check failed"),
        (
            "restored",
            "unverified",
            "Restored archive evidence has not been verified by a fresh local extraction",
        ),
        ("fresh", "verified", None),
        (
            "foreign_fresh",
            "unverified",
            "Restored archive evidence has not been verified by a fresh local extraction",
        ),
    ],
)
async def test_detail_retains_integrity_scope_and_archive_verdicts(
    reader, change, validity, reason
):
    queries, detail = reader
    _, extraction, records = seed(queries)
    record = records[0]
    if change == "hash":
        record["quote_hash"] = "broken"
    elif change == "text":
        extraction["blocks"][0]["text"] = "changed"
    else:
        extraction["verification_origin"] = "restored_archive"
        if change != "restored":
            fresh = {**deepcopy(extraction), "extraction_id": "fresh"}
            fresh.pop("verification_origin")
            if change == "foreign_fresh":
                fresh["source_version_id"] = "foreign"
            queries.put("extraction", "fresh", fresh)
            extraction["revalidation"] = {
                "fresh_extraction_id": "fresh",
                "evidence_ids": ["ev_0"],
            }
    queries.put("extraction", "ex", extraction)
    queries.put("evidence", "ev_0", record)
    actual = await detail("sv")
    assert actual["evidence"] == [
        {**record, "reference_validity": validity, "reference_reason": reason}
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change", ["missing_retained", "foreign_version", "foreign_retained"]
)
async def test_detail_rejects_evidence_outside_selected_extraction(reader, change):
    queries, detail = reader
    _, extraction, records = seed(queries)
    record = records[0]
    if change == "foreign_version":
        record["source_version_id"] = "foreign"
        record["extraction_id"] = []  # Reject before a malformed retained lookup.
    else:
        record["extraction_id"] = "other"
        if change == "foreign_retained":
            queries.put(
                "extraction", "other", {**extraction, "source_version_id": "foreign"}
            )
    queries.put("evidence", "ev_0", record)
    retained = deepcopy(queries.rows)
    with pytest.raises(
        InvalidInputError, match="Stored evidence integrity check failed"
    ):
        await detail("sv")
    assert queries.rows == retained
    assert len(queries.calls) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("identity", ["ev_1", None, [], 1])
async def test_citation_rejects_stored_identity_before_scope_and_supplied_ids(
    reader, tmp_path, identity
):
    queries, _ = reader
    _, _, records = seed(queries, 2)
    record = records[0]
    record["evidence_id"] = identity
    queries.put("evidence", "ev_0", record)
    service = EvidenceService(PersonalStore(), tmp_path)
    checked = await service.validate_citation(
        {"evidence_id": "ev_0"}, ["sv"], evidence_ids=["ev_1"]
    )
    assert checked["evidence_id"] == "ev_0"
    assert checked["reference_validity"] == "invalid"
    assert checked["reason"] == "Stored evidence integrity check failed"
    assert checked["quote"] == ""
    assert len(queries.calls) == 1
    record["source_version_id"] = "foreign"
    queries.put("evidence", "ev_0", record)
    checked = await service.validate_citation({"evidence_id": "ev_0"}, ["sv"])
    assert checked["reference_validity"] == "invalid"
    assert checked["reason"] == "Stored evidence integrity check failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("restored", [False, True])
async def test_citation_rejects_foreign_retained_extraction_even_with_matching_text(
    reader, tmp_path, restored
):
    queries, _ = reader
    _, extraction, _ = seed(queries)
    extraction["source_version_id"] = "foreign"
    if restored:
        extraction["verification_origin"] = "restored_archive"
        extraction["revalidation"] = {
            "fresh_extraction_id": "fresh",
            "evidence_ids": ["ev_0"],
        }
        queries.put(
            "extraction",
            "fresh",
            {**extraction, "source_version_id": "sv", "verification_origin": "local"},
        )
    queries.put("extraction", "ex", extraction)
    checked = await EvidenceService(PersonalStore(), tmp_path).validate_citation(
        {"evidence_id": "ev_0"}, ["sv"]
    )
    assert checked["reference_validity"] == "invalid"
    assert checked["reason"] == "Stored evidence integrity check failed"
    assert checked["quote"] == ""
    assert len(queries.calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case,reason",
    [
        ("scope", "Evidence is outside the selected source versions"),
        ("supplied", "Evidence was not supplied to this answer"),
        ("version", "Source version does not match evidence"),
        ("quote", "Quote does not match evidence"),
    ],
)
async def test_citation_keeps_input_rejection_before_retained_extraction_checks(
    reader, tmp_path, case, reason
):
    queries, _ = reader
    _, _, records = seed(queries)
    records[0]["extraction_id"] = []
    queries.put("evidence", "ev_0", records[0])
    citation = {"evidence_id": "ev_0"}
    if case == "version":
        citation["source_version_id"] = "wrong"
    if case == "quote":
        citation["quote"] = "not retained"
    checked = await EvidenceService(PersonalStore(), tmp_path).validate_citation(
        citation,
        [] if case == "scope" else ["sv"],
        evidence_ids=[] if case == "supplied" else None,
    )
    assert checked["reason"] == reason
    assert len(queries.calls) == 1


@pytest.mark.asyncio
async def test_detail_cache_does_not_survive_request_or_mutate_retained_values(reader):
    queries, detail = reader
    _, _, records = seed(queries)
    first = await detail("sv")
    first["evidence"][0]["locator"]["start_offset"] = 99
    records[0]["quote_hash"] = "changed between requests"
    queries.put("evidence", "ev_0", records[0])
    second = await detail("sv")
    assert second["evidence"][0]["reference_validity"] == "invalid"
    assert second["evidence"][0]["locator"]["start_offset"] == 0
    assert (
        "reference_validity"
        not in queries.rows[physical("evidence", "ev_0")]["payload"]
    )
    assert len(queries.calls) == 6


@pytest.mark.asyncio
async def test_historical_detail_keeps_current_summary_and_old_blocks(reader):
    queries, detail = reader
    version, extraction, records = seed(queries, 2)
    current = {
        **extraction,
        "extraction_id": "current",
        "evidence_ids": [],
        "page_count": 9,
    }
    version["current_extraction_id"] = "current"
    queries.put("version", "sv", version)
    queries.put("extraction", "current", current)
    actual = await detail("sv", evidence_id="ev_0")
    expected = expected_detail(version, extraction, records)
    expected["version"].update(page_count=9, evidence_count=0)
    assert JSONResponse(actual).body == JSONResponse(expected).body
    assert len(queries.calls) == 5


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case,error,message",
    [
        ("missing_version", NotFoundError, "Source version not found"),
        ("missing_evidence", NotFoundError, "Evidence not found"),
        ("foreign_evidence", InvalidInputError, "EVIDENCE_VERSION_MISMATCH"),
        ("conflicting_extraction", InvalidInputError, "EVIDENCE_EXTRACTION_MISMATCH"),
        ("foreign_extraction", InvalidInputError, "EXTRACTION_VERSION_MISMATCH"),
        ("missing_extraction", InvalidInputError, "EXTRACTION_VERSION_MISMATCH"),
        (
            "foreign_current",
            NotFoundError,
            "Extraction not found for this source version",
        ),
    ],
)
async def test_detail_selection_errors_keep_existing_precedence(
    reader, case, error, message
):
    queries, detail = reader
    _, extraction, records = seed(queries)
    kwargs = {}
    if case == "missing_version":
        queries.rows.pop(physical("version", "sv"))
        kwargs = {"evidence_id": "missing", "extraction_id": "missing"}
    elif case == "missing_evidence":
        kwargs = {"evidence_id": "missing", "extraction_id": "missing"}
    elif case == "foreign_evidence":
        records[0]["source_version_id"] = "foreign"
        queries.put("evidence", "ev_0", records[0])
        kwargs = {"evidence_id": "ev_0", "extraction_id": "missing"}
    elif case == "conflicting_extraction":
        kwargs = {"evidence_id": "ev_0", "extraction_id": "missing"}
    elif case == "missing_extraction":
        kwargs = {"extraction_id": "missing"}
    else:
        extraction["source_version_id"] = "foreign"
        queries.put("extraction", "ex", extraction)
        if case == "foreign_extraction":
            kwargs = {"extraction_id": "ex"}
    with pytest.raises(error, match=message):
        await detail("sv", **kwargs)


@pytest.mark.asyncio
async def test_detail_preserves_legacy_iteration_of_malformed_identity_container(
    reader,
):
    queries, detail = reader
    _, extraction, _ = seed(queries)
    # Retained tables are schemaless. Existing code iterates mapping keys; batching
    # should not turn a previously readable record into a slicing TypeError.
    extraction["evidence_ids"] = {"ev_0": "unused"}
    queries.put("extraction", "ex", extraction)
    actual = await detail("sv")
    assert [item["evidence_id"] for item in actual["evidence"]] == ["ev_0"]


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_first", [False, True])
async def test_detail_consumes_missing_payload_errors_in_original_order(
    reader, missing_first
):
    queries, detail = reader
    _, extraction, _ = seed(queries, 2)
    queries.rows[physical("evidence", "ev_1")].pop("payload")
    extraction["evidence_ids"] = (
        ["missing", "ev_1"] if missing_first else ["ev_1", "missing"]
    )
    queries.put("extraction", "ex", extraction)
    with pytest.raises(NotFoundError if missing_first else KeyError):
        await detail("sv")


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 1, 128, 129, 257])
async def test_store_bulk_read_bounds_queries_and_keeps_raw_missing_values(
    reader, count
):
    queries, _ = reader
    identities = [f"ev_{index}" for index in range(count)]
    if count:
        queries.put("evidence", identities[0], {"evidence_id": "spoof"})
    values = await PersonalStore().get_many("evidence", identities + identities)
    assert list(values) == identities
    if count:
        assert values[identities[0]] == {
            "id": physical("evidence", identities[0]),
            "payload": {"evidence_id": "spoof"},
        }
        assert all(values[identity] is None for identity in identities[1:])
    assert len(queries.calls) == (count + 127) // 128


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,identities",
    [("credential", []), ("evidence", [None]), ("evidence", ["x" * 513])],
)
async def test_store_bulk_rejects_invalid_inputs_without_query(
    reader, kind, identities
):
    queries, _ = reader
    with pytest.raises(ValueError):
        await PersonalStore().get_many(kind, identities)
    assert queries.calls == []


@pytest.mark.asyncio
async def test_non_detail_service_calls_remain_sequential(reader, tmp_path):
    queries, _ = reader
    seed(queries, 2)
    service = EvidenceService(PersonalStore(), tmp_path)
    await service.list_evidence("sv")
    assert len(queries.calls) == 4
    assert all("target" in variables for _, variables in queries.calls)
