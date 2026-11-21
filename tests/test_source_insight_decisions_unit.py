"""Direct source insight/manage decisions; persistence and enqueue are replaced."""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from api.models import CreateSourceInsightRequest
from api.routers import sources as module
from open_notebook.exceptions import CommandSubmissionUnknownError, InvalidInputError


@pytest.fixture
def setup(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    source = SimpleNamespace(
        full_text="Saved substantive text",
        get_insights=AsyncMock(return_value=[]),
        delete=AsyncMock(),
    )
    get = AsyncMock(return_value=source)
    transformation = AsyncMock(return_value=SimpleNamespace(id="transformation:one"))
    submit = AsyncMock(return_value="command:one")
    monkeypatch.setattr(module.Source, "get", get)
    monkeypatch.setattr(module.Transformation, "get", transformation)
    monkeypatch.setattr(module, "submit_command", submit)
    return SimpleNamespace(
        source=source,
        get=get,
        transformation=transformation,
        submit=submit,
        request=CreateSourceInsightRequest(transformation_id="transformation:one"),
    )


@pytest.mark.asyncio
async def test_missing_source_prevents_transformation_lookup_and_queue(
    setup: SimpleNamespace,
) -> None:
    s = setup
    s.get.return_value = None
    with pytest.raises(HTTPException) as error:
        await module.create_source_insight("source:one", s.request)
    assert (error.value.status_code, error.value.detail) == (404, "Source not found")
    s.transformation.assert_not_awaited()
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [None, "", " \n\t"])
async def test_no_substantive_text_never_queues_generation(
    setup: SimpleNamespace, content: str | None
) -> None:
    s = setup
    s.source.full_text = content
    with pytest.raises(InvalidInputError, match="Source has no text content"):
        await module.create_source_insight("source:one", s.request)
    s.transformation.assert_not_awaited()
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_transformation_never_submits(setup: SimpleNamespace) -> None:
    s = setup
    s.transformation.return_value = None
    with pytest.raises(HTTPException) as error:
        await module.create_source_insight("source:one", s.request)
    assert (error.value.status_code, error.value.detail) == (
        404,
        "Transformation not found",
    )
    s.transformation.assert_awaited_once_with("transformation:one")
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["Saved substantive text", "\n 中文正文 \n"])
async def test_generation_returns_pending_receipt_without_running_model(
    setup: SimpleNamespace, content: str
) -> None:
    s = setup
    s.source.full_text = content
    result = await module.create_source_insight("source:one", s.request)
    assert result.model_dump() == {
        "status": "pending",
        "message": "Insight generation started",
        "source_id": "source:one",
        "transformation_id": "transformation:one",
        "command_id": "command:one",
    }
    s.get.assert_awaited_once_with("source:one")
    s.transformation.assert_awaited_once_with("transformation:one")
    s.submit.assert_awaited_once_with(
        "open_notebook",
        "run_transformation",
        {"source_id": "source:one", "transformation_id": "transformation:one"},
    )
    assert s.source.full_text == content
    s.source.get_insights.assert_not_awaited()


@pytest.mark.asyncio
async def test_uncertain_submission_keeps_command_identity_and_no_replay(
    setup: SimpleNamespace,
) -> None:
    s = setup
    error = CommandSubmissionUnknownError(command_id="command:uncertain")
    s.submit.side_effect = error
    with pytest.raises(CommandSubmissionUnknownError) as caught:
        await module.create_source_insight("source:one", s.request)
    assert caught.value is error
    assert error.source_id == "source:one" and error.command_id == "command:uncertain"
    assert s.submit.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["get", "transformation", "submit"])
async def test_cancelled_generation_preserves_exception_and_no_further_work(
    setup: SimpleNamespace, boundary: str
) -> None:
    s = setup
    error = asyncio.CancelledError("cancelled")
    getattr(s, boundary).side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await module.create_source_insight("source:one", s.request)
    assert caught.value is error
    if boundary == "get":
        s.transformation.assert_not_awaited()
    if boundary != "submit":
        s.submit.assert_not_awaited()
    else:
        s.submit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["transformation", "submit"])
