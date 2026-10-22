# V1 API contract foundation (T3a)

`openapi.json` is the **whole current application's** `api.main.app.openapi()`
output, sorted recursively by JSON object key with UTF-8, two-space indentation
and one trailing newline. Lists, operation IDs, descriptions and schema semantics
are not rewritten. This is a drift baseline, **not a fully typed multiclient API**.

## Export and check

From the repository root, using the project's installed Python environment:

```sh
PYTHON_DOTENV_DISABLED=1 python scripts/v1/export_contract.py
PYTHON_DOTENV_DISABLED=1 python scripts/v1/export_contract.py --check
```

The script also works by absolute path from any working directory. `--output PATH`
selects a different snapshot (relative paths are relative to the caller).
`--check` compares bytes, returns 1 on drift/missing snapshot, and never creates or
rewrites files/directories. Export/import failures return 2. Export success or a
matching check returns 0. Regenerate deliberately and review the diff; a passing
check does not approve a breaking change. Additive changes require review; breaking
changes require a new contract version and an explicit compatibility window.

### Import isolation

The exporter uses a fresh child process, a small explicit environment without
ambient credentials, `*_FILE`, HOME, proxies or Python startup variables, and
`PYTHON_DOTENV_DISABLED=1`. It never enters FastAPI lifespan or starts migrations,
workers, providers, or remote database connections. Existing app imports normally
create four data directories and open two SQLite checkpoints: only those known
scaffold calls are replaced with no-op directory setup and `:memory:` SQLite.
Routes, models, dependencies and `app.openapi()` are unchanged. Audit guards reject
network connections/DNS/bind, child subprocesses, disk SQLite and filesystem
writes; bytecode writes are disabled. These are regression tripwires, not a security
sandbox against malicious Python or native extensions. The only intended file
write is the parent's explicit output in export mode. No live credentials, dotenv,
Google session or real user data are needed or read.

## Public synthetic examples

All examples were authored for this repository; none are captured user traffic.
They are illustrative **existing runtime** contracts, tested offline against real
service/handler/mapper code with in-memory persistence and no provider calls.

- `workspace.json`: synthetic note at revision 1, including nullable link/selection.
- `job.json`: real deterministic independent-turn submission with opaque stable
  job/turn IDs, nullable request fields, UTC timestamp and `not_submitted` state.
- `turn.json`: local-cancellation SSE payload (not remote cancellation), and an
  unmapped Google citation whose nullable local identity remains unverified, plus
  retained archive evidence which is historical rather than freshly verified.
- `errors.json`: actual exception-handler envelopes; local idempotency conflict
  currently returns 400/detail, bridge conflict 409/error. A generic capability
  error currently returns 502; scope-isolation failure is 422. Do not normalize
  these differences in a client without a separately reviewed API change.
- `note-conflict.json`: actual 409 `detail` object for a stale note revision.
  Personal PATCH and legacy PUT accept strict positive integer `expected_revision`.
  Native note revisions and personal snapshots commit together; creation starts at
  1 and each editorial update increments once. Embedding-only jobs do not increment.

`GET /api/personal/note-capabilities` reports contract version `v1`, conditional
write support, and whether expected revisions are required. The default
`STUDY_WORKBENCH_NOTE_WRITE_MODE=legacy_single_web` permits omission/null for
compatibility; `multiclient` requires a predecessor (428 `detail.code` =
`NOTE_REVISION_REQUIRED`). A supplied predecessor is enforced in either mode.
Invalid modes fail startup. This does **not** activate multiclient mode or certify
Web/native clients. Unknown commit acknowledgement is a 500 detail string: keep
the draft and reconcile with a read; never automatically resubmit.

Membership, not snapshot existence, authorizes personal writes. Missing/foreign
membership returns 404 before any revision is exposed. Shared notes expose native
content/revision but not another notebook's snapshot citations/scope. Portable
archives preserve revision N under new IDs; legacy absence means 1, and invalid or
inconsistent duplicate revisions are rejected before writes.

## Known schema gaps and release gates

Many `/api/personal` responses are `{}` or generic dictionaries. Examples are not
new response models and JSON-schema acceptance of `{}` is not meaningful runtime
validation; tests therefore exercise existing runtime code separately. Typed
requests (for example TurnRequest enums and nullable model IDs) are authoritative
where present. The schema does not yet describe all runtime response fields,
error envelopes/statuses, UTC timestamp constraints, cancellation/submission
states, citation provenance, download media types, or SSE events. Binary export
and original-download paths and multipart import shape remain unchanged;
existing evidence/portable tests retain path-confinement and byte-preservation
coverage. This snapshot does not certify those properties by itself.

