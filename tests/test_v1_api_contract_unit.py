"""Direct fixture-backed public behavior with in-memory storage and no transport."""

import json
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from test_v1_evidence_ingest import MemoryStore
from v1_api_contract_fixtures import fixture


@pytest.mark.asyncio
async def test_workspace_fixture_matches_existing_service(monkeypatch):
    from api.personal_service import PersonalService
    from open_notebook.domain.notebook import Notebook

    expected = fixture("workspace")

    async def empty():
        return []

    async def get(_):
        return SimpleNamespace(
            **expected["notebook"], get_sources=empty, get_notes=lambda **kw: empty()
        )

    monkeypatch.setattr(Notebook, "get", get)
    from open_notebook.database.note_repository import NoteWriteResult

    async def bundles(_):
        return [
            NoteWriteResult(native=note, snapshot=None) for note in expected["notes"]
        ]

    monkeypatch.setattr(
        "open_notebook.database.note_repository.read_project_notes_locked", bundles
    )
    actual = await PersonalService(store=MemoryStore()).workspace(
        expected["notebook"]["id"]
    )
    assert actual == expected


@pytest.mark.asyncio
async def test_error_fixtures_match_actual_handlers():
    from api.main import invalid_input_error_handler, personal_bridge_error_handler
    from open_notebook.exceptions import InvalidInputError
    from open_notebook.integrations.notebooklm.contracts import BridgeError

    request = Request({"type": "http", "headers": []})
    for example in fixture("errors"):
        if example["exception"] == "BridgeError":
            response = await personal_bridge_error_handler(
                request, BridgeError(example["code"], example["message"])
            )
        else:
            response = await invalid_input_error_handler(
                request, InvalidInputError(example["message"])
            )
        assert response.status_code == example["status"]
        assert json.loads(response.body) == example["body"]


@pytest.mark.asyncio
async def test_turn_fixture_unmapped_citation_uses_runtime_mapper():
    from api.notebooklm_service import NotebookLMService
    from open_notebook.integrations.notebooklm.contracts import RemoteReference

    example = fixture("turn")
    # A bridge is deliberately not constructed: mapping is purely local.
    service = object.__new__(NotebookLMService)
    service.store = MemoryStore()
    actual = await service.map_reference(
        {
            "remote_source_ids": ["remote-synthetic"],
            "source_version_ids": [],
            "scope_snapshot": {"mappings": []},
        },
        RemoteReference.model_validate(example["unmapped_reference"]),
        1,
    )
    assert actual == example["unmapped_citation"]


@pytest.mark.asyncio
async def test_turn_cancelled_event_is_local_stop_waiting(monkeypatch):
    from api.routers import evidence

    expected = fixture("turn")["cancelled_event"]
    store = MemoryStore()
    await store.put("job", "synthetic", {**expected, "job_id": "synthetic"})
    monkeypatch.setattr(evidence, "get_store", lambda: store)
    response = await evidence.turn_events(expected["turn_id"])
    chunks = [chunk async for chunk in response.body_iterator]
    assert len(chunks) == 1
    assert chunks[0].startswith("event: stage\ndata: ")
    assert json.loads(chunks[0].split("data: ", 1)[1]) == expected
    assert response.media_type == "text/event-stream"


@pytest.mark.asyncio
async def test_archived_citation_is_not_fresh_verification(tmp_path):
    from api.evidence_service import EvidenceService
    from open_notebook.domain.evidence import (
        EvidenceCitation,
        EvidenceRecord,
        Extraction,
    )

    example = fixture("turn")["archived_citation"]
    EvidenceRecord.model_validate(example["evidence"])
    Extraction.model_validate(example["extraction"])
    EvidenceCitation.model_validate(example["response"])
    store = MemoryStore()
    await store.put("evidence", "ev_synthetic", example["evidence"])
    await store.put("extraction", "ex_synthetic", example["extraction"])
    actual = await EvidenceService(store=store, data_root=tmp_path).validate_citation(
        {"evidence_id": "ev_synthetic"}, ["sv_synthetic"]
    )
    assert actual == EvidenceCitation.model_validate(example["response"]).model_dump()


