# Strict device-session protocol — implementation decisions

2026-10-21. Read-only code review against canonical checkout HEAD `75e1a6cafd3908e933730c000c591c7b2f2238a4` and approved T4/T5. The integration owner adopts the bounded defaults below for implementation; this is not implemented/tested security evidence. No network, credentials, provisioning or source edits performed. Supersedes the exploratory deterministic-recovery section in `study-device-auth-review.md`; HMAC recovery, grace replay, encrypted replay caches and new signing secrets are OUT of initial scope.

## Verdict and implementation gate

Strict random one-use refresh is implementable with digest-only storage and conservative recovery. **Reject duplicate refresh; do not automatically revoke its family.** A delayed legitimate duplicate and stolen-token replay are indistinguishable without an additional reviewed protocol. Rejection without revocation protects the winner from false logout, but does not detect/revoke a thief who wins the race. Record this deliberate limitation rather than advertising comprehensive theft detection.

T4 implementation waits for backend integration/ownership handoff: backend currently owns `api/main.py` and migration 27. Canonical checkout currently registers through 26; this does NOT make 27 available. Reserve 28 only after checking integrated files and coordinating manager ownership. ADR-014 currently appears free; recheck at implementation. T4 and T5 activate atomically; native clients wait for regenerated actual-app contract and T2 ingress gate.

## 1. Frozen invariants

- One API process and one frontend instance, one host; worker never issues/validates device sessions. No multi-worker claim. Async DB access only.
- Access lifetime is `min(issued_at + 15 minutes, session_expires_at)`. Session/refresh lifetime is absolute `created_at + 30 days`; rotation never extends it. Server UTC governs `now >= expires_at` rejection.
- Access and refresh each contain independent CSPRNG 256-bit secret material. Suggested wire form: `swa1_` / `swr1_` plus unpadded base64url of 32 bytes. Session ID is independent random UUID, public metadata, not authorization. Tokens are opaque to clients.
- Store SHA-256 digests of complete typed token strings, never raw tokens, passwords or a plain hash verifier of the human password. No new persistent crypto secret. Use constant-time secret comparison for password and any in-process digest comparison.
- Every protected request checks current credential availability, boot/credential epoch, session expiry/revocation and access digest/expiry in authoritative storage. No positive-auth cache that survives revocation.
- Revoke commit rejects authentications starting afterward. It does not roll back writes already authorized or kill established SSE streams in this initial contract. Document this precisely; continuous stream revocation would be a separate implementation requirement.
- API startup creates fresh in-memory boot epoch before readiness; all existing sessions become invalid, including after full DB restore. Do not persist/reload epoch. Restoring DB under a running API is unsupported; restore procedure must stop/restart API.

## 2. Native HTTP contract

All listed auth responses, including errors, carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. No credentials in URLs, redirects, errors, logs or tracing. Requests use JSON objects, no extra fields; JSON bodies max 8 KiB, device name 1–80 Unicode characters after trim, password max 4096 UTF-8 bytes. Render device name as text, never HTML.

| Method and route | Request | Success |
|---|---|---|
| GET `/api/auth/status` | No credential required | 200 `{auth_enabled:true,auth_mode:"device_sessions",protocol_version:1}`; unavailable credential/store readiness → 503, never `auth_enabled:false` in private session mode |
| POST `/api/auth/sessions` | `{password,device_name}`; no access header | 201 token envelope below |
| POST `/api/auth/sessions/refresh` | `{session_id,refresh_token}`; no access header required | 200 fresh token envelope; strict one-use |
| GET `/api/auth/sessions` | `Authorization: Bearer <access>` | 200 `{sessions:[metadata...]}` |
| DELETE `/api/auth/sessions/{session_id}` | Access Bearer; no body | 204, including absent/already revoked target; caller must still authenticate |
| DELETE `/api/auth/sessions` | Access Bearer; no body | 204 after atomic revocation of all existing sessions including caller |

Envelope: `{session_id:string,access_token:string,refresh_token:string,access_expires_at:string,refresh_expires_at:string}`. Datetimes canonical RFC3339 UTC with `Z`. `refresh_expires_at` is the immutable session deadline.

Metadata: `{session_id,device_name,created_at,last_used_at,expires_at,revoked_at,is_current}`; dates strings, `revoked_at` nullable. List only current-epoch, non-expired sessions (including revoked rows if retained), sorted `(created_at,session_id)`. No token, digest, password, boot epoch or internal record ID. `is_current` comes from authenticated session, never caller input. No extra `/session` or `/auth/refresh` endpoint is needed; those were exploratory suggestions, not T4 routes.

