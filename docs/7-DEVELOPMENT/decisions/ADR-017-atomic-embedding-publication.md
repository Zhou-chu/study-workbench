# ADR-017: Guarded atomic embedding publication

- Status: Accepted
- Date: 2026-10-22

## Decision

Generate and validate every vector before mutating the visible index. Publish a
source's complete chunk set in one explicit transaction. A changed publication
token on the **source row** is the common write conflict point for publishers,
source edits and deletion; a range DELETE alone does not protect empty indexes
against concurrent insertion. The guarded UPDATE must find the original content,
file-path input and creation identity. It never creates a missing source.

Replacement deletes and inserts are inside that same transaction. Retrieval,
chunk counts and rebuild queries continue to see the existing source_embedding
schema: no staged generations can leak into searches. Migration 29 adds only an
optional publication token, leaving existing indexes valid.

Note publication checks the captured editorial revision and content. Every
editorial revision clears its old embedding in the same editorial transaction,
so failed re-embedding cannot leave a vector falsely attached to newer content.
Insight publication checks content and creation identity. Creation comparisons
use microseconds because the locked Python SDK truncates DB nanoseconds.

## Acknowledgements and retries

Use query_raw: the locked SDK query() discards all but the first statement result.
SurrealDB 2.3.10 RETURN suppresses preceding successful statement outputs.
Validate every returned result and require exactly two successful acknowledgements:
the publication receipt followed by a matching post-COMMIT marker. Only a complete
abort envelope (all transactional results ERR, then the matching terminal marker)
allows classification as a definite abort and retry from a fresh load. ERR-only
or mixed/unrecognized envelopes remain unknown even if their text names a conflict. Transport errors or missing/malformed acknowledgements are unknown outcomes
and must **not** automatically replay. Never issue compensating deletion: a
successful publication may have committed despite a lost acknowledgement, or a
concurrent publisher may now own the index. Cancellation propagates unchanged;
the retry inclusion list excludes BaseException/cancellation.

An operator may inspect the source publication token and complete stored chunk
set before explicitly requesting a fresh rebuild. An unknown result is not proof
that the index was unchanged. This is not a durable command-id receipt service.

## Bounds and alternatives

Publication is capped at 2000 chunks and 8 MiB of serialized parameters before
opening a transaction. Larger indexes fail without altering the previous set.
This avoids silently reverting to independently committed batches. Remote
embedding computation still holds the generated vectors in memory.

An explicit active-generation architecture could scale staging independently,
but requires changes to every retrieval/count/rebuild consumer and orphan
collection. It is intentionally outside this bounded correctness repair.

Real isolated SurrealDB acceptance is required: mocks cannot prove rollback,
write conflicts or source-deletion interactions. Tests use an opt-in owned
in-memory 2.3.10 process, fixed public fixture credentials and a fresh port/database;
no configured runtime database is contacted.

### Running disposable acceptance

Select an existing executable explicitly; the fixture does not discover a sibling
checkout, inspect live configuration, or download software:

```sh
EMBEDDING_DISPOSABLE_DB=1 \
EMBEDDING_TEST_SURREAL_BINARY=/absolute/path/to/surreal \
pytest tests/test_embedding_publication_integration.py
```

The currently verified fixture provenance is the official SurrealDB 2.3.10 Linux
x86-64 executable with SHA-256
`bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7`.
The fixture checks that digest and executable permission before spawning. Other
platform binaries require an independently verified provenance/digest update;
there is no hash bypass or automatic download. The explicit enable flag is
required even when the executable path is configured.
