"""Durable, single-owner source submissions. No operation here enqueues work.

An attempt phase describes submission/ownership, never command completion.
Missing acknowledgements are unresolved, not permission to replay.
"""

from uuid import uuid4

from open_notebook.database.repository import (
    db_connection,
    ensure_record_id,
    parse_record_ids,
)
from open_notebook.exceptions import CommandSubmissionUnknownError


def new_attempt():
    return {"token": uuid4().hex, "phase": "pending"}


async def _query(sql, params):
    try:
        async with db_connection() as db:
            response = await db.query_raw(sql, params)
        statements = response.get("result") if isinstance(response, dict) else None
        if (
            not isinstance(response, dict)
            or response.get("error") is not None
            or not isinstance(statements, list)
            or len(statements) != 1
            or not isinstance(statements[0], dict)
            or statements[0].get("status") != "OK"
            or not isinstance(statements[0].get("result"), list)
            or any(not isinstance(row, dict) for row in statements[0]["result"])
        ):
            raise ValueError("Missing source ownership acknowledgement")
        return parse_record_ids(statements[0]["result"])
    except Exception as exc:
        raise CommandSubmissionUnknownError(source_id=str(params["source"])) from exc


async def claim_retry(source):
    """CAS plus actual prior command terminal state, in the same statement."""
    attempt = new_attempt()
    rows = await _query(
        """
        UPDATE $source SET processing_attempt = $attempt, command = NONE
        WHERE (processing_attempt.token ?? NONE) = $prior_token
          AND (command ?? NONE) = $prior_command
          AND (($prior_token = NONE AND $prior_command = NONE)
            OR (command != NONE AND command.status IN ['failed', 'canceled', 'cancelled']
              AND processing_attempt.command = command
              AND processing_attempt.phase = 'failed' AND processing_attempt.owner != NONE))
        RETURN AFTER;
    """,
        {
            "source": ensure_record_id(source.id),
            "attempt": attempt,
            "prior_token": (source.processing_attempt or {}).get("token"),
            "prior_command": ensure_record_id(source.command)
            if source.command
            else None,
        },
    )
    if (
        len(rows) != 1
        or rows[0].get("processing_attempt", {}).get("token") != attempt["token"]
    ):
        raise ValueError(
            "Prior source attempt is active, unknown, or changed; retry refused"
        )
    return attempt


async def bind_command(source_id, token, command_id):
    """ACK/reconciliation cannot replace another attempt or regress worker phase."""
    rows = await _query(
        """
        UPDATE $source SET command = $command,
          processing_attempt.command = $command,
          processing_attempt.phase = IF processing_attempt.phase = 'pending' THEN 'confirmed' ELSE processing_attempt.phase END
        WHERE processing_attempt.token = $attempt_token
          AND (processing_attempt.command = NONE OR processing_attempt.command = $command)
        RETURN AFTER;
    """,
        {
            "source": ensure_record_id(source_id),
            "attempt_token": token,
            "command": ensure_record_id(command_id),
        },
    )
    if len(rows) != 1:
        raise ValueError("Source attempt changed before command acknowledgement")
    return rows[0]


async def start_worker(source_id, token, command_id, owner_id):
    """Acquire once, before any graph/provider work; duplicate deliveries stop."""
    command = ensure_record_id(command_id) if command_id else None
    if token:
        sql = """
            UPDATE $source SET command = $command, processing_attempt.command = $command,
              processing_attempt.phase = 'running', processing_attempt.owner = $owner_id
            WHERE processing_attempt.token = $attempt_token
              AND processing_attempt.phase IN ['pending', 'confirmed']
              AND (processing_attempt.command = NONE OR processing_attempt.command = $command)
            RETURN AFTER;
        """
        if command is None:
            raise ValueError("Token-bearing worker has no execution command identity")
    else:
        sql = """
            UPDATE $source SET command = $command, processing_attempt = $legacy
            WHERE processing_attempt = NONE
              AND (command = NONE OR command = $command)
            RETURN AFTER;
        """
    rows = await _query(
        sql,
        {
            "source": ensure_record_id(source_id),
            "attempt_token": token,
            "command": command,
            "owner_id": owner_id,
            "legacy": {
                "token": uuid4().hex,
                "phase": "running",
                "command": command,
                "owner": owner_id,
            },
        },
    )
    if len(rows) != 1 or rows[0].get("processing_attempt", {}).get("owner") != owner_id:
        raise ValueError("Stale or duplicate source worker refused")
    return rows[0]


async def reconcile(source):
    """Only positive unique queue evidence can resolve an unbound attempt."""
    attempt = source.processing_attempt
    if not attempt or attempt.get("command"):
        return source
    rows = await _query(
        """
        SELECT id FROM command WHERE app = 'open_notebook' AND name = 'process_source'
          AND args.source_id = $source_string AND args.submission_token = $attempt_token LIMIT 2;
    """,
        {
            "source": ensure_record_id(source.id),
            "source_string": str(source.id),
            "attempt_token": attempt["token"],
        },
    )
    if len(rows) == 1 and rows[0].get("id"):
        from open_notebook.domain.notebook import Source

        return Source(
            **(await bind_command(str(source.id), attempt["token"], str(rows[0]["id"])))
        )
    return source


async def assert_owner(source_id, token, owner_id):
    rows = await _query(
        """
        SELECT id FROM $source WHERE processing_attempt.token = $attempt_token
          AND processing_attempt.owner = $owner_id AND processing_attempt.phase = 'running';
    """,
        {
            "source": ensure_record_id(source_id),
            "attempt_token": token,
            "owner_id": owner_id,
        },
    )
    if len(rows) != 1:
        raise ValueError("Source execution owner changed or stopped")


async def finish_worker(source_id, token, owner_id, succeeded):
    """Only the positively terminated execution may release its own attempt.

    Shared SDK command status is not evidence of source-worker termination.
    Cancellation, crash, and ambiguous claim/finalization are never lease expiry.
    """
    rows = await _query(
        """
        UPDATE $source SET processing_attempt.phase = $phase
        WHERE processing_attempt.token = $attempt_token AND processing_attempt.owner = $owner_id
          AND processing_attempt.phase = 'running' RETURN AFTER;
    """,
        {
            "source": ensure_record_id(source_id),
            "attempt_token": token,
            "owner_id": owner_id,
            "phase": "succeeded" if succeeded else "failed",
        },
    )
    if len(rows) != 1:
        raise ValueError("Source execution owner changed or already stopped")
    return rows[0]


async def publish_source(source_id, token, owner_id, fields):
    """Fence extraction writes atomically; stale workers never overwrite new content."""
    rows = await _query(
        """
        UPDATE $source SET full_text = $content, asset = $asset,
          title = IF $title != NONE AND (title = NONE OR title = '' OR title = 'Processing...') THEN $title ELSE title END,
          updated = time::now()
        WHERE processing_attempt.token = $attempt_token AND processing_attempt.owner = $owner_id
          AND processing_attempt.phase = 'running' RETURN AFTER;
    """,
        {
            "source": ensure_record_id(source_id),
            "attempt_token": token,
            "owner_id": owner_id,
            "content": fields.get("full_text"),
            "asset": fields.get("asset"),
            "title": fields.get("title"),
        },
    )
    if len(rows) != 1:
        raise ValueError("Source execution owner changed before content publication")
    return rows[0]
