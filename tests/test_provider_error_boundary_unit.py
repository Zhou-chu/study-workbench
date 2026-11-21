"""Direct Ask model cancellation with a synthetic provider."""

import asyncio
from typing import cast

import pytest
from ask_provider_failure_fixtures import EMPTY_CONFIG, PAYLOAD, failing_model

from open_notebook.graphs import ask


@pytest.mark.asyncio
async def test_ask_does_not_reclassify_or_repeat_cancellation(monkeypatch):
    original = asyncio.CancelledError(PAYLOAD)
    provision, invoke = failing_model(monkeypatch, original)
    with pytest.raises(asyncio.CancelledError) as caught:
        await ask.call_model_with_messages(
            cast(ask.ThreadState, {"question": "synthetic question"}), EMPTY_CONFIG
        )
    assert caught.value is original
    provision.assert_awaited_once()
    invoke.assert_awaited_once()
