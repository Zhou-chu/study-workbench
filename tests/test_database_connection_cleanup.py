"""Exercise the real context manager without loading runtime configuration."""

import ast
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest


def load_connection(db):
    path = Path(__file__).parents[1] / "open_notebook/database/repository.py"
    tree = ast.parse(path.read_text())
    node = next(
        item for item in tree.body if getattr(item, "name", None) == "db_connection"
    )
    namespace = {
        "asynccontextmanager": asynccontextmanager,
        "AsyncSurreal": lambda url: db,
        "get_database_url": lambda: "ws://fixture.invalid/rpc",
        "get_database_password": lambda: "fixture",
        "get_database_namespace": lambda: "fixture",
        "get_database_name": lambda: "fixture",
        "os": SimpleNamespace(environ={}),
        "logger": Mock(),
    }
    exec(
        compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace
    )
    return namespace["db_connection"]


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["signin", "use", "body", None])
@pytest.mark.parametrize("cancel", [False, True])
async def test_connection_closes_on_success_failure_and_cancellation(stage, cancel):
    db = SimpleNamespace(signin=AsyncMock(), use=AsyncMock(), close=AsyncMock())
    connection = load_connection(db)
    error = asyncio.CancelledError() if cancel else ConnectionError("fixture failure")
    if stage in ("signin", "use"):
        getattr(db, stage).side_effect = error

    async def run():
        async with connection() as actual:
            assert actual is db
            if stage == "body":
                raise error

    if stage:
        with pytest.raises(type(error)) as caught:
            await run()
        assert caught.value is error
    else:
        await run()
    db.close.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
@pytest.mark.parametrize("stage", ["signin", "use", "body"])
async def test_close_failure_does_not_hide_primary_exception(cancel, stage):
    error = asyncio.CancelledError() if cancel else ConnectionError("signin failure")
    db = SimpleNamespace(
        signin=AsyncMock(),
        use=AsyncMock(),
        close=AsyncMock(side_effect=RuntimeError("close failure")),
    )
    if stage != "body":
        getattr(db, stage).side_effect = error
    with pytest.raises(type(error)) as caught:
        async with load_connection(db)():
            if stage == "body":
                raise error
            pytest.fail("failed setup must not yield")
    assert caught.value is error
    db.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_close_failure_after_success_is_reported():
    db = SimpleNamespace(
        signin=AsyncMock(),
        use=AsyncMock(),
        close=AsyncMock(side_effect=RuntimeError("close failure")),
    )
    with pytest.raises(RuntimeError, match="close failure"):
        async with load_connection(db)():
            pass
