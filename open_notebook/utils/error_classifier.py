"""
Error classification utility for LLM provider errors.

Maps raw exceptions from AI providers/Esperanto/LangChain to user-friendly
error messages and appropriate exception types.
"""

from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ContextLengthExceededError,
    ExternalServiceError,
    NetworkError,
    OpenNotebookError,
    RateLimitError,
)
from open_notebook.utils.boundary_logging import log_boundary_failure

# Classification rules: (keywords, exception_class, fixed user_message)
_CLASSIFICATION_RULES: list[tuple[list[str], type[OpenNotebookError], str]] = [
    # Authentication errors
    (
        ["authentication", "unauthorized", "invalid api key", "invalid_api_key", "401"],
        AuthenticationError,
        "Authentication failed. Please check your API key in Manage -> Models.",
    ),
    # Rate limit errors
    (
        ["rate limit", "rate_limit", "429", "too many requests", "quota exceeded"],
        RateLimitError,
        "Rate limit exceeded. Please wait a moment and try again.",
    ),
    # Model not found
    (
        ["model not found", "does not exist", "model_not_found"],
        ConfigurationError,
        "The selected AI model is unavailable. Please check your model configuration in Manage -> Models.",
    ),
    # Configuration errors from provision.py
    (
        ["no model configured", "please go to settings", "please go to manage"],
        ConfigurationError,
        "No AI model is configured for this operation. Please configure a default model in Manage -> Models.",
    ),
    # Network errors (connect timeouts included: the provider was never reached)
    (
        [
            "connecterror",
            "connecttimeout",
            "connection timed out",
            "connection refused",
            "connection error",
        ],
        NetworkError,
        "Could not connect to the AI provider. Please check your network connection and provider URL.",
    ),
    # Read timeouts: the provider was reached but didn't answer within
    # ESPERANTO_LLM_TIMEOUT (180 s unless set)
    (
        ["timeoutexception", "timed out", "timeout"],
        NetworkError,
        "The AI provider took too long to respond. Try again, use a faster model, or raise ESPERANTO_LLM_TIMEOUT (180 seconds by default).",
    ),
    # Context length errors
    (
        [
            "context length",
            "token limit",
            "maximum context",
            "context_length_exceeded",
            "max_tokens",
        ],
        ContextLengthExceededError,
        "Content too large for the selected model. Try using a smaller selection or a model with a larger context window.",
    ),
    # Payload too large errors
    (
        ["413", "payload too large", "request entity too large"],
        ExternalServiceError,
        "The request payload is too large for the AI provider. Try reducing the content size or using a different model.",
    ),
    # Provider availability errors
    (
        [
            "500",
            "502",
            "503",
            "service unavailable",
            "overloaded",
            "internal server error",
        ],
        ExternalServiceError,
        "The AI provider is temporarily unavailable. Please try again in a few minutes.",
    ),
]


def classify_error(exception: BaseException) -> tuple[type[OpenNotebookError], str]:
    """
    Classify a raw exception into a user-friendly error type and message.

    Args:
        exception: Any exception from LLM providers/Esperanto/LangChain

    Returns:
        Tuple of (exception_class, user_friendly_message)
    """
    error_str = str(exception).lower()
    error_type_name = type(exception).__name__.lower()
    combined = f"{error_type_name}: {error_str}"

    for keywords, exc_class, message in _CLASSIFICATION_RULES:
        for keyword in keywords:
            if keyword in combined:
                return exc_class, message

    # Unclassified error - log for future improvement
    log_boundary_failure("llm_error_classification", exception, level="WARNING")
    return (
        ExternalServiceError,
        "The AI service could not complete the request. Please try again later.",
    )
