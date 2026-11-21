"""Synthetic source context used by the unit and tokenizer integration tests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock


def _mock_source(insights):
    source = SimpleNamespace(id="source:123")
    source.get_context = AsyncMock(
        return_value={"id": "source:123", "title": "T", "full_text": "body"}
    )
    source.get_insights = AsyncMock(return_value=insights)
    return source