Auth error envelope: `{error:{code:string,message:string}}`. Typed auth exceptions/handlers must emit this consistently instead of existing generic `{detail:...}` handlers. Do not change unrelated resource error contracts.

| Status | Code | Meaning/action |
|---|---|---|
| 400 | `AUTH_INVALID_REQUEST` | Malformed schema/token syntax/UUID; sanitize validation errors so submitted password/token is never echoed |
| 401 | `AUTH_INVALID_CREDENTIALS` | Wrong login password; generic message |
| 401 | `AUTH_REQUIRED` | Missing/unknown access, revoked/expired session, wrong epoch; same public result for guessed IDs |
| 401 | `ACCESS_EXPIRED` | Recognized access digest expired while session otherwise valid; explicit refresh permitted |
| 401 | `REFRESH_REJECTED` | Unknown, spent, mismatched, revoked or expired refresh; no family mutation, no credentials, no retry hint |
| 403 | `CROSS_SITE_REQUEST` | Origin/CSRF rejection |
| 400 | `AUTH_MIXED_CREDENTIALS` | App cookies plus explicit client Authorization, or conflicting token sources |
| 413 / 415 | `AUTH_BODY_TOO_LARGE` / `AUTH_UNSUPPORTED_MEDIA_TYPE` | Bounded auth body / JSON required |
| 429 | `AUTH_RATE_LIMITED` | `Retry-After` integer seconds; no token consumption |
| 503 | `AUTH_UNAVAILABLE` | Credential/storage/config unavailable; fail closed, generic message |

401 carries `WWW-Authenticate: Bearer`. No 409 duplicate-refresh/replay result is necessary: identifying a used token adds state and existence leakage without enabling recovery. Resource note conflicts remain their existing 409 contract. Exact route+method allowlisting bypasses access checks only for status/login/refresh; not all `/api/auth/*`. OPTIONS only performs preflight and cannot run route mutations.

## 3. Persistence and atomic transitions

Dedicated auth tables/repository, outside `PersonalStore.KINDS` and project archives. Session row: session ID, device name, created/last-used/absolute-expiry/revoked timestamps, boot epoch, in-memory credential epoch value at issuance, generation integer, current refresh digest. Unique digest index. Separate access rows: access digest, session ID, issued/expiry timestamps. This small access set avoids a successful refresh immediately invalidating still-live parallel requests from the prior 15-minute access period. Access rows are deleted after expiry; keep at least the current access digest/expiry if distinguishing `ACCESS_EXPIRED` is desired. After pruning, old tokens may return generic `AUTH_REQUIRED`; clients must not depend on expired-token recognition forever.

Alternative one-current-access-only storage is simpler but **not selected**: it introduces normal parallel-request authentication failures during rotation. No spent-refresh tombstone is needed because all noncurrent refresh attempts fail identically and never revoke. Expired access-row pruning is housekeeping, not authorization.

Use one async auth-state lock in the single API process to order credential observation, creation, access validation, refresh, revoke-one and revoke-all. Hold it only through auth/storage operations, never throughout resource handlers/stream lifetime. Database CAS/transaction is still required; lock alone is not the persistence contract. Bind all parameters. Validate actual SurrealDB 2.3.10 transaction result shape rather than assuming affected-row semantics.

- **Create:** under lock verify credential snapshot; generate random session/access/refresh; atomically create session + access row; return credentials only after acknowledged commit.
- **Refresh:** under lock load live current-epoch session and compare supplied digest; generate independent random successors; transaction condition includes session ID, generation, current digest, non-revocation, epochs and absolute expiry. CAS replaces refresh digest/increments generation and inserts access row together. Exactly one affected session means success; zero means `REFRESH_REJECTED`. Commit must precede response. Never insert access row if CAS failed. Old unexpired access remains usable until its own expiry, unless revoked.
- **Duplicate/replay:** same refresh twice concurrently → one 200, one 401; same token later → 401; neither loser changes winner/session. Unknown token + real session ID cannot revoke anything. No recovery token, grace reuse, replay cache or same-token retransmission.
- **Revoke one:** authenticated caller, set target revoked timestamp idempotently. Any racing refresh either commits before revocation (then all its tokens fail after revocation) or fails; never clears revocation.
- **Revoke all:** under same lock, one atomic DB operation revokes all rows existing at commit. A later login may create a fresh session; this is not resurrection. Creation/refresh cannot straddle an unlocked revoke-all boundary.
- **DB failure:** no fallback to anonymous/password Bearer. On uncertain commit, return 503; do not retry rotation internally or reconstruct raw tokens. A client receiving an uncertain refresh result reauthenticates. Native stores the returned pair atomically in platform secure storage before exposing success; partial write/crash → relogin.

