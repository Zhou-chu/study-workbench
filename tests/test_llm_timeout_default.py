"""Open Notebook defaults ESPERANTO_LLM_TIMEOUT to 180 s (#1434).

esperanto 2.28 enforces the timeout in to_langchain() on every provider, with
a 60 s default that cuts off long answers and slow local models.
"""

import pytest
from esperanto import AIFactory

from open_notebook.config import ensure_llm_timeout_default


@pytest.mark.parametrize(
    "env_value,expected",
    [(None, 180.0), ("90", 90.0)],
)
def test_langchain_model_carries_the_timeout(monkeypatch, env_value, expected):
    monkeypatch.delenv("ESPERANTO_LLM_TIMEOUT", raising=False)
    if env_value is not None:
        monkeypatch.setenv("ESPERANTO_LLM_TIMEOUT", env_value)
    import os

    ensure_llm_timeout_default(os.environ)

    model = AIFactory.create_language(
        "anthropic", "claude-sonnet-5", config={"api_key": "test"}
    ).to_langchain()

    assert float(model.default_request_timeout) == expected
