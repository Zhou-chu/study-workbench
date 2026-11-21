# Literal file selection and observed execution

This stage preserves framework route names such as (dashboard) and [id].
Canonical repository file paths remain unchanged in the selection artifact and
partition plan. Only the Vitest include pattern is escaped character by
character; real fixtures verify the literal entrypoint executes while a
glob-like neighbouring path that throws does not execute. Traversal,
backslash-separated and control-character paths still fail closed.

## Observations, not requested-file echoes

Vitest's JSON testResults and Node's native per-file test:summary events provide
the observed entrypoints. The Node reporter does not read the selected list.
Its aggregation records summaries only after the event stream ends; empty
explicit selections have a complete empty observation and do not discover files.
The Node test child does not inherit NODE_TEST_CONTEXT, preventing recursive
test-runner suppression during integration tests.

After each unit partition the orchestrator compares native completed-entrypoint
paths to the selected set. Missing, extra, duplicated, outside-repository,
malformed, failed, or entirely skipped entrypoints fail closed. Each selected
file must have at least one passing assertion/test; individual skips alongside
real passes are not silently counted as executed assertions. These are file
entrypoints, not an assertion that every imported module is a selected test.

Diagnostics are removed before execution. Successful file audits record
executedTestFiles and executionReportHash. Failed audits invalidate the
partition even when the test process exited zero; a pre-existing nonzero child
exit status is preserved. Before/after source, input and selection checks still
apply. No live data, profiles, tool registrations or coverage source exclusions
are changed.

The eleven-partition reporter-double fixture checks routing and deliberate
extra-file rejection, not real coverage rates. Separate actual Vitest and Node
fixtures verify the native formats; actual empty Vitest/c8 fixtures retain zero
covered counters for the untouched source denominator.

## Still blocked, deliberately

Root-level scripts/*.test.mjs belong to quality-tooling. Their combination with
Vitest requires a validated raw-coverage merge for that same full source
denominator. The planner now identifies this exact blocker and fails rather
than omitting them or mapping them to node-tools. This stage does not implement
that merge, Python execution, final unit gate acceptance or CI publication.
Current unresolved classifications still prevent real project unit selection.

These reports are integrity evidence within the trusted checkout/toolchain
boundary, not cryptographic attestation against a malicious same-account test
or reporter. Final gate consumption must recheck execution report hashes and
bind the run to its current selection and source evidence.

## Tests and source

Pure planner and execution-audit tests use in-memory values only. Native
reporter, Git, subprocess and filesystem fixtures remain tool-integration.
Node 24.19.0 events were verified using the installed binary, rather than inferred
from an echo of requested paths. The documented reporter/event interface is:
https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters
https://nodejs.org/docs/latest-v24.x/api/test.html#event-testsummary


## Native status consistency follow-up

The installed Vitest reporter's StatusMap emits passed, failed, skipped, todo,
and pending. Pending can mean run/queued/only, not a completed explicit skip.
Accepted completed assertion records are therefore passed/skipped/todo only,
with at least one passed assertion per file. A passed file/overall flag cannot
override a failed, pending, missing or unknown assertion state. The wider
TypeScript Status union also declares disabled, but this installed reporter
does not emit it; unimplemented values fail closed rather than implying pass.

Node per-file counts must contain nonnegative safe integers for tests, passed,
failed, cancelled, skipped, todo, topLevel and suites. Outcomes must sum to
tests; failed/cancelled must be zero, passed positive, and topLevel bounded by
tests plus suites. Real Node 24.19.0 passing/skip/todo and suite probes verified
these relations. Runtime fixtures exercise accepted explicit skips/todos as
well as malformed/inconsistent pure protocol inputs.