## 4. Password-file changes and rate limits

**Current code hazard:** `get_secret_from_env` falls back to the environment if `_FILE` is absent/empty/unreadable. `PasswordAuthMiddleware` caches one value while `PersonalSecurityMiddleware` reads again. Session auth must use one strict auth-specific credential provider, not these conflicting behaviors. Avoid changing unrelated model-encryption secret loading in this batch.

If `OPEN_NOTEBOOK_PASSWORD_FILE` is configured, read that file exclusively; missing/unreadable/empty/invalid encoding fails closed even if environment password exists. Match documented existing trim semantics. Compare actual normalized content, not mtime alone. Check on each authenticated/login/refresh operation under auth-state lock; async/offloaded bounded file I/O, no synchronous filesystem reads on the event loop. Environment password is startup configuration; changes require restart.

Observed change **or read failure** increments fresh in-memory credential epoch immediately, invalidating old families before any more requests authenticate. Attempt persistent revoke-all while holding lock; failure keeps service unavailable. Recovery of the same old file after an outage cannot revive old sessions. A valid changed file permits new logins only after the barrier/revocation succeeds. Never store the password verifier in DB; original configured password may exist in process memory as it already does. Do not log file contents or submitted password. Changes between observations are outside the observation guarantee; require atomic file replacement operationally.

Login: freeze T4 limits **five failed attempts per trustworthy client address per rolling 60 seconds and 30 failed attempts globally per rolling 60 seconds**. Reserve/check attempt slots atomically; count failures before releasing reservations, preventing concurrent overshoot. Once blocked, reject attempts with 429 before checking password. Global applies across BFF and native traffic. Do not trust arbitrary X-Forwarded-For; with current internal proxy, the API can conservatively key all Web clients to the BFF peer, documenting shared limit rather than inventing identity headers. Frontend may additionally limit real socket peers only if platform provides a trusted address. Bounded/expiring address buckets, no attacker-controlled unbounded memory.

Additional proposed operational defaults requiring explicit freeze: refresh 10 requests/session/minute plus 120 globally/minute; cap 32 live sessions, reject new login with 429 rather than silently evict. Refresh limits count attempts and precede consumption; no automatic refresh retry even on 429 if the client cannot prove nonconsumption. These are availability bounds, not security identity evidence.

## 5. Web BFF boundary and transport rules

Browser calls same-origin existing `apiClient`; Next alone reads HttpOnly cookies and supplies upstream API Bearer. API itself does not authenticate cookies. Browser JS holds neither access nor refresh token, nor global password after submission; login password exists transiently in form/request only. Purge legacy `auth-storage`, inspect direct search/chat fetches, SSR props, errors and logging. No new axios client.

