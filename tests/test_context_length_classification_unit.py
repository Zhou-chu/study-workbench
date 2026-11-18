"""Direct exception classification for deterministic context-length errors."""

from open_notebook.exceptions import (
    ContextLengthExceededError,
    ExternalServiceError,
)
from open_notebook.utils.error_classifier import classify_error

# The message OpenRouter returned in #1231, as the OpenAI SDK surfaces it.
OPENROUTER_CONTEXT_LENGTH_400 = (
    "Error code: 400 - {'error': {'message': \"This endpoint's maximum context "
    "length is 262144 tokens. However, you requested about 403309 tokens "
    "(395117 of text input, 8192 in the output).\", 'code': 400}}"
)


class TestClassification:
    def test_openrouter_400_is_context_length_exceeded(self):
        exc_class, message = classify_error(Exception(OPENROUTER_CONTEXT_LENGTH_400))

        assert exc_class is ContextLengthExceededError
        assert message  # user-facing text, not empty

    def test_still_an_external_service_error(self):
        """Subclassing is load-bearing: it keeps the existing 502 handler."""
        assert issubclass(ContextLengthExceededError, ExternalServiceError)

    def test_provider_5xx_stays_retryable(self):
        """The regression guard -- 5xx must NOT be swept up as permanent."""
        exc_class, _ = classify_error(
            Exception("Error code: 503 - service unavailable, provider overloaded")
        )

        assert exc_class is ExternalServiceError
        assert not issubclass(exc_class, ContextLengthExceededError)
