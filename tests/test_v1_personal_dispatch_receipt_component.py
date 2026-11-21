"""OpenAPI response contracts and portable remap through real public DTOs."""

from copy import deepcopy
from typing import Any

import pytest
from personal_dispatch_receipt_fixtures import FIXTURE
from test_v1_evidence_ingest import MemoryStore

from api.personal_service import PersonalService


def test_turn_error_schema_documents_strict_generation_not_retained_data():
    from api.main import app

    schema = app.openapi()
    operation = schema["paths"]["/api/personal/chats/{chat_session_id}/turns"]["post"]
    assert "400" in operation["responses"]
    from pydantic import ValidationError

    from api.personal_contracts import PersonalTurnDispatchUnknownResponse

    error = PersonalTurnDispatchUnknownResponse.model_validate(FIXTURE["body"])
    assert error.model_dump() == FIXTURE["body"]
    for bad in [
        {**FIXTURE["body"]["dispatch_receipt"], "retry_safe": True},
        {**FIXTURE["body"]["dispatch_receipt"], "dispatch_ack": "rejected"},
        {**FIXTURE["body"]["dispatch_receipt"], "private": "not_public"},
    ]:
        with pytest.raises(ValidationError):
            PersonalTurnDispatchUnknownResponse.model_validate(
                {"detail": "WORKER_UNAVAILABLE", "dispatch_receipt": bad}
            )
    retained = schema["components"]["schemas"]["TurnSubmissionResponse"]
    assert "dispatch_receipt" in retained["properties"]
    assert "dispatch_receipt" not in retained["required"]
    assert "$ref" not in retained["properties"]["dispatch_receipt"]
    generated = schema["components"]["schemas"]["PersonalTurnDispatchReceipt"]
    assert generated["additionalProperties"] is False
    assert generated["properties"]["retry_safe"]["const"] is False


@pytest.mark.asyncio
async def test_archive_remaps_nested_receipt_ids_without_replay(tmp_path):
    from pydantic import TypeAdapter

    from api.personal_contracts import PersonalJobResponse
    from api.portable_service import FILES, PortableService

    project: dict[str, Any] = {kind: [] for kind in FILES}
    project["notebook"] = {"id": "notebook:synthetic"}
    project["turn"] = [{"turn_id": "turn_old", "notebook_id": "notebook:synthetic"}]
    receipt = {
        "dispatch_ack": "unknown",
        "job_id": "job_old",
        "turn_id": "turn_old",
        "retry_safe": False,
        "future": ["retained"],
    }
    project["job"] = [
        {
            "job_id": "job_old",
            "turn_id": "turn_old",
            "notebook_id": "notebook:synthetic",
            "state": "failed",
            "dispatch_receipt": deepcopy(receipt),
        }
    ]
    store = MemoryStore()
    restored, mapping = PortableService(store=store, data_root=tmp_path)._remap(
        project, "restored/synthetic"
    )
    job = restored["job"][0]
    assert job["dispatch_receipt"] == {
        **receipt,
        "job_id": mapping["job_old"],
        "turn_id": mapping["turn_old"],
    }
    assert job["historical_state"] == "failed"
    assert job["restored_history"] is True
    assert job["replay_allowed"] is False
    adapter: TypeAdapter[Any] = TypeAdapter(PersonalJobResponse)
    assert (
        adapter.dump_python(
            adapter.validate_python(job), mode="json", exclude_unset=True
        )
        == job
    )
    await store.put("job", job["job_id"], job)
    assert await PersonalService(store=store).run_turn(job["job_id"]) == job
