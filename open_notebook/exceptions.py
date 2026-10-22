class OpenNotebookError(Exception):
    """Base exception class for Open Notebook errors."""

    pass


class DatabaseOperationError(OpenNotebookError):
    """Raised when a database operation fails."""

    pass


class CommandSubmissionUnknownError(OpenNotebookError):
    """CREATE may have committed; automatic replay can duplicate queued work."""

    def __init__(
        self,
        *,
        source_id: str | None = None,
        command_id: str | None = None,
        resource_id: str | None = None,
        resource_type: str | None = None,
    ):
        self.source_id = source_id
        self.command_id = command_id
        self.resource_id = source_id or resource_id
        self.resource_type = "source" if source_id else resource_type
        super().__init__(
            "Command submission may already be committed; do not automatically retry."
        )


class UnsupportedTypeException(OpenNotebookError):
    """Raised when an unsupported type is provided."""

    pass


class InvalidInputError(OpenNotebookError):
    """Raised when invalid input is provided."""

    pass


class NotFoundError(OpenNotebookError):
    """Raised when a requested resource is not found."""

    pass


class AuthenticationError(OpenNotebookError):
    """Raised when there's an authentication problem."""

    pass


class ConfigurationError(OpenNotebookError):
    """Raised when there's a configuration problem."""

    pass


class ExternalServiceError(OpenNotebookError):
    """Raised when an external service (e.g., AI model) fails."""

    pass


class IncompleteGenerationError(ExternalServiceError):
    """The model returned truncated or empty output; do not retry automatically."""

    pass


class ContextLengthExceededError(ExternalServiceError):
    """Content exceeds the model's context window. Retrying sends the same
    oversized payload, so background commands must not retry this."""

    pass


class RateLimitError(OpenNotebookError):
    """Raised when a rate limit is exceeded."""

    pass


class FileOperationError(OpenNotebookError):
    """Raised when a file operation fails."""

    pass


class NetworkError(OpenNotebookError):
    """Raised when a network operation fails."""

    pass


class NoTranscriptFound(OpenNotebookError):
    """Raised when no transcript is found for a video."""

    pass


class NoteRevisionConflict(OpenNotebookError):
    def __init__(self, current_revision: int):
        super().__init__("NOTE_REVISION_CONFLICT")
        self.current_revision = current_revision


class NoteRevisionRequired(OpenNotebookError):
    def __init__(self):
        super().__init__("NOTE_REVISION_REQUIRED")


class NoteCommitOutcomeUnknown(OpenNotebookError):
    """Read/reconcile before retrying; commit may already have succeeded."""


class UnsupportedCapabilityError(OpenNotebookError):
    """Raised when an operation is explicitly unavailable, rather than successful."""