@pytest.mark.asyncio
@pytest.mark.parametrize("restored", [False, True])
@pytest.mark.parametrize("kind", ["text", "remote_text_snapshot", "derived_snapshot"])
async def test_missing_source_version_never_verifies_retained_citation(
    tmp_path, restored, kind
):
    from api.evidence_service import EvidenceService

    example = fixture("turn")["archived_citation"]
    evidence, extraction = example["evidence"], example["extraction"]
    evidence["evidence_kind"] = kind
    if not restored:
        evidence.pop("verification_origin")
        extraction.pop("verification_origin")
    store = MemoryStore()
    await store.put("evidence", "ev_synthetic", evidence)
    await store.put("extraction", "ex_synthetic", extraction)
    actual = await EvidenceService(store=store, data_root=tmp_path).validate_citation(
        {"evidence_id": "ev_synthetic"}, ["sv_synthetic"]
    )
    assert actual["reference_validity"] == "unverified"
    assert actual["kind"] == ("local_evidence" if kind == "text" else kind)
    assert actual["independent_support"] is (
        False if kind == "derived_snapshot" else None
    )
    assert actual["provenance"] is None
    assert actual["quote"] == evidence["quote"]
    assert actual["locator"] == evidence["locator"]


@pytest.mark.asyncio
async def test_missing_version_blocks_historical_revalidation_upgrade(tmp_path):
    from api.evidence_service import EvidenceService

    example = fixture("turn")["archived_citation"]
    evidence, extraction = example["evidence"], example["extraction"]
    fresh = {**extraction, "extraction_id": "ex_fresh", "verification_origin": "local"}
    extraction["revalidation"] = {
        "fresh_extraction_id": "ex_fresh",
        "evidence_ids": ["ev_synthetic"],
    }
    store = MemoryStore()
    await store.put("evidence", "ev_synthetic", evidence)
    await store.put("extraction", "ex_synthetic", extraction)
    await store.put("extraction", "ex_fresh", fresh)
    actual = await EvidenceService(store=store, data_root=tmp_path).validate_citation(
        {"evidence_id": "ev_synthetic"}, ["sv_synthetic"]
    )
    assert actual["reference_validity"] == "unverified"
    assert (
        actual["reason"]
        == "Source version is unavailable; retained citation cannot be freshly verified"
    )


def test_hybrid_turn_request_keeps_explicit_disclosure_and_legacy_defaults():
    from api.routers.evidence import TurnRequest

    legacy = fixture("job")["request"]
    request = TurnRequest.model_validate(legacy)
    assert request.retrieval_mode == "lexical"
    assert "retrieval_mode" not in request.model_fields_set
    modern = {
        **legacy,
        "retrieval_mode": "hybrid",
        "embedding_profile_id": "p",
        "acknowledge_query_processing": True,
        "disclosed_profile_fingerprint": "a" * 64,
        "destination_descriptor_version": "v1",
    }
    assert (
        TurnRequest.model_validate(modern).model_dump()["disclosed_profile_fingerprint"]
        == "a" * 64
    )
    for key in (
        "embedding_profile_id",
        "disclosed_profile_fingerprint",
        "destination_descriptor_version",
    ):
        missing = dict(modern)
        missing.pop(key)
        with pytest.raises(ValueError):
            TurnRequest.model_validate(missing)
    with pytest.raises(ValueError):
        TurnRequest.model_validate({**modern, "acknowledge_query_processing": "true"})


def test_turn_dispatch_preserves_old_defaults_and_explicit_new_default_identity():
    from api.routers.evidence import TurnRequest

    legacy = {
        "notebook_id": "notebook:synthetic",
        "engine": "independent",
        "message": "question",
        "idempotency_key": "key",
    }
    omitted = TurnRequest.model_validate(legacy).dispatch_payload()
    assert omitted["selection_origin"] == "local"
    assert omitted["task"] == "question"
    assert omitted["model_id"] is None
    assert "retrieval_mode" not in omitted
    explicit = TurnRequest.model_validate(
        {**legacy, "retrieval_mode": "lexical", "acknowledge_query_processing": False}
    ).dispatch_payload()
    assert explicit["retrieval_mode"] == "lexical"
    assert explicit["acknowledge_query_processing"] is False
    assert explicit != omitted
