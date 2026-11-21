# BFF transport equivalence and recovery

This is a dormant standalone Node BFF. Tests use owned ephemeral HTTP servers,
synthetic data and synthetic device sessions only. They do not prove browser,
private ingress, FastAPI/database/worker, provider, deployment or device activation.
The old Next implementation and direct API behavior are unchanged.

## Interfaces and custody

`createBffHandler(config, options?)` and `createBffServer(config)` are unchanged.
The optional handler Fetch/store seam is server-only test configuration. It cannot
select a destination from a browser request. The fixed upstream, static 155-route
method/encoding gate, trusted public Origin and mode checks precede dispatch.
Only the reviewed synthetic native branch can use explicit origin-less writes;
its flag remains false by default. Safe reads retain their reviewed no-Origin
behavior. Legacy browser mutations need exact Origin, without device-only CSRF.

`classifyIngressResponse(status, contentType, location)` in `src/public-config.ts`
returns `expected`, `ingress_reauth` or `unavailable` for the response received at
this BFF hop. JSON application errors and binary/text downloads remain ordinary
responses. Observable HTML/XHTML and non-304 redirects are conservative ingress
hints, not proof that an application session is invalid. The classifier reads no
body, credentials or Cookie. It does not retire a handle or replay an operation.

F15 (controller ruling, 2026-11-08): preserve BFF `redirect: 'manual'` with no
following and established fixed 502 sanitization, no Location/body forwarding;
A4 handles browser `redirect: 'error'`. BFF cannot observe Cloudflare interception
before it. A browser redirect rejection may reveal neither status nor Location,
so it cannot prove auth loss. The browser owns preserving drafts/operation identity
and deciding what explicit reconciliation is allowed.

All incoming platform/app Cookie fields terminate at BFF. Only reviewed explicit
legacy Bearer or BFF-held device access reaches API. Unreviewed response headers,
upstream Set-Cookie/CORS/Location, and stale compressed Content-Length/Encoding
are omitted. BFF login's independent cookie fields remain separate, including
obsolete-cookie migration. Refresh and status never issue a new stable cookie.

## HTML and variable-MIME artifacts

F17 (controller ruling, 2026-11-08): preserve successful 200/206 HTML only on the
exact reviewed `/api/personal/artifacts/{artifact_id}/download` template, valid
attachment Content-Disposition and no Location. Keep bytes opaque, no-store and
nosniff. Disposition is not authentication/trust evidence and never permits
automatic rendering or execution. Reject HTML for JSON/SSE and fixed-MIME
downloads, non-success responses, inline/missing/malformed disposition and
redirect-bearing cases. Rejection cancels the upstream body and returns the
existing sanitized 502 envelope without treating HTML as typed AUTH_REQUIRED.

Evidence: `api/routers/notebooklm.py` artifact download passes stored `mime_type`
to FileResponse with attachment filename; `docs/v1/STREAM_DOWNLOAD_PROTOCOL.md`
explicitly permits variable artifact MIME. Other approved producers emit
source octet-stream, PDF/plain/markdown originals, ZIP exports and podcast audio.
The new-package non-auth error parity fixture therefore preserves JSON 401
verbatim; HTML 401 is the approved sanitized-ingress delta. No old Next test or
API handler was changed.

## Streaming and budgets

F16 (controller ruling, 2026-11-08): retain existing 10-second auth/probe and
8-KiB auth JSON / 256-KiB session-list budgets plus current native HTTP defaults.
Do not invent a blanket business idle timeout. Business bodies keep the existing
API limits; there is no new 8-KiB business-file cap or arbitrary rewrite cap.
Auth JSON alone uses bounded buffering; resource JSON 401 observation remains
bounded and reconstructs original bytes. SSE, multipart and downloads are not
parsed/re-encoded by BFF. Multipart retains boundary, duplex and original bytes.

The request bridge opens a pull-based IncomingMessage iterator lazily. It uses
`destroyOnReturn: false` so canceling an oversized auth body stops application
reads without destroying the shared response socket before structured 413 can
be delivered. Real downstream upload/response disconnects still abort the upstream
fetch. ServerResponse write/drain backpressure controls response pulls.

F18 (controller ruling, 2026-11-08): successful explicit native auth also requires
bounded JSON/media validation: 8 KiB normally, 256 KiB for the session list.
Documented empty 204 remains empty. Valid native token JSON stays exclusive to
the already-classified synthetic native branch; no Web token exposure, authority
change or native activation occurs. Re-serialized auth JSON drops its old length.

## Loss-hop evidence

- API to BFF: truncated refresh acknowledgement after synthetic commit, invalid
  envelope/extra fields, 429, 503 and owner deadline each retire the handle. No
  old refresh resend, successor reconstruction or business replay occurs.
- BFF to browser: after the new pair is installed, the test holds response
  delivery, disconnects the real HTTP client, then releases delivery. The same
  stable cookie recovers generation 1 through status and a successor-access
  probe. There is exactly one native rotation, including an explicit later
  refresh fast path. Five admitted overlapping refresh calls also rotate once.
- Upload receipt loss: preserve exact original multipart operation field/body;
  one upstream mutation only. The generic transport failure does not prove that
  the upload was not accepted, and does not authorize retry.

## Acceptance evidence boundaries

`streaming-http.test.ts` gates SSE production on receipt of incomplete UTF-8 and
JSON prefixes, and gates upload EOF on upstream receipt of its first bytes.
Final exact byte/hash checks, real gzip decoding, range/error headers, both
upload/SSE disconnects and deterministic write/drain instrumentation cover the
adapter without using relaxed sleep timing as streaming evidence.

`private-ingress.test.ts` sends real unfinished chunked upload bytes for rejected
route/method/raw-encoding/duplicate-authority/mode cases in both modes. The fixture
instruments both IncomingMessage iterator entry points and every adapter
application `next()`/byte read. They remain zero for these rejections, with a
successful 1,048,593-byte binary upload as positive control. This is application
reader evidence, not a claim that the kernel/network received zero bytes; Node
may discard unread request bytes after responding. This closes the A2 Minor
where raw rejection fixtures sent no upload body.

`auth-loss-hops.test.ts` uses actual HTTP auth/session bodies and independent
in-memory synthetic clocks for the existing owner deadline. No real credentials,
native ingress or device mode configuration is activated.
