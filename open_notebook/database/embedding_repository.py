"""Atomic embedding publication; never compensate an uncertain commit by deleting.

The source row is the conflict point shared with other publishers, edits and
removal. Range DELETE alone does not protect an initially empty chunk set.
One bounded RPC/transaction replaces the entire set; there are no partial batches.
"""

import json
import math
from uuid import uuid4

from open_notebook.database.repository import db_connection, ensure_record_id

# Deliberately conservative, including text and vectors. Larger sources fail
# without touching the previous index; this is not a streaming publication API.
MAX_PUBLICATION_BYTES = 8 * 1024 * 1024
MAX_PUBLICATION_CHUNKS = 2000


class EmbeddingOutcomeUnknown(RuntimeError):
    """Do not automatically replay: inspect the stored index before retrying."""


def _validate_budget(params):
    try:
        size = len(json.dumps(params, default=str, allow_nan=False).encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid embedding publication payload") from exc
    if size > MAX_PUBLICATION_BYTES:
        raise ValueError("Embedding publication exceeds the 8 MiB transaction budget")


def _validate_vectors(vectors):
    dimension = None
    for vector in vectors:
        if not isinstance(vector, list) or not vector:
            raise ValueError("Embedding vectors must be nonempty lists")
        if dimension is not None and len(vector) != dimension:
            raise ValueError("Embedding vector dimensions differ")
        dimension = len(vector)
        if any(
            type(value) not in (int, float) or not math.isfinite(value)
            for value in vector
        ):
            raise ValueError("Embedding vectors must contain finite numbers")


async def _publish(body, params, receipt):
    """Require the transaction receipt AND its post-COMMIT acknowledgement.

    SurrealDB 2.3.10 RETURN suppresses earlier successful statement outputs.
    Success therefore has exactly two OK receipts; any returned ERR is checked.

    Cancellation propagates unchanged; neither cancellation nor transport loss
    triggers cleanup. The command retry configuration blocks uncertain outcomes.
    """
    params = {**params, "receipt": receipt}
    _validate_budget(params)
    try:
        async with db_connection() as connection:
            response = await connection.query_raw(
                "BEGIN TRANSACTION;\n"
                + body
                + "\nCOMMIT TRANSACTION;\nRETURN $receipt;",
                params,
            )
    except Exception as exc:
        raise EmbeddingOutcomeUnknown(
            "Embedding commit outcome unknown; reconcile before retrying"
        ) from exc
    if not isinstance(response, dict):
        raise EmbeddingOutcomeUnknown("Missing embedding transaction acknowledgement")
    if response.get("error") is not None:
        raise EmbeddingOutcomeUnknown(
            "Unclassified embedding RPC failure; reconcile before retrying"
        )
    statements = response.get("result")
    if (
        not isinstance(statements, list)
        or not statements
        or any(
            not isinstance(row, dict)
            or row.get("status") not in ("OK", "ERR")
            or "result" not in row
            for row in statements
        )
    ):
        raise EmbeddingOutcomeUnknown(
            "Incomplete embedding transaction acknowledgement"
        )
    errors = [str(row["result"]) for row in statements if row["status"] == "ERR"]
    if errors:
        # Only the complete 2.3.10 abort envelope is safe to retry: every
        # transactional result is ERR, followed by the matching post-COMMIT
        # acknowledgement. A lone ERR, missing suffix, or any successful
        # transaction result leaves execution/commit ambiguous.
        if (
            len(statements) < 2
            or statements[-1]["status"] != "OK"
            or statements[-1]["result"] != receipt
            or any(
                row["status"] != "ERR" or not isinstance(row["result"], str)
                for row in statements[:-1]
            )
        ):
            raise EmbeddingOutcomeUnknown(
                "Incomplete or unrecognized embedding abort; reconcile before retrying"
            )
        if any("EMBEDDING_STALE" in error for error in errors):
            raise ValueError("Record changed or was deleted while embedding")
        raise RuntimeError("Embedding transaction aborted")
    if (
        len(statements) != 2
        or statements[-1]["result"] != receipt
        or statements[-2]["result"] != receipt
    ):
        raise EmbeddingOutcomeUnknown(
            "Embedding transaction omitted commit/publication receipt"
        )


async def publish_source_embeddings(source_id, content, file_path, created, records):
    if not records or len(records) > MAX_PUBLICATION_CHUNKS:
        raise ValueError("Embedding publication exceeds chunk budget (1–2000 chunks)")
    _validate_vectors([record["embedding"] for record in records])
    source = ensure_record_id(source_id)
    # Normalize ownership and ordering rather than accepting caller-supplied IDs.
    records = [
        dict(
            source=source,
            order=index,
            content=row["content"],
            embedding=row["embedding"],
        )
        for index, row in enumerate(records)
    ]
    token = uuid4().hex
    await _publish(
        """
LET $claimed = (UPDATE $source SET embedding_publication = $publication_token
    WHERE full_text = $content AND (asset.file_path ?? NONE) = $file_path
    AND time::micros(created) = time::micros($created) RETURN AFTER);
IF array::len($claimed) != 1 { THROW "EMBEDDING_STALE"; };
DELETE source_embedding WHERE source = $source;
INSERT INTO source_embedding $records;
RETURN $receipt;
""",
        dict(
            source=source,
            content=content,
            file_path=file_path,
            created=created,
            records=records,
            publication_token=token,
        ),
        dict(token=token, chunks=len(records)),
    )


async def publish_markdown_embedding(
    record_id, content, created, embedding, revision=None
):
    _validate_vectors([embedding])
    record = ensure_record_id(record_id)
    if record.table_name not in ("note", "source_insight"):
        raise ValueError("Unsupported markdown embedding record")
    if record.table_name == "note" and (type(revision) is not int or revision < 1):
        raise ValueError("Note embedding requires an editorial revision")
    await _publish(
        """
LET $written = (UPDATE $record SET embedding = $embedding
    WHERE content = $content AND time::micros(created) = time::micros($created)
    AND ($revision = NONE OR (revision ?? 1) = $revision) RETURN AFTER);
IF array::len($written) != 1 { THROW "EMBEDDING_STALE"; };
RETURN $receipt;
""",
        dict(
            record=record,
            content=content,
            created=created,
            embedding=embedding,
            revision=revision,
        ),
        dict(token=uuid4().hex),
    )