Cookie proposal: `__Host-sw-access`, `__Host-sw-refresh`, `__Host-sw-session`, all `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain. Session cookie carries nonsecret session ID needed for refresh; cookies containing credential pairs are not persisted server-side. Access cookie expiry at access deadline; refresh/session at absolute deadline. Delete using matching attributes. Production requires configured exact HTTPS public origin. Loopback HTTP test/dev mode must be explicit with separate non-`__Host-` cookie names; not auto-inferred from arbitrary Host.

Next auth catchall allowlists only methods/routes above. On Web login/refresh it reads native token envelope server-side, sets three cookies, returns only `{session_id,access_expires_at,refresh_expires_at}`; never relay raw native JSON. Set each cookie separately. Native traffic needs token JSON on the same routes: classify no-Origin, no browser Fetch-Metadata, **no app cookie** requests as explicit nonambient native transport; supplied Origin enters Web policy, never native bypass. This is a credential-source boundary, not proof of native identity. Native never receives Set-Cookie. If ingress cannot preserve that distinction safely, require separate authenticated native ingress and keep native gate blocked; do not expose token JSON to ordinary browser auth requests.

Every BFF unsafe Web request, including login/refresh/logout, normal writes, SSE POST and portable upload, requires exact configured Origin (scheme/host/port; reject absent, `null`, multiple, foreign) **and** `X-StudyWorkbench-CSRF: 1`. No session secret is needed for this custom-header + exact-Origin defense. Browser-safe reads may omit Origin; reject any supplied foreign Origin. Deny foreign Fetch-Metadata as defense in depth. Native explicit Bearer/body-token requests may omit Origin only when no ambient app credentials are consumed; reject mixed credentials. An arbitrary `client_kind`/`X-Native` header must never waive cookie protection.

Convert only named app cookies into upstream Authorization/body at Next; **do not forward browser Cookie at all** to native-only API, especially platform owner/private-ingress cookies. Forward validated Origin/CSRF where present; never synthesize trusted Origin for absent browser Origin. API also rejects supplied foreign Origin across all mutations, using explicit allowlist, not request.base_url/Host. No fabricated identity/trust header. API does not treat an untrusted header as authentication.

Replace catchall external rewrite with constrained server proxy for all API paths; keep fixed configured internal host, canonical path/method allowlist, reject absolute URLs/path escape, strip incoming forwarding/authorization headers before constructing Web upstream headers. Native Bearer passthrough remains explicit and cannot coexist with app cookies. Preserve normal response/download headers from an explicit list (including Content-Disposition), status and bodies. All credentialed upstream fetches use `redirect:'manual'`; surface 3xx as sanitized 502, do not relay redirect destinations or follow them. Handle auth expiry redirects at ingress separately; never send app Bearer to another host.

SSE: current helper drops Origin and follows redirects; replace shared header preparation and redirect policy without buffering the response. Portable: keep `req.body` streaming, duplex half, abort signal and exact ZIP budget; do not read/clone multipart body. Authenticate/CSRF-check before forwarding bytes. Never retry an upload stream. `/config`, health and readiness retain their narrowly public metadata behavior; test cookie/header leakage on these too.

## 6. Coordination, lost responses and logout

Use an explicit auth-refresh endpoint, not automatic refresh hidden inside arbitrary resource proxies. This avoids replaying consumed uploads and issuing out-of-order Set-Cookie from every resource call. Browser owner runs one cross-tab refresh under Web Locks (or an equivalently tested coordination mechanism) and notifies tabs with nonsecret completion state. Server also maintains bounded in-flight exclusion keyed by digest of presented refresh. **Do not coalesce by caching/replaying raw token results**: duplicates get rejection without Set-Cookie, and must not clear a winner's cookies.

After acquiring a cross-tab lock, recheck shared nonsecret expiry/completion metadata before submitting; initialize/refresh that metadata from metadata-only auth responses. Followers never send the old refresh just because their original request failed. No supported coordination primitive → explicit relogin fallback, not per-tab Promise pretending to be cross-tab safety. A 401 duplicate without ownership of refresh does not clear cookies; wait for owner completion, otherwise show reauthentication required. Failed/stale resource responses never emit cookie deletion.

Lost refresh response, timeout, BFF restart after commit, partial cookie application or unknown owner outcome → explicit re-login, retain editable drafts and operation IDs, no old-refresh retry. Do not automatically resubmit resource writes on any ambiguous transport failure. Existing Google `NEEDS_REAUTH` is not application-session expiry. Existing job/idempotency evidence remains authoritative; auth does not invent mutation retry. Reads may be retried after established login; writes require explicit resubmission/reconciliation. Do not reset editor state on 401.

Serialize login/refresh/logout browser flows so stale successful Set-Cookie responses cannot overwrite a newer login. Abort alone is not proof the server did not commit; if ordering cannot be established, require clean re-login. Definitive successful logout clears cookies and tab auth state, not drafts. If remote revocation cannot be confirmed, local sign-out may clear cookies, but UI must say server revocation unconfirmed; it is not a successful security logout. BFF-only local clear action should be a separately explicit CSRF-protected control, not a fake upstream 204. A logout with expired access may first explicitly refresh; failed refresh requires relogin to manage/revoke remaining session from another valid session.

## 7. Threat and acceptance checklist

- [ ] Exact route/method/OpenAPI fixtures; sanitized 400 validation never echoes input; every auth result no-store and no secret logs; login body/chunked limits enforced before parsing.
- [ ] Wrong/Unicode/password-size cases; access/refresh confusion; guessed IDs; mixed credentials; expiry at exact boundary; 30-day deadline unchanged through rotation.
- [ ] Two simultaneous refreshes: one success, loser rejection, winner remains valid. Replaying every old/random token cannot revoke winner. Lost response/uncertain commit never returns/reconstructs replacement credentials.
- [ ] Access issued before refresh remains usable for its original TTL. Every access consults session state; revoke-one preserves other devices, revoke-all blocks every old credential.
- [ ] Refresh/create/revoke-all races; CAS zero row cannot insert orphan access; transaction failures roll back both pieces; acknowledged vs ambiguous commit behavior explicit.
- [ ] Restart/full restore rejects all restored tokens. File changes, same-mtime changes, removal, unreadable/empty file with env fallback present, failure then old-content restoration all fail closed without resurrection.
- [ ] Concurrent rate-limit overshoot, forged forwarding addresses, bounded bucket growth, Retry-After; no revocation or token consumption on known precondition rejection.
- [ ] Actual-header integration tests for ordinary proxy, SSE, portable import, download and native passthrough; platform cookies absent upstream, Browser JSON has no tokens, multiple Set-Cookie preserved, every unsafe Web route rejects absent/null/evil Origin and missing CSRF.
- [ ] Redirects do not leak Bearer/cookies; external URL/path escape denied; OPTIONS cannot mutate; private status/readiness never enables passwordless fallback.
- [ ] Two tabs, stale response, owner tab crash, BFF restart, partial cookies, logout-vs-refresh and login-vs-refresh; loser cannot clear winner cookies; no plaintext pending/replay cache; preserved drafts and no ambiguous write retry.
- [ ] Legacy password storage removal, no raw-password fetch consumers, all locale/UI parity, existing API/portable/SSE regressions. Auth tables excluded from project exports/imports.
- [ ] Synthetic store tests plus actual SurrealDB transaction tests before claiming atomic storage; real end-to-end browser headers before declaring T5 complete. Review alone is not PASS.

## Unresolved decisions to close before implementation freeze

1. Adopt the exact additive status/error envelopes and metadata shape above; regenerate actual-app contract through contract owner. Do not silently retain earlier exploratory paths.
2. Confirm access-overlap rows versus immediate previous-access invalidation. This proposal selects overlap; test/prune bounds explicitly.
3. Confirm native-vs-Web transport classification at the supported ingress; do not guess platform strips/preserves Origin/Fetch-Metadata. Native connected implementation remains gated.
4. Adopt refresh/session-count availability caps, exact trusted public origin config, and tested browser coordination fallback. These are proposed choices, not existing behavior.
5. Select explicit local sign-out action for unavailable server, if required; avoid conflating cookie clearing with revocation.
6. Reserve migration/ADR numbers and hand off shared files after backend integration. No source edits are authorized by this review task.

## Integration-owner decisions (2026-10-21)

Adopt the exact routes, native envelopes, error schema, strict credential provider, one-use rotation and overlap access rows above. Keep the proposed bounds: 32 live sessions, 10 refresh attempts/session/minute and 120 globally/minute, alongside the existing failed-login limits. Prune expired access rows deterministically; old unexpired access remains valid only within its original 15-minute deadline and always subject to current revocation/epochs.

Do not activate this on the existing private runtime before the Web migration and its header/CSRF/draft tests pass. Code and synthetic credentials are allowed for tests; actual new persistent sessions/configuration still require the corresponding execution authority. Backend implementation must wait for the note migration/shared-file handoff.

Native-vs-Web ingress classification remains a real ingress verification gate, not resolved by this document. Test the proposed classification only against controlled local headers; no native usability claim until the platform preserves the required boundary. Implement an explicit CSRF-protected local-signout operation only in the Web migration, with UI stating remote revocation is unconfirmed when the server is unavailable.

Lost refresh responses require a fresh login, not replay or custom recovery cryptography. A replay rejection does not automatically revoke the winning session; this deliberately does not claim theft detection when an attacker wins first. API restart requires re-login. These conservative UX/security tradeoffs are recorded in the acceptance ledger.

HTTP deployment decision: use the constant `shared-peer` login bucket initially. ASGI request.client can already be rewritten by Uvicorn proxy-header handling, so it is not assumed to be a trustworthy socket address. This conservatively shares five failed login attempts per minute across the owner’s devices and ignores X-Forwarded-For/X-Real-IP for rate identity. Cost: one mistyped device can temporarily limit the others; benefit: no spoofed-header bypass and no unrelated legacy proxy/scheme change. Core per-peer support remains available only for a future verified transport integration.
