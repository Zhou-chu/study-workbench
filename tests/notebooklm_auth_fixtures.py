"""Load the default NotebookLM adapter shared across offline test layers."""

import importlib

import pytest


def adapter_type():
    try:
        module = importlib.import_module(
            "open_notebook.integrations.notebooklm.sdk_adapter"
        )
    except ModuleNotFoundError:
        pytest.fail("NotebookLM public SDK adapter has not been implemented")
    return module.SDKNotebookLMBridge
