"""Metadata-only logging for explicitly migrated shared error boundaries.

This is not a general exception sanitizer: exception messages, arguments,
causes, query inputs and model values must never be passed to the log sink.
"""

import re

from loguru import logger

_OPERATIONS = frozenset(
    {
        "llm_error_classification",
        "model_list",
        "source_get",
        "source_preflight",
        "source_file_check",
        "source_file_download",
        "source_status",
        "source_retry",
        "source_delete",
        "source_insights",
        "model_create",
        "model_delete",
        "model_test",
        "model_defaults_get",
        "model_defaults_update",
        "model_provider_availability",
        "model_discover",
        "model_sync",
        "model_sync_all",
        "model_count",
        "model_by_provider",
        "model_auto_assign",
        "ask_stream",
        "source_chat_stream",
        "default_model_load",
        "discard_unanswered_message",
        "repo_query",
        "repo_create",
        "repo_delete",
        "repo_insert",
        "object_get",
        "object_get_all",
        "object_get_all_validation",
        "object_save",
        "object_save_validation",
        "object_delete",
        "object_relate",
        "notebook_sources",
        "notebook_notes",
        "notebook_insights",
        "notebook_source_insights",
        "notebook_status",
        "notebook_progress",
    }
)
_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})
_TYPE_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,79}")


def log_boundary_failure(
    operation: str, exc: BaseException, *, level: str = "ERROR"
) -> None:
    """Emit a fixed event and bounded metadata, without rendering the exception."""
    safe_operation = (
        operation if type(operation) is str and operation in _OPERATIONS else "unknown"
    )
    safe_level = level if type(level) is str and level in _LEVELS else "ERROR"
    name = type(exc).__name__
    safe_type = name if _TYPE_NAME.fullmatch(name) else "UnknownError"
    logger.opt(exception=None).log(
        safe_level,
        "Boundary operation failed: operation={} exception_type={}",
        safe_operation,
        safe_type,
    )
