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

- `workspace.json`: empty workspace response, including nullable link/selection.
- `job.json`: real deterministic independent-turn submission with opaque stable
  job/turn IDs, nullable request fields, UTC timestamp and `not_submitted` state.
- `turn.json`: local-cancellation SSE payload (not remote cancellation), and an
  unmapped Google citation whose nullable local identity remains unverified, plus
  retained archive evidence which is historical rather than freshly verified.
- `errors.json`: actual exception-handler envelopes; local idempotency conflict
  currently returns 400/detail, bridge conflict 409/error. A generic capability
  error currently returns 502; scope-isolation failure is 422. Do not normalize
  these differences in a client without a separately reviewed API change.
- `note-conflict.json`: an explicit **gap record**, NOT a response fixture.
  Conditional note writes, revisions, expected_revision and 409 note conflict
  responses do not exist yet. No concurrency/auth behavior changes in this batch.

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
