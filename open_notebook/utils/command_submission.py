"""Async submissions with the locked surreal-commands 1.3.1 JSON wire contract."""

import asyncio
import re
import weakref
from typing import Any

from loguru import logger
from surreal_commands import command_service, registry
from surreal_commands.core.service import CommandRequest
from surrealdb import AsyncSurreal, RecordID

from open_notebook.exceptions import CommandSubmissionUnknownError

MAX_IN_FLIGHT = 8
ADMISSION_TIMEOUT = 10.0
SUBMISSION_TIMEOUT = 30.0
CLEANUP_TIMEOUT = 5.0

# Limits are per event loop, not distributed. Weak keys AND values avoid keeping
# closed loops alive through a contended semaphore's reference back to its loop.
_admissions: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _admission() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    reference = _admissions.get(loop)
    semaphore = reference() if reference else None
    if semaphore is None:
        semaphore = asyncio.Semaphore(MAX_IN_FLIGHT)
        _admissions[loop] = weakref.ref(semaphore)
    return semaphore


def _valid_command_id(identity: Any) -> bool:
    """Accept scalar command RecordIDs and supported canonical string receipts.

    Do not use SDK RecordID.parse here: the locked parser accepts empty/wrong
    tables and cannot round-trip quoted identifiers. Never stringify arbitrary
    values into an apparently confirmed command ID.
    """
    if isinstance(identity, RecordID):
        return identity.table_name == "command" and (
            (isinstance(identity.id, str) and bool(identity.id.strip()))
            or (isinstance(identity.id, int) and not isinstance(identity.id, bool))
        )
    if not isinstance(identity, str):
        return False
    return (
        re.fullmatch(
            r"command:(?:[A-Za-z0-9_]+|-[0-9]+|⟨(?:[^⟩\\]|\\[\\⟩])+⟩)", identity
        )
        is not None
        and identity != "command:⟨⟩"
    )


async def submit_command(
    app: str,
    command: str,
    args: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> Any:
    """Submit once, preserving the public sync SDK's payload and returned ID.

    SDK's native async service uses Python-mode model_dump(); its public sync
    client uses JSON mode. This small adapter retains the latter contract while
    using a fresh async connection. No executor, background queue or replay.

    Timeout/cancellation after CREATE begins does NOT prove rollback: a command
    may be committed without its ID reaching the caller. Never automatically
    retry that unknown outcome. Pre-dispatch exceptions retain their types.
    """
    request = CommandRequest(app=app, command=command, args=args, context=context)
    semaphore = _admission()
    async with asyncio.timeout(ADMISSION_TIMEOUT):
        await semaphore.acquire()
    try:
        db = AsyncSurreal(command_service.db_url)
        dispatched = False
        try:
            async with asyncio.timeout(SUBMISSION_TIMEOUT):
                await db.signin(command_service.db_auth)
                await db.use(command_service.db_namespace, command_service.db_database)
                # Match sync SDK ordering and JSON serialization exactly.
                name = f"{request.app}.{request.command}"
                item = registry.get_command_by_id(name)
                if not item:
                    raise ValueError(f"Command not found: {name}")
                validated = item.input_schema(**request.args).model_dump(mode="json")
                payload = {
                    "app": request.app,
                    "name": request.command,
                    "args": validated,
                    "context": request.context or {},
                    "status": "new",
                }
                dispatched = True
                result = await db.create("command", payload)
                if not isinstance(result, dict):
                    raise TypeError("Command CREATE returned an invalid record")
                identity = result.get("id")
                if not _valid_command_id(identity):
                    raise ValueError("Command CREATE returned an invalid command ID")
                return identity
        except BaseException as exc:
            exc.add_note(
                "Command CREATE started; submission outcome may be unknown. Do not replay."
                if dispatched
                else "Command submission failed before CREATE."
            )
            if dispatched and isinstance(exc, Exception):
                raise CommandSubmissionUnknownError() from exc
            raise
        finally:
            try:
                async with asyncio.timeout(CLEANUP_TIMEOUT):
                    await db.close()
            except asyncio.CancelledError:
                # A new cancellation during cleanup must not turn back into a
                # retryable primary error (or a successful acknowledged return).
                raise
            except Exception:
                # A valid CREATE receipt remains confirmed despite close failure.
                # Preserve a pending primary error too; never log credentials,
                # payloads or SDK exception details from cleanup.
                logger.warning("Command connection cleanup failed")

    finally:
        semaphore.release()
