# Strict device-session protocol — implementation decisions

2026-10-21. Native protocol v1 and gated backend decisions are retained. The integration owner has adopted the independently reviewed stable-cookie Web design in [ADR-016](../7-DEVELOPMENT/decisions/ADR-016-memory-bff-sessions.md); Web sections 5–6 and the [executable plan](WEB_SESSION_IMPLEMENTATION_PLAN.md) supersede the earlier three-cookie proposal. Design adoption is not runtime activation or BFF test evidence. HMAC recovery, grace replay, encrypted replay caches and new persistent signing secrets remain out of scope.

## Verdict and implementation gate

Strict random one-use refresh is implementable with digest-only storage and conservative recovery. **Reject duplicate refresh; do not automatically revoke its family.** A delayed legitimate duplicate and stolen-token replay are indistinguishable without an additional reviewed protocol. Rejection without revocation protects the winner from false logout, but does not detect/revoke a thief who wins the race. Record this deliberate limitation rather than advertising comprehensive theft detection.

The gated native backend is integrated under migration 28 / ADR-015; ADR-014 owns note revisions and ADR-016 owns Web BFF custody. Defaults remain legacy. T4 and T5 activate together only after Web, coupled-lifecycle and ingress acceptance; native clients additionally wait for actual-app contract and T2 ingress evidence.

## 1. Frozen invariants

- One API process and one frontend instance, one host; worker never issues/validates device sessions. No multi-worker claim. Async DB access only.
- Access lifetime is `min(issued_at + 15 minutes, session_expires_at)`. Session/refresh lifetime is absolute `created_at + 30 days`; rotation never extends it. Server UTC governs `now >= expires_at` rejection.
- Access and refresh each contain independent CSPRNG 256-bit secret material. Suggested wire form: `swa1_` / `swr1_` plus unpadded base64url of 32 bytes. Session ID is independent random UUID, public metadata, not authorization. Tokens are opaque to clients.
- Authoritative API persistence stores SHA-256 digests of complete typed token strings, never raw tokens, passwords or a plain hash verifier of the human password; bounded current-pair BFF process-memory custody is separately specified in section 5. No new persistent crypto secret. Use constant-time secret comparison for password and any in-process digest comparison.
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

**Legacy-code hazard (handled by the device-mode strict provider):** `get_secret_from_env` falls back to the environment if `_FILE` is absent/empty/unreadable. `PasswordAuthMiddleware` caches one value while `PersonalSecurityMiddleware` reads again. Session auth must use one strict auth-specific credential provider, not these conflicting behaviors. Avoid changing unrelated model-encryption secret loading in this batch.

If `OPEN_NOTEBOOK_PASSWORD_FILE` is configured, read that file exclusively; missing/unreadable/empty/invalid encoding fails closed even if environment password exists. Match documented existing trim semantics. Compare actual normalized content, not mtime alone. Check on each authenticated/login/refresh operation under auth-state lock; async/offloaded bounded file I/O, no synchronous filesystem reads on the event loop. Environment password is startup configuration; changes require restart.

Observed change **or read failure** increments fresh in-memory credential epoch immediately, invalidating old families before any more requests authenticate. Attempt persistent revoke-all while holding lock; failure keeps service unavailable. Recovery of the same old file after an outage cannot revive old sessions. A valid changed file permits new logins only after the barrier/revocation succeeds. Never store the password verifier in DB; original configured password may exist in process memory as it already does. Do not log file contents or submitted password. Changes between observations are outside the observation guarantee; require atomic file replacement operationally.

Login: freeze T4 limits **five failed attempts per trustworthy client address per rolling 60 seconds and 30 failed attempts globally per rolling 60 seconds**. Reserve/check attempt slots atomically; count failures before releasing reservations, preventing concurrent overshoot. Once blocked, reject attempts with 429 before checking password. Global applies across BFF and native traffic. Do not trust arbitrary X-Forwarded-For; with current internal proxy, the API can conservatively key all Web clients to the BFF peer, documenting shared limit rather than inventing identity headers. Frontend may additionally limit real socket peers only if platform provides a trusted address. Bounded/expiring address buckets, no attacker-controlled unbounded memory.

