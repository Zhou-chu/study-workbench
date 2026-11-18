"""Actual service and fake-adapter composition with no external login."""

import importlib

import pytest
from notebooklm_auth_fixtures import adapter_type


@pytest.mark.asyncio
async def test_test_adapter_requires_explicit_responses_and_injection(monkeypatch):
    try:
        module = importlib.import_module(
            "open_notebook.integrations.notebooklm.fake_adapter"
        )
    except ModuleNotFoundError:
        pytest.fail("Explicit injection-only test adapter not implemented")
    from api.notebooklm_service import NotebookLMService
    from open_notebook.integrations.notebooklm.contracts import (
        BridgeError,
        ConnectionStatus,
    )

    monkeypatch.setenv("NOTEBOOKLM_FAKE", "true")
    assert isinstance(NotebookLMService().bridge, adapter_type())
    fake = module.FakeNotebookLMBridge({})
    with pytest.raises(BridgeError):
        await fake.verify_connection()
    fake = module.FakeNotebookLMBridge(
        {"verify_connection": ConnectionStatus(state="connected")}
    )
    assert (await fake.verify_connection()).state == "connected"
    assert NotebookLMService(bridge=fake).bridge is fake
