"""Check publication error policy against the actual retry SDK and Tenacity."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.mark.parametrize(
    "error,retry", [(ConnectionError("retry"), True), (RuntimeError("conflict"), True)]
)
def test_ordinary_failures_remain_retryable(error, retry):
    from surreal_commands.core.retry import RetryConfig, _build_retry_condition
    from tenacity import RetryCallState, Retrying

    from commands.embedding_commands import EMBED_RETRY_CONFIG

    state = RetryCallState(Retrying(), None, (), {})
    state.set_exception((type(error), error, None))
    assert _build_retry_condition(RetryConfig(**EMBED_RETRY_CONFIG))(state) is retry


def test_cancellation_and_unknown_are_not_retried():
    import asyncio

    from surreal_commands.core.retry import RetryConfig, _build_retry_condition
    from tenacity import RetryCallState, Retrying

    from commands.embedding_commands import EMBED_RETRY_CONFIG
    from open_notebook.database.embedding_repository import EmbeddingOutcomeUnknown

    predicate = _build_retry_condition(RetryConfig(**EMBED_RETRY_CONFIG))
    for error in (asyncio.CancelledError(), EmbeddingOutcomeUnknown()):
        state = RetryCallState(Retrying(), None, (), {})
        state.set_exception((type(error), error, None))
        assert predicate(state) is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows",
    [
        [{"status": "ERR", "result": "transaction failed"}],
        [{"status": "ERR", "result": "EMBEDDING_STALE"}],
        [
            {"status": "OK", "result": {"token": "WRONG"}},
            {"status": "ERR", "result": "post-commit statement failed"},
        ],
        [
            {"status": "OK", "result": None},
            {"status": "ERR", "result": "transaction failed"},
            {"status": "OK", "result": {"token": "test"}},
        ],
        [
            {"status": "ERR", "result": "transaction failed"},
            {"status": "OK", "result": {"token": "WRONG"}},
        ],
    ],
)
async def test_incomplete_or_unrecognized_abort_is_exactly_unknown_and_nonretryable(
    monkeypatch, rows
):
    from surreal_commands.core.retry import RetryConfig, _build_retry_condition
    from tenacity import RetryCallState, Retrying

    from commands.embedding_commands import EMBED_RETRY_CONFIG
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(query_raw=AsyncMock(return_value={"result": rows}))

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(Exception) as caught:
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})
    assert type(caught.value) is repo.EmbeddingOutcomeUnknown
    state = RetryCallState(Retrying(), None, (), {})
    state.set_exception((type(caught.value), caught.value, None))
    assert _build_retry_condition(RetryConfig(**EMBED_RETRY_CONFIG))(state) is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,expected",
    [("transaction conflict", RuntimeError), ("EMBEDDING_STALE", ValueError)],
)
async def test_complete_abort_is_classified_only_after_terminal_ack(
    monkeypatch, error, expected
):
    from surreal_commands.core.retry import RetryConfig, _build_retry_condition
    from tenacity import RetryCallState, Retrying

    from commands.embedding_commands import EMBED_RETRY_CONFIG
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(
            query_raw=AsyncMock(
                return_value={
                    "result": [
                        {"status": "ERR", "result": error},
                        {"status": "OK", "result": {"token": "test"}},
                    ]
                }
            )
        )

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(Exception) as caught:
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})
    assert type(caught.value) is expected
    state = RetryCallState(Retrying(), None, (), {})
    state.set_exception((type(caught.value), caught.value, None))
    assert _build_retry_condition(RetryConfig(**EMBED_RETRY_CONFIG))(state) is (
        expected is RuntimeError
    )
