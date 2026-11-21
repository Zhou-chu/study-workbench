"""Transaction construction/acknowledgment units, never a real DB atomicity test."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from surrealdb import RecordID

from api.personal_store import record_key
from api.portable_service import CommitOutcomeUnknown, SurrealProjectRepository
from open_notebook.database import repository
from open_notebook.exceptions import DatabaseOperationError


@pytest.fixture
def transaction(monkeypatch):
    project = {
        "notebook": {
            "id": "notebook:new",
            "name": "title'; DELETE notebook;",
            "description": None,
            "archived": False,
            "unexpected": "discard",
        },
        "sources": [
            {
                "id": "source:new",
                "asset": {"file_path": "restored/synthetic"},
                "title": "source",
                "topics": [],
                "full_text": "body",
                "unexpected": "discard",
            }
        ],
        "notes": [
            {
                "id": "note:new",
                "title": "note",
                "content": "text",
                "note_type": "human",
                "revision": 3,
                "embedding": [99],
            }
        ],
        "chat_sessions": [
            {"id": "chat_session:source", "title": "chat", "parent_id": "source:new"},
            {"id": "chat_session:notebook", "title": "default"},
        ],
        "source_insights": [
            {
                "id": "source_insight:new",
                "source": "source:new",
                "insight_type": "summary",
                "content": "quote",
                "embedding": [99],
            },
            {"id": "source_insight:empty", "source": "source:new"},
        ],
    }
    records = [("job", "job_new", {"job_id": "job_new", "state": "cancelled_local"})]
    events = []
    query = AsyncMock(return_value={"result": [{"status": "OK"}]})
    faults: dict[str, BaseException] = {}

    @asynccontextmanager
    async def connection():
        events.append("enter")
        if "enter" in faults:
            raise faults["enter"]
        try:
            yield SimpleNamespace(query_raw=query)
        finally:
            events.append("exit")
        if "exit" in faults:
            raise faults["exit"]

    monkeypatch.setattr(repository, "db_connection", connection)
    return SimpleNamespace(
        target=SurrealProjectRepository(object()),
        project=project,
        records=records,
        query=query,
        faults=faults,
        events=events,
    )


@pytest.mark.asyncio
async def test_transaction_binds_whitelisted_values_and_exact_relationship_directions(
    transaction,
):
    s = transaction
    before = deepcopy((s.project, s.records))
    assert await s.target.commit(s.project, s.records) is None
    assert (s.project, s.records) == before
    s.query.assert_awaited_once()
    sql, params = s.query.await_args.args
    assert sql.splitlines() == [
        "BEGIN TRANSACTION;",
        "CREATE $r0 CONTENT $v0;",
        "CREATE $r2 CONTENT $v2;",
        "RELATE $f4->reference->$t4;",
        "CREATE $r6 CONTENT $v6;",
        "RELATE $f8->artifact->$t8;",
        "CREATE $r10 CONTENT $v10;",
        "RELATE $f12->refers_to->$t12;",
        "CREATE $r14 CONTENT $v14;",
        "RELATE $f16->refers_to->$t16;",
        "CREATE $r18 CONTENT $v18;",
        "CREATE $r20 CONTENT $v20;",
        "CREATE $r22 CONTENT $v22;",
        "COMMIT TRANSACTION;",
    ]
    expected = {
        "r0": RecordID.parse("notebook:new"),
        "v0": {"name": "title'; DELETE notebook;", "archived": False},
        "r2": RecordID.parse("source:new"),
        "v2": {
            "asset": {"file_path": "restored/synthetic"},
            "title": "source",
            "topics": [],
            "full_text": "body",
        },
        "f4": RecordID.parse("source:new"),
        "t4": RecordID.parse("notebook:new"),
        "r6": RecordID.parse("note:new"),
        "v6": {"title": "note", "content": "text", "note_type": "human", "revision": 3},
        "f8": RecordID.parse("note:new"),
        "t8": RecordID.parse("notebook:new"),
        "r10": RecordID.parse("chat_session:source"),
        "v10": {"title": "chat"},
        "f12": RecordID.parse("chat_session:source"),
        "t12": RecordID.parse("source:new"),
        "r14": RecordID.parse("chat_session:notebook"),
        "v14": {"title": "default"},
        "f16": RecordID.parse("chat_session:notebook"),
        "t16": RecordID.parse("notebook:new"),
        "r18": RecordID.parse("source_insight:new"),
        "v18": {
            "source": RecordID.parse("source:new"),
            "insight_type": "summary",
            "content": "quote",
            "embedding": [],
        },
        "r20": RecordID.parse("source_insight:empty"),
        "v20": {
            "source": RecordID.parse("source:new"),
            "insight_type": "restored",
            "content": "",
            "embedding": [],
        },
        "r22": RecordID.parse(record_key("job", "job_new")),
        "v22": {
            "app_id": "job_new",
            "payload": {"job_id": "job_new", "state": "cancelled_local"},
        },
    }
    assert params == expected
    assert "DELETE notebook" not in sql and "restored/synthetic" not in sql
    assert s.events == ["enter", "exit"]


@pytest.mark.asyncio
async def test_minimal_project_has_one_create_and_no_unrequested_relations(transaction):
    s = transaction
    for key in ("sources", "notes", "chat_sessions", "source_insights"):
        s.project[key] = []
    await s.target.commit(s.project, [])
    sql, params = s.query.await_args.args
    assert sql.splitlines() == [
        "BEGIN TRANSACTION;",
        "CREATE $r0 CONTENT $v0;",
        "COMMIT TRANSACTION;",
    ]
    assert set(params) == {"r0", "v0"}


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [None, [], {}, {"result": []}])
async def test_absent_acknowledgment_is_unknown_not_retry_safe(transaction, response):
    s = transaction
    s.query.return_value = response
    with pytest.raises(CommitOutcomeUnknown, match="no acknowledgement"):
        await s.target.commit(s.project, s.records)
    assert s.query.await_count == 1
    assert s.events == ["enter", "exit"]


@pytest.mark.asyncio
async def test_explicit_error_among_success_results_is_rejection(transaction):
    s = transaction
    s.query.return_value = {
        "result": [
            {"status": "OK"},
            {"status": "ERR", "result": "synthetic-secret"},
            {"status": "OK"},
        ]
    }
    with pytest.raises(
        DatabaseOperationError, match="rejected and rolled back"
    ) as caught:
        await s.target.commit(s.project, s.records)
    assert not isinstance(caught.value, CommitOutcomeUnknown)
    assert "synthetic-secret" not in str(caught.value)
    assert s.query.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["enter", "query", "exit"])
async def test_connection_or_query_failure_has_unknown_commit_outcome(
    transaction, phase
):
    s = transaction
    failure = RuntimeError("synthetic-secret")
    if phase == "query":
        s.query.side_effect = failure
    else:
        s.faults[phase] = failure
    with pytest.raises(CommitOutcomeUnknown, match="Do not blindly retry") as caught:
        await s.target.commit(s.project, s.records)
    assert caught.value.__cause__ is failure
    assert "synthetic-secret" not in str(caught.value)
    assert s.query.await_count == (0 if phase == "enter" else 1)


@pytest.mark.asyncio
async def test_cancellation_after_dispatch_is_unknown_not_a_rollback_claim(transaction):
    s = transaction
    cancellation = asyncio.CancelledError()
    s.query.side_effect = cancellation
    with pytest.raises(CommitOutcomeUnknown) as caught:
        await s.target.commit(s.project, s.records)
    assert caught.value.__cause__ is cancellation
    assert "immutable files retained" in str(caught.value)
    assert s.events == ["enter", "exit"]
    assert s.query.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        "unexpected",
        {"status": "OK"},
        ({"status": "OK"},),
        7,
        [None],
        [7],
        ["OK"],
        [{}],
        [{"status": None}],
        [{"status": "PENDING"}],
        [{"status": ["OK"]}],
        [{"status": {"value": "OK"}}],
        [{"status": "ERR"}, {}],
        [{}, {"status": "ERR"}],
        [{"status": "ERR"}, {"status": "PENDING"}],
    ],
)
async def test_malformed_nonempty_ack_is_unknown_even_when_another_row_is_err(
    transaction, result
):
    s = transaction
    s.query.return_value = {"result": result}
    with pytest.raises(CommitOutcomeUnknown):
        await s.target.commit(s.project, s.records)
    assert s.query.await_count == 1
    assert s.events == ["enter", "exit"]