async def test_unexpected_late_generation_failure_is_not_a_pending_receipt(
    setup: SimpleNamespace, boundary: str
) -> None:
    s = setup
    getattr(s, boundary).side_effect = OSError("synthetic private diagnostics")
    with pytest.raises(HTTPException) as caught:
        await module.create_source_insight("source:one", s.request)
    assert (caught.value.status_code, caught.value.detail) == (
        500,
        "Error starting insight generation",
    )
    if boundary == "transformation":
        s.submit.assert_not_awaited()
    else:
        s.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_domain_generation_failure_preserves_domain_error(
    setup: SimpleNamespace,
) -> None:
    s = setup
    error = InvalidInputError("invalid transformation")
    s.transformation.side_effect = error
    with pytest.raises(InvalidInputError) as caught:
        await module.create_source_insight("source:one", s.request)
    assert caught.value is error
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_insight_projection_preserves_order_dates_and_optional_defaults(
    setup: SimpleNamespace,
) -> None:
    s = setup
    stamp = datetime(2024, 1, 2, tzinfo=timezone.utc)
    s.source.get_insights.return_value = [
        SimpleNamespace(
            id="insight:one",
            insight_type="summary",
            content="First",
            created=stamp,
            updated=stamp,
        ),
        SimpleNamespace(
            id=None, insight_type="notes", content="Second", created=None, updated=None
        ),
    ]
    result = await module.get_source_insights("source:one")
    assert [r.model_dump() for r in result] == [
        {
            "id": "insight:one",
            "source_id": "source:one",
            "insight_type": "summary",
            "content": "First",
            "created": stamp.isoformat(),
            "updated": stamp.isoformat(),
        },
        {
            "id": "",
            "source_id": "source:one",
            "insight_type": "notes",
            "content": "Second",
            "created": None,
            "updated": None,
        },
    ]
    s.source.get_insights.assert_awaited_once_with()
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_insights_returns_empty_list_without_generation(
    setup: SimpleNamespace,
) -> None:
    s = setup
    assert await module.get_source_insights("source:one") == []
    s.source.get_insights.assert_awaited_once_with()
    s.submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,boundary,detail",
    [
        ("get_source_insights", "get_insights", "Error fetching insights"),
        ("delete_source", "delete", "Error deleting source"),
    ],
)
async def test_downstream_storage_failure_is_not_success(
    setup: SimpleNamespace, method: str, boundary: str, detail: str
) -> None:
    s = setup
    getattr(s.source, boundary).side_effect = OSError("synthetic internal details")
    with pytest.raises(HTTPException) as error:
        await getattr(module, method)("source:one")
    assert (error.value.status_code, error.value.detail) == (500, detail)
    getattr(s.source, boundary).assert_awaited_once_with()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,boundary",
    [("get_source_insights", "get_insights"), ("delete_source", "delete")],
)
async def test_downstream_cancel_is_not_translated_to_http_success(
    setup: SimpleNamespace, method: str, boundary: str
) -> None:
    s = setup
    error = asyncio.CancelledError("cancelled")
    getattr(s.source, boundary).side_effect = error
    with pytest.raises(asyncio.CancelledError) as caught:
        await getattr(module, method)("source:one")
    assert caught.value is error
    getattr(s.source, boundary).assert_awaited_once_with()


@pytest.mark.asyncio
async def test_delete_ack_only_after_domain_delete_returns(
    setup: SimpleNamespace,
) -> None:
    s = setup
    assert await module.delete_source("source:one") == {
        "message": "Source deleted successfully"
    }
    s.get.assert_awaited_once_with("source:one")
    s.source.delete.assert_awaited_once_with()
    s.submit.assert_not_awaited()
