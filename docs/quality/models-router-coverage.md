# Model route coverage and unexpected-error privacy

Focused offline final: 159 passed, 2 existing dependency warnings.
No real DB/provider calls, deployment, migration, or full-suite run.
See models-router-final.json for native statement/branch denominators; no exclusions.

New tests exercise real HTTP request/schema/response behavior with synthetic IO,
model/default selection, discovery/sync/count aggregation, sparse provider SDK
capabilities and per-mode configuration, and domain error status preservation.
DefaultModels singleton is explicitly isolated between tests.

Unexpected exceptions formerly appeared in HTTP responses and logger.error
messages/tracebacks. Response-only correction was insufficient. Log-capture red
tests confirmed the remaining leak; 13 route boundaries now use the existing
metadata-only log_boundary_failure helper and an explicit operation allowlist.
Assertions check absence of synthetic secret/path strings from both response and
captured logs, and retain a known operation plus RuntimeError type.
Intentional HTTP/domain validation errors retain existing semantics; this is not
a blanket sanitizer for every upstream library or unrelated log sink.

Failures during test development: response details:null expectation omitted;
a DefaultModels singleton reused earlier state. Both fixture/expectation issues
were fixed without changing production contracts. No limits were relaxed.
