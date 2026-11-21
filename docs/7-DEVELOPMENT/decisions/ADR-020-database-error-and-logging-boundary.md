# ADR-020: Bound public database errors and selected shared-boundary logs

- **Status**: Accepted
- **Date**: 2026-10-24
- **Related**: [ADR-013](ADR-013-objectmodel-get-error-contract.md), [boundary repair plan](../../superpowers/plans/2026-10-24-architecture-boundary-repair.md)

## Context

Domain wrappers preserve database failures as `DatabaseOperationError`, sometimes
carrying underlying exception text. The generic API handler previously rendered
that text publicly. Logging at shared repository/domain boundaries also rendered
exception messages, validation inputs, user-controlled IDs and tracebacks, so
sanitizing only an outer response did not bound those log events.

## Decision

Register a dedicated `DatabaseOperationError` handler returning HTTP 500 with
`{"detail":"Database operation failed"}` and the existing CORS helper. It also
covers subclasses such as `SnapshotCommitRejected`. Keep other typed handlers
and the generic `OpenNotebookError` handler unchanged: explicit note conflicts,
queue/upload uncertainty receipts and snapshot problems retain their contracts.

Add an API-independent `log_boundary_failure(operation, exc, *, level="ERROR")`
helper. It emits one fixed event with an operation from a static allowlist, a
level from a static allowlist and an exception class name matching at most 80
ASCII identifier characters. Invalid metadata uses fixed `unknown`, `ERROR` or
`UnknownError` fallbacks. It never renders the exception, its arguments, cause or
traceback and does not accept query/model/request data.

Migrate only these selected paths:

- `repo_query`, `repo_create`, `repo_delete` and `repo_insert` failure logs;
- `ObjectModel.get`, `get_all` (including skipped invalid rows), `save`, `delete`
  and `relate`, plus fixed-text preceding update/delete DEBUG events;
- `Notebook.get_sources` / `get_notes`, `SourceInsight.get_for_sources`, and
  `Source.get_insights` / `get_status` / `get_processing_progress`.

Keep exception classes and causes, validation/not-found branches, duplicate
skipping, return values and connection cleanup. Preserve query RuntimeError
DEBUG logging and insert's existing conflict DEBUG/non-conflict ERROR split;
do not reinterpret every RuntimeError as a transaction conflict or add retries.
Where wrappers lacked explicit chaining, retain the original as `__cause__`.

## Consequences and limits

Public database failures no longer expose their internal detail. These selected
logs sacrifice payload/traceback diagnostics for a bounded event and exception
type; operational tooling can group by operation, type and severity instead.
The original exception remains available in-process for propagation, not for
automatic inclusion in a log or response.

This is **not a global logging/privacy guarantee**. Other notebook paths (for
example deletion, embedding submission and search), provider classification and
other modules have not been migrated. Logging sink configuration, external SDK
logs and ambient logging context are not redesigned here. The provider error
classifier remains a separate priority repair.

Offline tests exercise actual wrappers and registered handlers without lifespan,
and capture a real Loguru sink with synthetic payload/cause/validation sentinels.
They cover severity, chaining, cleanup and compatibility receipts; they are not
database, provider, browser or deployment acceptance.

## Alternatives considered

- Sanitize only routers: rejected because shared wrappers still reach the generic
  handler and lower-level logs would remain unchanged.
- Truncate arbitrary messages: rejected because short secrets are still secrets.
- Replace all typed responses or all project logging: rejected because it would
  erase specific recovery receipts and exceed this bounded repair's evidence.
