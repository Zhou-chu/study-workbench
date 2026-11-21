"""Wiring tests for Anthropic-compatible credentials."""


def test_langchain_bridge_forwards_base_url():
    """An anthropic-compatible model must reach its custom base URL via the
    native esperanto ``to_langchain()`` path (no Open Notebook shim), NOT the
    official ``api.anthropic.com`` endpoint.
    """
    from esperanto import AIFactory

    esperanto_model = AIFactory.create_language(
        model_name="compatible-model",
        provider="anthropic",
        config={
            "api_key": "sk-test",
            "base_url": "https://api.example.com/v1",
            "max_tokens": 850,
            "temperature": 0.5,
        },
    )

    langchain_model = esperanto_model.to_langchain()

    # ChatAnthropic exposes the endpoint as ``anthropic_api_url`` (alias base_url).
    assert langchain_model.anthropic_api_url == "https://api.example.com"
    assert "api.anthropic.com" not in (langchain_model.anthropic_api_url or "")