Adopted operational bounds: refresh 10 requests/session/minute plus 120 globally/minute; cap 32 live sessions, reject new login with 429 rather than silently evict. Refresh limits count attempts and precede consumption; no automatic refresh retry even on 429 if the client cannot prove nonconsumption. These are availability bounds, not security identity evidence.

## 5. Web BFF boundary and transport rules

The adopted Web design is [ADR-016](../7-DEVELOPMENT/decisions/ADR-016-memory-bff-sessions.md), implemented by [the T5 plan](WEB_SESSION_IMPLEMENTATION_PLAN.md). It replaces the earlier three-cookie proposal; native protocol version 1 above is unchanged. Browser uses the existing same-origin `apiClient`; Next consumes one opaque HttpOnly handle and holds the current native credential pair only in bounded process memory. API authenticates explicit Bearer, never browser cookies. Login password is transient form/request data, not store state. Remove legacy `auth-storage` before device-mode hydration; inspect every direct fetch, SSR payload and error/log path. No second Axios instance.

### Cookie, custody and bounds

Production uses only `__Host-sw-session`: independent CSPRNG 256-bit opaque `swb1_` handle, `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain, expiry at immutable session deadline. It is not the API session UUID. Only a new login sets this cookie; refresh/status/resources/logout do not. Explicit loopback HTTP test mode uses `sw-session`; never infer insecure mode from Host. Reject duplicate/ambiguous handles. Old access/refresh tuples never authorize resources and produce migration-required state; an explicit password login may ignore them and, only after successful native password verification, expire obsolete access/refresh names and issue the new handle. This exception never accepts their credentials or mixed incoming Authorization.

One Node request process owns a versioned process-wide, server-only registry keyed by SHA-256 of the handle. Each record contains native session ID, current access/refresh, deadlines, generation, pending/active/retired phase and metadata-only rotation state. Raw credentials/handle never enter browser JSON, local/session storage, IndexedDB, SSR, logs, archive or disk. Current-pair custody is permitted **in BFF process memory only**, not a cache of raw refresh results. Drop superseded refresh references; no graceful replay, aliases or durable token/cleanup queue. JavaScript zeroization is not promised; avoid routine heap/core capture.

Bounds: 64 combined active/pending/reserved slots; 8 combined admitted-login operations and pending-confirmation records; 60-second pending lifetime; 32 refresh followers/record; 10-second owner auth/probe deadlines. Known-orphan cleanup has 4 concurrent slots, 5-second deadlines, one attempt, no queue. Reserve before native create; release on every outcome. Expiry/retirement frees lookup authority; never evict a live session for admission. Backend's 32-live-session cap is independent. Record presence is not current API authorization: every protected resource still receives authoritative API validation.

### Configuration and credential-source boundary

Next and API use `STUDY_WORKBENCH_AUTH_MODE`, absent only defaults to `legacy_password`; unknown/empty values fail closed. Device `/config` returns `apiUrl:''` and `web_session_protocol:'bff-memory-v1'`; no external API_URL/NEXT_PUBLIC_API_URL or Host/X-Forwarded-Proto fallback. Mode/version mismatch is unavailable, not legacy downgrade. Configure one exact HTTPS `STUDY_WORKBENCH_WEB_ORIGIN`, included in API `STUDY_WORKBENCH_AUTH_ORIGINS`. `STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK=true` is explicit nonproduction literal-loopback HTTP only. Validate fixed `INTERNAL_API_URL`; caller input never chooses destination.

A supplied Origin, browser Fetch Metadata or app cookie enters Web policy. Every unsafe operation, including login, refresh, local logout, normal writes, SSE POST and portable upload, requires exact configured Origin (reject absent/null/multiple/foreign) and `X-StudyWorkbench-CSRF: 1`. Safe reads may omit Origin but reject supplied foreign Origin. Reject cross-site Fetch Metadata as defense in depth. An arbitrary X-Native/client-kind header never waives protection.

Only no-Origin, no-browser-Fetch-Metadata, no-app-cookie requests can be explicit nonambient native transport, and Next passthrough additionally requires `STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH=true` (absent/false disabled; other values invalid). Direct API native contract is unchanged. Native token JSON is returned only in that explicit branch, never with Set-Cookie. Real native ingress remains blocked until platform classification and private access are verified; a separate approved ingress is required if this boundary cannot be preserved. This classification is not proof of native identity. Reject mixed app cookies and native Authorization/body credentials.

Strip **all** browser/platform Cookie and incoming forwarding/Authorization headers before constructing Web upstream headers from the memory record. Forward validated Origin/CSRF without synthesizing missing browser Origin or identity headers. No raw/native token JSON is passed through the Web auth dispatcher: login/refresh return only native session ID, deadlines and nonsecret generation; safe Web status additionally reports pending/active/refresh-needed/unavailable state. Public native `/auth/status` is readiness, not authentication. Web status confirms access with a protected API probe; locally expired access reports refresh-needed rather than authenticated or definitely revoked. The Web-only `POST /api/auth/web-signout-local` accepts `{}`, enforces CSRF and retires its own valid handle without claiming remote revocation.

### Resources, streams and response policy

Replace the external catchall rewrite with checked-in exact method/path policy for current API consumers, not a blanket `/api/*` pass-through. Reject absolute URLs, path escape/normalization changes and arbitrary baseURL overrides; exact methods include deliberate HEAD/OPTIONS handling. Keep direct search/source-chat fetches on a shared browser header/error helper and preserve existing SSE buffering semantics. No proxy implicitly refreshes or retries any request.

Every credentialed upstream fetch uses `cache:'no-store'` and `redirect:'manual'`; sanitize all 3xx to 502 without forwarding Location/body. Strip upstream Set-Cookie, CORS grants, hop-by-hop/private headers. Preserve explicitly allowed status/body/download headers, including Content-Disposition and Range/If-Range/206/416 behavior; do not relay stale Content-Length after decompression. Podcast and server-returned attachment URLs are restricted to canonical own download routes, never arbitrary authenticated destinations.

SSE streams without buffering and propagates abort. Portable/multipart preserves original `req.body`, boundary, `duplex:'half'` and signal; never call clone/text/formData/arrayBuffer on its body. Validate Origin/CSRF and obtain a fresh protected access probe before forwarding any upload bytes; API validates the actual mutation again. Backend retains exact configured archive/request/expanded byte limits; do not impose the old rewrite's 100mb cap. Never retry an upload or SSE POST. `/config`, health and readiness remain narrow public metadata with no credential leakage.

## 6. Coordination, lost responses and logout

### Singleflight and expiry

An explicit Web refresh endpoint accepts `{}` and uses only its record's current native pair. One per-record metadata-only singleflight covers overlapping calls; followers never consume a successor refresh merely because they waited. No raw native envelope is shared/cached/replayed. Rotation is a credential-update substate: already-confirmed sessions may use still-live old access, pending sessions may not mutate. Local busy/follower rejection never retires the owner.

Normally rotate within 30 seconds of access expiry, or after authoritative current-generation expiry. **Suppress proactive rotation when access already lasts through the absolute deadline**: validate/report it while usable; at `now >= session_expires_at`, require login. If earlier access expires before that deadline, at most the needed explicit rotation occurs; its clipped successor must not trigger repeated rotations in the final 30 seconds.

Snapshot record identity, generation **and access deadline** at dispatch. An `AUTH_REQUIRED` on an expired snapshot can result from pruning; locally expired access/cold status or a failure arriving after snapshot expiry permits explicit refresh, not immediate retirement. Fresh current-generation `AUTH_REQUIRED` retires; old-generation failures never destroy a newer pair. A rejected explicit native refresh is terminal. No classification retries the resource.

After every awaited protected probe, recheck identity, phase, pending deadline and relevant generation before pending promotion, fast-path metadata or cross-record effects. A probe begun before logout/supersession/expiry cannot restore authority. Retirement is a short synchronous registry transition, never blocked by refresh network wait; owner completion rechecks identity before installing tokens. Never await a per-record lock while holding a global lock. Every owner path has deadline and `finally` cleanup.

### Distinguish the loss hop

| Failure | Outcome |
|---|---|
| API → BFF refresh commit/ack unknown, timeout, invalid envelope, native 429/503 or rejection | Retire BFF handle; no old-refresh resend/reconstruction; fresh login. Duplicate rejection does not automatically revoke the native family. |
| BFF → browser delivery lost after BFF acknowledged/installed pair | Same stable cookie status recovers metadata; no second native rotation, no clean-profile requirement. Browser disconnect does not undo the swap. |
| BFF crash after API commit | Memory lost; old handle cannot reconstruct credentials; coupled restart and login required. |
| Resource acknowledgement lost | Preserve draft/operation ID and unknown outcome; no automatic write/upload/SSE retry. |

Existing Google `NEEDS_REAUTH` remains an integration error, not app expiry. Keep dashboard/editor trees mounted on reauth: preserve text, files, scope, note revision/conflict/unknown-save state and IDs. No 401 hard navigation or hidden mutation retry. Reads may be explicitly refetched after auth; writes require explicit resubmission/reconciliation.

### Login admission, pending records and cleanup

Assign a monotonic admission sequence before the first upstream await. Keep the highest sequence whose successful issuance was published. A slower older completion after a newer published success cannot set a cookie; clean its known orphan once. A newer wrong-password failure does not suppress an older valid success or retire existing auth.

Validated native login creates a fresh random handle in pending-confirmation state; safe status plus protected probe confirms it. Pending does **not** prove the browser never received its cookie. New success retires older pending identities, not unrelated active clients; replacement targets only its captured predecessor. Every known orphan from supersession, admission suppression, pending timeout/expiry or authorized logout, plus a successfully replaced predecessor, gets at most one bounded best-effort revoke using held access. Cleanup must not target the replacement; no slot/failed acknowledgement means nonsecret unconfirmed outcome and discarded credentials, not a retry queue. Unknown native create commits cannot be reconstructed or claimed canceled.

A logout fence applies only to operations already admitted at its captured boundary. Previously unseen login requests arriving later are new server-observed attempts, not resurrected retired sessions. Optional Web Locks improve login/logout UX, not refresh correctness. Late login headers already sent can overwrite a newer cookie with a retired handle; reject it and offer ordinary in-place login, never alias/reinsert it. Ignore stale JSON completion by browser operation generation; perfect fixed-name cookie ordering is not promised.

### Own retirement versus authority over other sessions

Own-handle local sign-out works without API availability and may cancel narrowly associated own operations. It cannot globally retire clients or pending issuance merely from a BFF lookup. Cross-record revoke-other/revoke-all/global pending cancellation requires a fresh successful protected caller check before the local transition, or an acknowledged native revoke before those effects. Recheck the caller after the probe; a stale/revoked/expired handle is not authority over others.

Capture affected record identities and the local login-fence boundary synchronously. Do not rescan all records when a delayed revoke-all response arrives. A login after the local boundary but before native commit may be revoked by API; one after native commit may survive. Subsequent protected validation resolves that distinction without inventing a remote timestamp. Native management still authenticates at its own commit path.

Logout emits **no stable-cookie deletion or Clear-Site-Data**: local registry invalidation makes the retained cookie useless and avoids deleting a later login via delayed headers. Native revocation is confirmed only after acknowledged success; otherwise UI says local signed-out/remote revocation unconfirmed. Local-only signout is an explicit Web control, not a fake native 204. Retired handles are never reused, reconstructed or reinserted by late refresh/probe results. Revocation cannot undo already-authorized writes or terminate existing streams.

### Coupled lifecycle and cap recovery

Frontend-only restart loses custody but leaves native sessions counting against cap 32. Unknown creates/failed cleanup can also strand slots. Another valid client may manage them; otherwise recovery requires an authorized coupled frontend/API restart, not a password-admin endpoint or a cap increase. Retry-After is not a promise that orphan sessions expire after a minute.

Before device-mode activation, supported deployment must prove frontend loss stops service, API restarts with fresh boot epoch, then new frontend traffic resumes. Native clients also reauthenticate. Existing independent supervisor/Compose restart policies and startup health dependencies do not establish this guarantee. One API process and one stable Node frontend request process only; no serverless/Edge/multi-instance or rolling mixed-version claim. This is an operational acceptance gate, not authorization to activate/change a live deployment.

## 7. Threat and acceptance checklist

- [ ] Native exact route/method/OpenAPI fixtures, sanitized bounded auth bodies/errors, no-store/nosniff, no secret logs; native protocol v1 unchanged.
- [ ] Wrong/Unicode/password-size, token-kind confusion, guessed IDs, mixed credentials and exact expiry/immutable 30-day deadlines.
- [ ] Native same-token contention has one winner; losers do not revoke it; unknown commit never reconstructs raw successors. Original access overlap and authoritative epoch/revocation checks remain.
- [ ] CAS/create/revoke-all/transaction failures, restore/restart, credential file change/outage/recovery, bounded rate limits and actual SurrealDB transactions retain backend coverage.
- [ ] Actual Next/browser headers across ordinary/SSE/multipart/download/native classes: exact Origin+CSRF, no upstream platform Cookie, no Web native-token JSON, no arbitrary host/path/redirect escape, OPTIONS cannot mutate.
- [ ] Concurrent tabs/server refresh calls, both lost-response hops, owner crash, current/old generation errors and expired-row pruning; no resource replay or follower-induced logout.
- [ ] Final-30-second clipped access suppresses refresh storms; preceding access requiring one last rotation works; exact absolute deadline requires login.
- [ ] Admission A then B, B succeeds first, A completes last: A emits no cookie; newer wrong password does not suppress older valid success; pending-confirmation probe cannot restore retired/expired state.
- [ ] Known-orphan supersession/expiry/replacement cleanup is one-shot, bounded and cannot revoke successor; unknown create/cap exhaustion stays explicitly unconfirmed.
- [ ] Revoked local handle cannot affect other clients/global pending logins; own local logout works offline. Delayed revoke-all response only affects captured identities/boundary; logout has no deletion headers; retired cookie replay fails.
- [ ] 64 slot / 8 login-pending / 32 follower / 4 cleanup bounds, 60-second pending / 10-second owner / 5-second cleanup deadlines; no durable credential/cleanup/result cache.
- [ ] Frontend-only restart at native cap reproduced as negative case; actual coupled crash lifecycle restores login and rejects old credentials before activation.
- [ ] Legacy password removal; all direct fetch/audio/config paths migrated; no global mutation retry; drafts/files/revision-conflict/unknown-operation state survives in-place reauth; all locales and existing portable/SSE/PDF flows regressions.
- [ ] Backend baseline tests do not count as BFF evidence. Actual browser loss-hop/cookie-ordering tests and independent review are required before T5 completion; real ingress/native/Docker/toolchain gates remain separate.

## Integration-owner decisions and remaining gates (2026-10-21)

Native protocol above, access overlap, strict provider, 32 live sessions, 10 refresh attempts/session/minute and 120 globally/minute remain adopted. Migration 28/ADR-015 backend is integrated; note revision backend/UI are integrated. The owner adopts ADR-016 with independently reviewed corrections: terminal-deadline suppression, expiry-aware AUTH_REQUIRED, admission-order fencing, bounded one-shot cleanup, fresh authority and captured cross-session boundaries. Execute the corrected six-task Web plan; do not reconcile it with superseded three-cookie or mandatory clean-context proposals.

`legacy_password` remains default. Device-mode code/synthetic tests do not authorize actual credential/configuration changes or security activation. T4/T5 activation is coordinated and waits for Web/header/CSRF/draft tests, coupled lifecycle, and supported private ingress. Native-vs-Web classification still requires real ingress evidence; neither this document nor a local header test proves native usability. Docker hosts/toolchains, installation, external networking and private-ingress changes keep their existing authorization gates.

Lost **native/API→BFF** refresh acknowledgement requires login without replay. Lost **BFF→browser** acknowledgement after swap recovers through stable-cookie metadata. Duplicate rejection is not theft detection when an attacker wins first. API restart invalidates prior sessions; frontend memory loss additionally requires the coupled lifecycle above.

HTTP rate identity remains the conservative constant `shared-peer` bucket: five failed login attempts/minute shared across Web/native callers, global30 upper bound. ASGI client may already be proxy-rewritten; ignore X-Forwarded-For/X-Real-IP for identity. Verified per-peer attribution is deferred. This Web design introduces no identity header or backend contract change.