Before native clients: add and review typed public response models, conditional
note writes, explicit compatibility handling, and T4 authentication; regenerate
this owner-controlled snapshot. Do not infer conditional-write capability or
multi-device safety from the `v1` directory name. Real-model/Google acceptance
remains a separate gate; offline fixtures do not claim provider compatibility.

## Gated device-session auth

The actual-app schema includes the additive native session routes. Issuance is
unavailable under default `legacy_password`; `device_sessions` must be explicitly
configured, and deployment remains gated on the Web/ingress migration. Status
keeps its legacy `{auth_enabled,message}` response; device mode instead returns
`{auth_enabled:true,auth_mode:"device_sessions",protocol_version:1}` or 503.

Auth requests are JSON objects with no extra fields, capped at 8 KiB before
parsing. Validation errors are sanitized 400, never FastAPI's input-bearing 422.
Auth responses/errors are no-store/nosniff; 401 includes Bearer challenge, 429 an
integer Retry-After. Token dates are canonical UTC `Z`. Examples under `fixtures`
are synthetic, never usable credentials. Protocol and limitations are specified
in `docs/v1/DEVICE_SESSION_PROTOCOL.md` and ADR-015. These local contracts do not
prove native-vs-browser classification at the private ingress.

Device-mode auth-only routing misses retain HTTP404/405 (including Allow on405)
with `{error:{code:"AUTH_INVALID_REQUEST",message:"Invalid authentication request."}}`.
This matches the auth router's default error schema; resource routing errors
remain unchanged. Auth schema integrity is checked on every store operation;
missing tables/fields/index constraints fail closed, never trigger implicit
SCHEMALESS table recreation. Stop the API before administrative DDL or restore.

## R2a: durable operation response slice

POST personal chat turns now describes a `TurnSubmissionResponse` receipt
(`job_id`, `turn_id`, raw `state`), not a completed turn. GET personal job and
explicit POST cancel describe current durable metadata or a historical archive
record. These three responses preserve extension fields and omit unset model
fields; absent values do not become null/default values. Personal timestamp strings
are not rewritten to auth's canonical `Z` format.

State/operation/submission strings are open for compatibility. Unknown values are
not permission to retry, replay or cancel. `submission_unknown` is not a confirmed
failure; `cancelled_local` does not guarantee remote termination. Restored history
retains `historical_state`, `restored_history`, and `replay_allowed:false`; its other
fields remain opaque because historical archive readers did not enforce current
job shapes. Current operation-specific result/error JSON also remains deliberately
opaque in this slice; this is not a fully typed SDK contract.

GET job can dispatch existing remote/maintenance work. Contract tests inject
in-memory boundaries and do not call providers. `job-states.json` and
`turn-submission.json` are synthetic and exercise lossless router serialization,
including nullable fields, unknown states, restored provenance and extension data.
SSE, binary and nested workspace response gaps remain separate work; they are
not fixed by these operation models.

## R2b: workspace envelope and nullable Web fields

Workspace and selection-save response schemas now describe the proven envelope,
with extra fields retained and unset fields omitted. Native workspace notes differ
from personal write receipts: title/content may be null or absent, and citations
and scope need not exist. Workspace selection and remote citation source titles
can be null. Real-service/ASGI tests cover those cases and opaque archive records.
Nested historical jobs/turns, versions/provenance, selection/link metadata and note
snapshot extensions intentionally remain opaque, not a complete native SDK.

Existing raw workspace versions can contain storage `file_path`; preserving that
wire behavior here does not make it a supported stable public field. A safe public
version projection/redaction remains a separately reviewed residual task. No
persistence SourceVersion model is used as a public response DTO.

## R2c: personal transport declarations

Four personal stream/download operations now describe true SSE/binary success
bodies and permissive existing application error envelopes, without changing
runtime serialization. `fixtures/stream.json` is exact synthetic SSE output from
the real handler (including in-band error and incomplete bounded EOF). Download
tests exercise original/export/artifact handlers, raw bytes and middleware headers.
See `docs/v1/STREAM_DOWNLOAD_PROTOCOL.md` for client rules and remaining gaps.
Legacy SSE/download operations and opaque nested histories remain outside this
slice; the earlier known-gap statements still apply to those untyped operations.
