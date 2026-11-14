# R2c: personal stream, download and error boundary

This is a description of existing handlers, not a new transport or native SDK.
Only the four personal routes below gain OpenAPI transport declarations. Legacy
search/source-chat SSE and other application download routes are outside this
slice. Runtime bytes, status mapping, authentication and storage remain unchanged.

## Turn events

`GET /api/personal/turns/{turn_id}/events` returns UTF-8 `text/event-stream`,
not a JSON response and not model-token deltas. Current frames use `event: NAME`,
then one `data: JSON` line and a blank line. Transport chunks need not align with
UTF-8 characters, lines or frames. A future client must incrementally decode UTF-8,
buffer incomplete frames, and support standard SSE comments and multiline data;
never parse each network chunk as JSON. No client parser is introduced here.

| Event | Current data | Meaning |
| --- | --- | --- |
| `stage` | Stored turn with `status`, or job summary `{turn_id,state,error}` | Opaque historical/extension data is retained; these two shapes differ. |
| `final` | Stored turn with `status: succeeded` or `failed` | Terminal turn, not necessarily success. |
| `error` | `{code:"TURN_NOT_FOUND"}` | In-band missing-turn result after HTTP 200, not HTTP 404. |

A `cancelled_local` job takes precedence even over a late stored final turn. Its
stage may contain `remote_may_continue`; absence is not a remote cancellation
receipt. With no stored turn, `failed`, `submission_unknown`, and
`cancelled_local` job stages end the stream. Other job stages can repeat every
iteration; stored turn events are emitted only when status changes (not when
other fields change). The loop is bounded at 120 iterations with one-second
waits, not a guaranteed wall-clock deadline. Silent EOF after that bound is normal.

Client rules:

- EOF, disconnect, timeout, malformed data or local abort without a recognized
  terminal outcome is **incomplete**, never success or confirmed remote failure.
- Ignore unknown event types for control flow; retain safe diagnostics. Unknown
  state/status values must not unlock success, retry, cancellation or replay.
  Do not render arbitrary historical JSON as trusted markup.
- Aborting the HTTP stream stops local listening only. Explicit job cancel is a
  separate POST and still does not guarantee termination of remote work.
- There are no event IDs, retry fields, replay cursor, heartbeats or Last-Event-ID
  resume semantics. Reconnecting observes current durable state and may repeat
  events; it cannot reconstruct a complete event log. Do not blindly auto-replay
  the original turn submission after disconnection.
- `submission_unknown` means acceptance may have happened. Preserve the existing
  job/turn and reconcile; never silently create a fresh idempotency key. GET job
  may dispatch existing remote or maintenance work: **GET is not blanket evidence
  for safe automatic retries**. Reconciliation is an explicit operation policy.
- Check HTTP status and Content-Type before entering the SSE decoder. An HTTP
  error is not an SSE `error` event; errors after streaming starts may instead
  terminate the connection without a structured frame.

`contracts/v1/fixtures/stream.json` is synthetic exact wire output tested against
the actual generator, including unknown-state bounded EOF and nullable errors.
Historical turn payloads intentionally remain opaque; no false required-field
claims or closed state/event enums are imposed on stored records.

## Protected downloads

All paths are under `/api/personal`, require application authentication and use
server-resolved identities, never a client filesystem path:

| Path | Body media | Content-Disposition |
| --- | --- | --- |
| `/source-versions/{id}/download` | `application/pdf`, `text/plain`, `text/markdown` only | `inline`, stored source title |
| `/exports/{id}/download` | `application/zip` | attachment `study-workbench-project.zip` |
| `/artifacts/{id}/download` | Stored artifact MIME; not restricted to audio | attachment, resolved path basename |

OpenAPI uses binary strings, with `*/*` for variable artifact MIME, not JSON or a
base64 wrapper. Text originals receive the framework's UTF-8 charset. Filenames
may use RFC5987 `filename*` encoding. Handler cache policy is no-store (exports
and artifacts also specify private); personal security middleware can replace it
with no-store and adds nosniff. Authentication failures may be returned earlier
by outer middleware; do not assume every rejected response has identical headers.
Existing FileResponse range behavior is declared too: 206 uses the original MIME
for a single range or multipart/byteranges for multiple ranges; malformed Range
returns 400 text/plain, unsatisfiable Range returns 416 with an empty text/plain
body and Content-Range. These framework responses are not JSON errors. Clients
that do not implement partial-body validation should request full files and not
save a 206 body as a complete file. The contract adds no range/resume/checksum
request semantics; this is unchanged framework behavior, not a new portable
resume promise.

Clients must verify status and media before treating a body as a successful file,
stream bytes rather than JSON-decode them, keep partial files distinct from
completed downloads, and preserve raw bytes. Treat server filenames as suggestions:
strip paths/control characters, choose an app-owned destination, and never execute
or automatically render unknown artifact MIME. Content-Disposition is not trust.

Use the configured trusted API origin with its authentication mechanism. Do not
put bearer tokens in URLs, external browser links or logs. Disable automatic
cross-origin redirects for authenticated stream/download requests; never forward
credentials to another origin or downgrade HTTPS. Unexpected redirects require
explicit validation, not an assumption that a redirected login HTML page is a
file. No remote signed-URL flow is defined by these handlers.

## HTTP errors: preserve differences

The four transport routes document application errors with a permissive union:
`{detail: ...}` or `{error:{code,message,...}}`. This is not normalization or a
claim that every status is reachable on every route. `detail` can be a string,
a revision/submission object, or FastAPI's validation list. Existing bridge
errors differ from local errors: local idempotency conflict is 400/detail, bridge
conflict is 409/error; bridge capability failure can be 502. Auth/private middleware
has its own error codes. Preserve HTTP status, headers and the original envelope.

The explicit 422 declaration includes both validation-list and application error
shapes instead of falsely promising only HTTPValidationError. `default` describes
known application envelopes and unhandled-server plain text, not arbitrary ingress failures: proxy HTML/plain text,
empty bodies and transport failures remain possible. Parse defensively with bounded
body handling, preserve a safe fallback, do not display sensitive raw validation
input or HTML, and do not infer retry safety solely from 401/409/429/5xx or a GET.
401 can mean application authentication or bridge reauthentication; inspect the
code without conflating them. Respect applicable Retry-After without treating it
as permission to replay a write. Existing fixtures cover handler envelopes;
this slice adds transport coverage, not exhaustive endpoint error certification.

## Remaining gate

A small dependency-free shared incremental SSE parser may be useful next, but
requires separate design/fixtures for chunk boundaries, multiline frames, limits,
unknown events and cancellation ownership. No untested native projects or shared
parser are generated here. Native release, device/ingress activation and actual
provider/Docker acceptance remain separately gated.
