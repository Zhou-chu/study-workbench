from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_provider_failure_never_mutates_index(monkeypatch):
    from commands import embedding_commands as commands

    monkeypatch.setattr(
        commands.Source,
        "get",
        AsyncMock(return_value=SimpleNamespace(full_text="text", asset=None)),
    )
    monkeypatch.setattr(
        commands,
        "generate_embeddings",
        AsyncMock(side_effect=ConnectionError("provider")),
    )
    write = AsyncMock()
    monkeypatch.setattr(commands, "repo_query", write)
    with pytest.raises(ConnectionError):
        await commands.embed_source_command(
            commands.EmbedSourceInput(source_id="source:test")
        )
    write.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [None, {}, {"result": []}, {"result": [{"status": "OK", "result": None}]}],
)
async def test_missing_publication_ack_is_unknown(monkeypatch, response):
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(query_raw=AsyncMock(return_value=response))

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(repo.EmbeddingOutcomeUnknown):
        await repo._publish(
            "RETURN $receipt;", {"receipt": {"token": "test"}}, {"token": "test"}
        )


@pytest.mark.asyncio
async def test_payload_budget_checked_before_connect(monkeypatch):
    from open_notebook.database import embedding_repository as repo

    monkeypatch.setattr(repo, "MAX_PUBLICATION_BYTES", 10)
    connection = AsyncMock()
    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(ValueError, match="budget"):
        await repo.publish_source_embeddings(
            "source:test",
            "text",
            None,
            None,
            [{"content": "chunk", "embedding": [1.0], "order": 0}],
        )
    connection.assert_not_called()


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
    "rows,exception",
    [
        (
            [
                {"status": "OK", "result": {"token": "test"}},
                {"status": "ERR", "result": "commit failed"},
                {"status": "OK", "result": {"token": "test"}},
            ],
            "unknown",
        ),
        (
            [
                {"status": "OK", "result": {"token": "test"}},
                {"status": "OK", "result": {"token": "wrong"}},
            ],
            "unknown",
        ),
        ([{"status": "ERR", "result": "EMBEDDING_STALE"}], "unknown"),
    ],
)
async def test_publication_checks_all_acknowledgements(monkeypatch, rows, exception):
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(query_raw=AsyncMock(return_value={"result": rows}))

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(
        repo.EmbeddingOutcomeUnknown if exception == "unknown" else exception
    ):
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})


@pytest.mark.asyncio
async def test_cancelled_publication_propagates_without_compensation(monkeypatch):
    import asyncio

    from open_notebook.database import embedding_repository as repo

    query = AsyncMock(side_effect=asyncio.CancelledError())

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(query_raw=query)

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(asyncio.CancelledError):
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})
    assert query.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        {"error": {"message": "unclassified RPC failure"}},
        {
            "result": [
                {"status": "OK", "result": None},
                {"status": "OK", "result": {"token": "test"}},
                {"status": "OK", "result": {"token": "test"}},
            ]
        },
    ],
)
async def test_unrecognized_rpc_ack_never_allows_replay(monkeypatch, response):
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(query_raw=AsyncMock(return_value=response))

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(repo.EmbeddingOutcomeUnknown):
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})


@pytest.mark.asyncio
async def test_error_after_transaction_receipt_is_unknown(monkeypatch):
    from open_notebook.database import embedding_repository as repo

    @asynccontextmanager
    async def connection():
        yield SimpleNamespace(
            query_raw=AsyncMock(
                return_value={
                    "result": [
                        {"status": "OK", "result": {"token": "test"}},
                        {"status": "ERR", "result": "post-commit statement failed"},
                    ]
                }
            )
        )

    monkeypatch.setattr(repo, "db_connection", connection)
    with pytest.raises(repo.EmbeddingOutcomeUnknown):
        await repo._publish("RETURN $receipt;", {}, {"token": "test"})


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
@pytest.mark.parametrize("count,allowed", [(2000, True), (2001, False)])
async def test_chunk_budget_boundary(monkeypatch, count, allowed):
    from open_notebook.database import embedding_repository as repo

    publish = AsyncMock()
    monkeypatch.setattr(repo, "_publish", publish)
    records = [{"content": "x", "embedding": [1.0]}] * count
    if allowed:
        await repo.publish_source_embeddings("source:test", "x", None, None, records)
        assert len(publish.call_args.args[1]["records"]) == count
    else:
        with pytest.raises(ValueError, match="chunk budget"):
            await repo.publish_source_embeddings(
                "source:test", "x", None, None, records
            )
        publish.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "vectors",
    [
        [[]],
        [[float("nan")]],
        [[float("inf")]],
        [[float("-inf")]],
        [[True]],
        [["1"]],
        [[1.0], [1.0, 2.0]],
    ],
)
async def test_invalid_vectors_never_publish(monkeypatch, vectors):
    from open_notebook.database import embedding_repository as repo

    publish = AsyncMock()
    monkeypatch.setattr(repo, "_publish", publish)
    with pytest.raises(ValueError):
        await repo.publish_source_embeddings(
            "source:test",
            "x",
            None,
            None,
            [{"content": "x", "embedding": vector} for vector in vectors],
        )
    publish.assert_not_awaited()


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
