"""classify_error() tells a slow provider apart from an unreachable one."""

import httpx
import pytest

from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ContextLengthExceededError,
    ExternalServiceError,
    NetworkError,
    RateLimitError,
)
from open_notebook.utils.error_classifier import classify_error


def test_read_timeout_says_the_provider_was_slow():
    exc_class, message = classify_error(
        httpx.ReadTimeout("The read operation timed out")
    )
    assert exc_class is NetworkError
    assert "took too long" in message
    assert "ESPERANTO_LLM_TIMEOUT" in message


def test_openai_style_timeout_says_the_provider_was_slow():
    class APITimeoutError(Exception):
        pass

    _, message = classify_error(APITimeoutError("Request timed out."))
    assert "took too long" in message


def test_connect_timeout_is_a_connection_problem():
    exc_class, message = classify_error(httpx.ConnectTimeout("timed out"))
    assert exc_class is NetworkError
    assert "Could not connect" in message


def test_connection_refused_is_a_connection_problem():
    exc_class, message = classify_error(
        httpx.ConnectError("[Errno 111] Connection refused")
    )
    assert exc_class is NetworkError
    assert "Could not connect" in message


def test_os_connection_timed_out_is_a_connection_problem():
    exc_class, message = classify_error(OSError("[Errno 110] Connection timed out"))
    assert exc_class is NetworkError
    assert "Could not connect" in message


def test_auth_error_points_to_the_models_page():
    exc_class, message = classify_error(Exception("401 invalid api key"))
    assert exc_class is AuthenticationError
    assert "Manage -> Models" in message


def test_missing_default_model_uses_fixed_configuration_message():
    raw = "No model configured for default for type=chat. Please go to Manage → Models and configure a default model for 'chat'."
    exc_class, message = classify_error(ValueError(raw))
    assert exc_class is ConfigurationError
    assert message == (
        "No AI model is configured for this operation. Please configure a default "
        "model in Manage -> Models."
    )


@pytest.mark.parametrize("padding", ["", "x" * 400], ids=["short", "long"])
@pytest.mark.parametrize(
    "prefix,expected_class,expected_message",
    [
        (
            "model not found",
            ConfigurationError,
            "The selected AI model is unavailable. Please check your model configuration in Manage -> Models.",
        ),
        (
            "no model configured",
            ConfigurationError,
            "No AI model is configured for this operation. Please configure a default model in Manage -> Models.",
        ),
        (
            "unrecognized provider failure",
            ExternalServiceError,
            "The AI service could not complete the request. Please try again later.",
        ),
    ],
)
def test_raw_provider_messages_never_become_public_detail(
    prefix, expected_class, expected_message, padding
):
    sentinel = "token=synthetic-secret /private/document.txt document-body"
    # Keep a sentinel before and after the former truncation boundary.
    error = ValueError(f"{prefix}: {sentinel} {padding} {sentinel}")
    exc_class, message = classify_error(error)
    assert exc_class is expected_class
    assert message == expected_message
    for forbidden in (sentinel, "synthetic-secret", "/private/", "document-body"):
        assert forbidden not in message


@pytest.mark.parametrize(
    "raw,expected_class,expected_message",
    [
        (
            "unauthorized timeout",
            AuthenticationError,
            "Authentication failed. Please check your API key in Manage -> Models.",
        ),
        (
            "rate_limit timeout",
            RateLimitError,
            "Rate limit exceeded. Please wait a moment and try again.",
        ),
        (
            "model_not_found timeout",
            ConfigurationError,
            "The selected AI model is unavailable. Please check your model configuration in Manage -> Models.",
        ),
        (
            "please go to settings timeout",
            ConfigurationError,
            "No AI model is configured for this operation. Please configure a default model in Manage -> Models.",
        ),
        (
            "connection refused timeout",
            NetworkError,
            "Could not connect to the AI provider. Please check your network connection and provider URL.",
        ),
        (
            "timeout context length",
            NetworkError,
            "The AI provider took too long to respond. Try again, use a faster model, or raise ESPERANTO_LLM_TIMEOUT (180 seconds by default).",
        ),
        (
            "context_length_exceeded payload too large",
            ContextLengthExceededError,
            "Content too large for the selected model. Try using a smaller selection or a model with a larger context window.",
        ),
        (
            "413 overloaded",
            ExternalServiceError,
            "The request payload is too large for the AI provider. Try reducing the content size or using a different model.",
        ),
        (
            "503 service unavailable",
            ExternalServiceError,
            "The AI provider is temporarily unavailable. Please try again in a few minutes.",
        ),
        (
            "authentication rate limit model not found",
            AuthenticationError,
            "Authentication failed. Please check your API key in Manage -> Models.",
        ),
        (
            "429 no model configured",
            RateLimitError,
            "Rate limit exceeded. Please wait a moment and try again.",
        ),
        (
            "does not exist no model configured",
            ConfigurationError,
            "The selected AI model is unavailable. Please check your model configuration in Manage -> Models.",
        ),
        (
            "please go to manage connection error",
            ConfigurationError,
            "No AI model is configured for this operation. Please configure a default model in Manage -> Models.",
        ),
    ],
)
def test_classification_rules_keep_their_order_and_fixed_messages(
    raw, expected_class, expected_message
):
    assert classify_error(ValueError(raw)) == (expected_class, expected_message)
