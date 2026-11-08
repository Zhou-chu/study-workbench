# Notebook SPA contract baseline

The A1 baseline retains deployed source 91a92fa plus the tested same-origin Cookie
compatibility fix 8ab9e7d. It adds two authenticated, read-only FastAPI routes:

- `GET /api/personal/notebooks/{notebook_id}/workspace-view`
- `GET /api/personal/client-capabilities`

The root workspace lock made Next infer the repository tracing root, relocating
its standalone entrypoint under frontend/. The legacy next.config.ts now explicitly
pins outputFileTracingRoot to its own directory. An actual Next-config regression
and the unchanged strict artifact builder verify the independent legacy build.
No artifact-integrity check was relaxed.

The old workspace endpoint and every existing write/request protocol remain
unchanged. The versioned view calls the same `PersonalService.workspace` membership
and notebook lookup, then projects its `jsonable_encoder` wire representation. It
never invokes generic GET-job, dispatch, provider, migration or worker code.

## New read contract

`schema_version` is `workspace-view-v1`. Notebook, source/version, note, turn, job,
selection, link and legacy history have explicit field allowlists. Missing and null
values stay distinct. Unknown engine/origin/state strings stay verbatim; no unknown
value authorizes an action. A classic source without an authoritative version keeps
its source identity; a source_version_id is never invented. Valid derived lineage,
nullable independent_support, citation identity and locator members are retained.
Independent-support metadata is never proof of independent corroboration.

`projection_status`, when present, is `unknown` or `invalid`. It is a safe
non-actionable branch, not the raw rejected value. No unknown extension names,
values, internal paths, provider errors or credentials are exposed. Malformed
collection rows retain their position as markers; identifiable partial rows keep
safe IDs, so collisions and adjacent malformed history cannot disappear. Markers
propagate through relevant containing objects and survive decoding. A retained
null marker is treated as unknown, never shape-known. Absence of a marker proves
only an understood shape, not authorization, request validity, completion or replay.
A marker in one source does not create authority in an unrelated job; consumers
must validate the complete relevant recovery proof rather than discard markers.

Known excluded input-only members are reviewed per model: version file_path;
turn provider usage/request_hash; job worker_job_id/request_hash/lease_until/dispatch_after;
and artifact file_path/path. They are not part of reconciliation identity or
answer equality. Every other omitted extension marks the object unknown. Scope,
citation, locator, remote_reference, retrieval and request_snapshot each have their
own allowlist; proof-subtree extras cannot be silently removed to create equality.
Raw error payloads become markers, with no provider message retained.

Unreviewed non-chat operation result variants (including sync/import/Google-child
ask) remain non-actionable. Reviewed source-snapshot, maintenance, remote-notebook
and artifact results have separate allowlists. They are never parsed as CHAT
results. Standalone version/turn/job parsers are safe adapters, not a statement
that the old detail/job endpoints are fully sanitized on the server.

## Recovery evidence and dispatch receipts

Read jobs retain parent operation/job/turn/notebook/chat/idempotency identities,
submission and raw state/status, restore/replay markers, exact request fields,
and operation-specific result proofs. Turns and CHAT results retain status,
state/generation_status, answer, scope, citations and exact retrieval fields.
Current grounded-turn scope mapping_version, grounding_status, model_id, pipeline_version, top-level scope_hash and the bounded numeric budget fields are also explicitly retained. Omitted retrieval defaults are not inserted. Array order and null/absence remain
significant. A Google child result job_id is displayed separately and never becomes
the parent's binding.

`dispatch_receipt` absence stays absent; present null stays null and makes the job
invalid. Present objects use `DispatchReceiptView`: either
`{ validity: "valid", receipt: { dispatch_ack: "unknown", job_id, turn_id,
retry_safe: false } }`, or only `{ validity: "unknown" | "invalid" }`. The valid
raw receipt must have exactly four keys, nonblank unmodified IDs, the exact boolean
false and IDs agreeing with any siblings. Extra fields, malformed/null receipts,
future values and mismatched IDs never become a valid receipt after projection.

`parseWorkspaceView` requires the versioned envelope and decodes projected jobs.
`parseJobView(value)` defaults to legacy raw input and will not trust a validity
wrapper merely found in historical data. For a job already obtained from the new
versioned contract, use `parseJobView(value, "workspace-view-v1")`. The format is a
caller/endpoint choice, never inferred from untrusted body fields. Marked proof
branches remain marked in either route.

`OperationReceipt` is only `{ job_id, turn_id?, state? }`, a generic local handle.
`OperationState` is local UI state and must not overwrite raw server state.
`readTurnPostOutcome` separately receives the actual HTTP status and raw POST body.
2xx binds nonempty job/turn IDs but does not prove completion. HTTP400 binds only
exact WORKER_UNAVAILABLE plus an exact raw dispatch receipt; contradictory sibling
IDs remain inconclusive. Its stable binding is check-only, never replay authority.

A4 owns reconciliation, using workspace jobs plus separately read canonical chat
history. Workspace.turns is not canonical-history substitution. Completion still
requires one matching canonical turn, confirmed parent submission, matching
identity/status/retrieval and equal answer/scope/citations. Restored/replay markers,
collisions, malformed neighboring rows and unknown proof branches stay blocking.
No generic GET-job or POST belongs to a read-only reconciliation check.

## Capabilities and existing write DTOs

The authenticated API, not the BFF's self-report, returns
`contract_version: client-capabilities-v1`, supported workspace-view-v1, the actual
source-upload byte limit and the exact `get_portable_limits().public()` keys.
Upload and capabilities share `get_source_upload_max_bytes`; the existing
STUDY_WORKBENCH_MAX_FILE_MB fractional-MB calculation and 50 MiB default are intact.
Missing, malformed or future API capabilities must not release new-protocol writes.

The contracts package exports existing TurnRequest, CreateWorkbenchNoteInput,
UpdateWorkbenchNoteInput, WorkbenchNote and citation/scope/provenance/source-snapshot
dependencies independently of read views. Conditional note update still requires
expected_revision. Note create has no enforced idempotency key. No new backend
idempotency protocol, task dispatch or backend business rewrite is introduced.

## Verification boundary

Fixtures are synthetic. A1 covers raw Python projection, HTTP serialization and TS
decoding, including recovery evidence retention and adverse receipt/request shapes.
Full existing offline backend/frontend regressions and static checks are run before
commit. This is not browser/visual, provider/Google, real DB/worker, Docker or
production acceptance. Running services, ports, settings, Cloudflare, credentials,
deployment snapshots and existing user data are untouched.
