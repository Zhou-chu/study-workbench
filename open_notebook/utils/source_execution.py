"""Shared uncertainty across source graph tasks, independent of graph state merges.

Context copying into asyncio tasks preserves this mutable per-execution object.
A failing sibling can hide another sibling's exception; positive task draining
therefore does not itself prove that external effects were not accepted.
"""

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Awaitable, Callable, ParamSpec, TypeVar

from open_notebook.exceptions import CommandSubmissionUnknownError


@dataclass
class SourceExecutionSafety:
    uncertain: bool = False


source_execution_safety: ContextVar[SourceExecutionSafety | None] = ContextVar(
    "source_execution_safety", default=None
)
P = ParamSpec("P")
T = TypeVar("T")


def track_source_uncertainty(
    function: Callable[P, Awaitable[T]],
) -> Callable[P, Awaitable[T]]:
    @wraps(function)
    async def tracked(*args: P.args, **kwargs: P.kwargs) -> T:
        try:
            return await function(*args, **kwargs)
        except (asyncio.CancelledError, CommandSubmissionUnknownError):
            safety = source_execution_safety.get()
            if safety is not None:
                safety.uncertain = True
            raise

    return tracked


def source_processing_status(
    attempt: dict | None, command_status: str | None
) -> str | None:
    """Project source safety, never trust shared SDK terminal state by itself."""
    if not attempt:
        return (
            "unknown"
            if command_status in {"failed", "completed", "canceled", "cancelled"}
            else command_status
        )
    phase = attempt.get("phase")
    if not attempt.get("command"):
        return "unknown"
    if phase == "succeeded" and attempt.get("owner"):
        return "completed"
    if phase == "failed" and attempt.get("owner"):
        return (
            command_status
            if command_status in {"failed", "canceled", "cancelled"}
            else "unknown"
        )
    if phase == "running":
        return "running" if command_status == "running" else "unknown"
    return (
        command_status if command_status in {"new", "queued", "running"} else "unknown"
    )


def source_owner_progress(attempt: dict | None, status: str | None) -> dict:
    """Do not attach a duplicate execution's error/result to another owner."""
    return {
        "status": status,
        "owner_phase": (attempt or {}).get("phase"),
        "submission_unknown": status == "unknown",
    }
