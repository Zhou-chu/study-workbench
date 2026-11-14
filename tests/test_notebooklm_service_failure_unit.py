"""NotebookLM service units with memory-only I/O stubs, never PersonalStore/SDK."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from api import notebooklm_service as m
from open_notebook.integrations.notebooklm.contracts import BridgeError

pytestmark = pytest.mark.asyncio


@pytest.fixture
def service(monkeypatch):
    rows = {}
    locks = []

    @asynccontextmanager
    async def lock(key):
        locks.append(key)
        yield

    async def get(kind, key):
        return deepcopy(rows.get((kind, key)))

    async def put(kind, key, value, **kwargs):
        rows[kind, key] = deepcopy(value)

    store = NS(
        get=AsyncMock(side_effect=get),
        put=AsyncMock(side_effect=put),
        list=AsyncMock(return_value=[]),
        project_lock=lock,
    )
    bridge = NS(
        list_sources=AsyncMock(),
        verify_connection=AsyncMock(return_value=NS(state="connected")),
        capabilities=AsyncMock(),
    )
    monkeypatch.setattr(m, "now", lambda: "2026-01-01T00:00:00+00:00")
    return NS(
        s=m.NotebookLMService(
            store=store, bridge=bridge, enqueue=None, evidence=object()
        ),
        store=store,
        bridge=bridge,
        rows=rows,
        locks=locks,
    )


def seed(service, operation="audio", state="waiting_remote"):
    job = {
        "job_id": "j",
        "provider": "notebooklm",
        "notebook_id": "n",
        "operation": operation,
        "state": state,
        "submission_state": "confirmed",
        "remote_task_id": "task",
        "attempts": 0,
        "poll_attempts": 0,
        "request_snapshot": {"remote_notebook_id": "remote"},
    }
    service.rows["job", "j"] = deepcopy(job)
    return job


@pytest.mark.parametrize(
    "error,state",
    [
        (BridgeError("NEEDS_REAUTH", "reauth"), "needs_reauth"),
        (BridgeError("REMOTE_UNAVAILABLE", "temporary"), "waiting_remote"),
    ],
)
async def test_poll_error_preserves_confirmed_remote_identity(service, error, state):
    seed(service)
    service.bridge.get_artifact = AsyncMock(side_effect=error)
    result = await service.s.poll_job("j")
    assert result["state"] == state and result["error"]["code"] == error.code
    assert (
        result["submission_state"] == "confirmed" and result["remote_task_id"] == "task"
    )
    assert result["poll_attempts"] == 1


async def test_poll_cancel_is_not_converted_to_retry_or_failure(service):
    seed(service)
    service.bridge.get_artifact = AsyncMock(side_effect=asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await service.s.poll_job("j")
    saved = service.rows["job", "j"]
    assert saved["submission_state"] == "confirmed" and saved["state"] == "running"
    assert "error" not in saved


@pytest.mark.parametrize("status", ["failed", "processing"])
async def test_poll_remote_outcome_without_new_submission(service, status):
    seed(service)
    service.bridge.get_artifact = AsyncMock(return_value=NS(status=status))
    result = await service.s.poll_job("j")
    if status == "failed":
        assert (
            result["state"] == "failed"
            and result["error"]["code"] == "REMOTE_GENERATION_FAILED"
        )
    else:
        assert result["state"] == "waiting_remote" and result["next_poll_at"]
    assert result["remote_task_id"] == "task" and result["attempts"] == 0


async def test_download_failure_retains_successful_remote_audio(service):
    seed(service)
    service.bridge.get_artifact = AsyncMock(
        return_value=NS(
            status="ready", model_dump=lambda: {"id": "task", "status": "ready"}
        )
    )
    # File download is a separate I/O unit, not exercised by these service units.
    service.s._download = AsyncMock(
        side_effect=BridgeError("DOWNLOAD_FAILED", "synthetic")
    )
    result = await service.s.poll_job("j")
    assert result["state"] == "succeeded" and result["submission_state"] == "confirmed"
    assert result["result"]["downloaded"] is False
    assert result["result"]["artifact"]["id"] == "task"
    assert result["result"]["download_error"]["code"] == "DOWNLOAD_FAILED"


@pytest.mark.parametrize(
    "result,error", [(NS(), "REMOTE_SCHEMA_CHANGED"), (None, "NEEDS_REAUTH")]
)
async def test_write_refuses_disconnected_or_missing_remote_identity(
    service, result, error
):
    job = seed(service, "create_notebook", "running")
    job["submission_state"] = "not_submitted"
    service.rows["job", "j"] = deepcopy(job)
    operation = AsyncMock(return_value=result)
    if result is None:
        service.rows["connection", "notebooklm"] = {"disabled": True}
    with pytest.raises(BridgeError) as caught:
        await service.s._write(job, operation)
    assert caught.value.code == error
    assert service.rows["job", "j"]["submission_state"] == "unknown"
    if result is None:
        operation.assert_not_awaited()


async def test_write_cancel_preserves_unknown_intent_without_replay(service):
    job = seed(service, "create_notebook", "running")
    operation = AsyncMock(side_effect=asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await service.s._write(job, operation)
    assert service.rows["job", "j"]["submission_state"] == "unknown"
    assert not any(k[0] == "source_link" for k in service.rows)


@pytest.mark.parametrize(
    "submission,error,expected",
    [
        (
            "unknown",
            BridgeError("LOST", "lost", submission_state="unknown"),
            "submission_unknown",
        ),
        ("not_submitted", BridgeError("NEEDS_REAUTH", "login"), "needs_reauth"),
        ("confirmed", BridgeError("REMOTE_UNAVAILABLE", "retry"), "failed"),
    ],
)
async def test_failure_projection_preserves_confirmed_submission(
    service, submission, error, expected
):
    job = seed(service)
    job["submission_state"] = submission
    service.rows["job", "j"] = deepcopy(job)
    await service.s._fail(job, error)
    assert job["state"] == expected and job["error"]["code"] == error.code
    if submission == "confirmed":
        assert job["submission_state"] == "confirmed"


def reference(source="r", quote="needle"):
    return NS(
        remote_source_id=source,
        quote=quote,
        model_dump=lambda: {"remote_source_id": source, "quote": quote},
    )


def scope():
    return {
        "remote_source_ids": ["r"],
        "source_version_ids": ["v"],
        "scope_snapshot": {
            "mappings": [
                {
                    "remote_source_id": "r",
                    "source_version_id": "v",
                    "source_link_id": "link",
                }
            ]
        },
    }


@pytest.mark.parametrize(
    "mode",
    [
        "outside",
        "no_quote",
        "no_mapping",
        "duplicate",
        "no_link",
        "stale",
        "wrong_version",
        "no_match",
        "multiple",
        "repeated",
        "verified",
    ],
)
async def test_reference_mapping_requires_current_unique_exact_evidence(service, mode):
    req = scope()
    ref = reference()
    if mode == "outside":
        ref = reference(source="other")
    if mode == "no_quote":
        ref = reference(quote="")
    if mode == "no_mapping":
        req["scope_snapshot"]["mappings"] = []
    if mode == "duplicate":
        req["scope_snapshot"]["mappings"] *= 2
    if mode == "no_link":
        req["scope_snapshot"]["mappings"][0].pop("source_link_id")
    current = {"mapping_status": "verified", "source_version_id": "v"}
    if mode == "stale":
        current["mapping_status"] = "stale"
    if mode == "wrong_version":
        current["source_version_id"] = "else"
    service.rows["source_link", "link"] = current
    evidence = [{"evidence_id": "e", "quote": "one needle here"}]
    if mode == "no_match":
        evidence = []
    if mode == "multiple":
        evidence *= 2
    if mode == "repeated":
        evidence[0]["quote"] = "needle needle"
    validated = {"evidence_id": "e", "reference_validity": "verified"}
    service.s.evidence = NS(
        list_evidence=AsyncMock(return_value=evidence),
        validate_citation=AsyncMock(return_value=validated),
    )
    result = await service.s.map_reference(req, ref, 2)
    if mode == "verified":
        assert result == {**validated, "remote_reference": ref.model_dump()}
        args = service.s.evidence.validate_citation.await_args.args
        assert args[0]["evidence_id"] == "e" and args[1] == ["v"]
    else:
        assert result["reference_validity"] == (
            "out_of_scope" if mode == "outside" else "unverified"
        )
        service.s.evidence.validate_citation.assert_not_awaited()


@pytest.mark.parametrize(
    "mode",
    [
        "metadata",
        "missing",
        "empty",
        "fetch_failure",
        "existing_snapshot",
        "new_snapshot",
        "cancelled",
    ],
)
async def test_import_metadata_and_snapshot_failure_boundaries(service, mode):
    job = seed(service, "import", "running")
    job["request_snapshot"].update(
        remote_source_ids=["r"], include_text=mode != "metadata"
    )
    service.rows["job", "j"] = deepcopy(job)
    row = NS(
        id="r", status="ready", model_dump=lambda: {"id": "r", "title": "Synthetic"}
    )
    service.bridge.list_sources.return_value = NS(
        items=[] if mode == "missing" else [row],
        next_cursor=None,
        listing_complete=True,
    )
    service.bridge.fetch_source_text = AsyncMock(
        return_value=NS(
            content="" if mode == "empty" else "Synthetic text", title="Synthetic"
        )
    )
    if mode == "fetch_failure":
        service.bridge.fetch_source_text.side_effect = BridgeError(
            "REMOTE_UNAVAILABLE", "synthetic"
        )
    if mode == "cancelled":
        service.bridge.fetch_source_text.side_effect = asyncio.CancelledError()
    service.s.ensure_native_source = AsyncMock()  # Native DB I/O boundary.
    service.s.evidence = NS(
        ingest=AsyncMock(return_value={"source_version_id": "new"}), extract=AsyncMock()
    )
    if mode == "existing_snapshot":
        service.store.list.return_value = [{"source_version_id": "existing"}]
    if mode == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await service.s._import(job)
        assert ("import_report", "report_j") not in service.rows
        return
    await service.s._import(job)
    report = service.rows["import_report", "report_j"]
    assert job["state"] == "succeeded" and report["pagination_complete"] is True
    if mode in {"missing", "empty", "fetch_failure"}:
        expected = {
            "missing": "REMOTE_SOURCE_MISSING",
            "empty": "EMPTY_REMOTE_TEXT",
            "fetch_failure": "REMOTE_UNAVAILABLE",
        }[mode]
        assert report["failed"] == [{"remote_source_id": "r", "code": expected}]
        assert report["imported"] == []
    else:
        assert report["imported"] == ["r"] and report["missing_originals"] == ["r"]
    if mode == "metadata":
        service.bridge.fetch_source_text.assert_not_awaited()
    if mode in {"existing_snapshot", "new_snapshot"}:
        service.s.evidence.extract.assert_awaited_once_with(
            "existing" if mode == "existing_snapshot" else "new"
        )
        if mode == "existing_snapshot":
            service.s.evidence.ingest.assert_not_awaited()
        else:
            kwargs = service.s.evidence.ingest.await_args.kwargs
            assert (
                kwargs["origin"] == "remote_text_snapshot"
                and kwargs["original_status"] == "missing"
            )
