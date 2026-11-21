"""Synthetic Ask provider failure and invocation seam shared across test layers."""

from typing import cast
from unittest.mock import AsyncMock, MagicMock

from langchain_core.runnables import RunnableConfig

from open_notebook.graphs import ask

PAYLOAD = "token=synthetic-secret /private/document.txt document-body"
EMPTY_CONFIG = cast(RunnableConfig, {"configurable": {}})


def failing_model(monkeypatch, error):
    model = MagicMock()
    model.ainvoke = AsyncMock(side_effect=error)
    provision = AsyncMock(return_value=model)
    monkeypatch.setattr(ask, "provision_langchain_model", provision)
    return provision, model.ainvoke
