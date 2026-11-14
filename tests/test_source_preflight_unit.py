"""Advisory source preflight units with synthetic parser boundary responses."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from loguru import logger

from api.routers import sources as r
from open_notebook.exceptions import UnsupportedTypeException


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        ImportError("synthetic-secret-import"),
        FileNotFoundError("synthetic-secret-missing"),
    ],
)
async def test_advisory_failure_skips_without_path_or_exception_prose(
    monkeypatch, error
):
    check = AsyncMock(side_effect=error)
    monkeypatch.setattr(r, "check_file_support", check)
    logs = []
    sink = logger.add(lambda message: logs.append(str(message)), level="DEBUG")
    try:
        assert (
            await r._assert_file_supported("/synthetic-private-path/document.pdf")
            is None
        )
    finally:
        logger.remove(sink)
    check.assert_awaited_once_with("/synthetic-private-path/document.pdf")
    output = "".join(logs)
    assert "synthetic-private-path" not in output
    assert "synthetic-secret" not in output
    assert "operation=source_preflight" in output
    assert "exception_type=" + type(error).__name__ in output


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "reason,identified,expected",
    [
        (None, None, "Unsupported file type"),
        (
            "Not extractable",
            "synthetic/binary",
            "Not extractable (detected type: synthetic/binary)",
        ),
    ],
)
async def test_actual_unsupported_verdict_remains_rejected(
    monkeypatch, reason, identified, expected
):
    monkeypatch.setattr(
        r,
        "check_file_support",
        AsyncMock(
            return_value=SimpleNamespace(
                supported=False, reason=reason, identified_type=identified
            )
        ),
    )
    with pytest.raises(UnsupportedTypeException) as caught:
        await r._assert_file_supported("synthetic.bin")
    assert str(caught.value) == expected


@pytest.mark.asyncio
async def test_supported_verdict_is_accepted(monkeypatch):
    monkeypatch.setattr(
        r, "check_file_support", AsyncMock(return_value=SimpleNamespace(supported=True))
    )
    assert await r._assert_file_supported("synthetic.pdf") is None
