# ADR-016: Stable-cookie, memory-only Web BFF sessions

Status: accepted for **gated implementation**, 2026-10-21. Not implemented or activated by this ADR. Native protocol version 1 and ADR-015 backend semantics are unchanged.

## Context and decision

The browser currently persists the global password and sends it as Bearer. The
first Web proposal put native access/refresh tokens in three HttpOnly cookies.
Strict one-use refresh plus lost browser responses made that design require
unfriendly cookie-ordering recovery. Adopt a conventional server-side BFF session
instead: one stable opaque cookie identifies a bounded process-memory record
holding the **current** native credential pair. Existing `apiClient`, native API
contracts and authoritative backend validation remain.

This is normal credential custody, not a raw refresh-result replay cache. No
persistent BFF secret, token database, grace replay, deterministic successor,
secret alias, durable cleanup queue or new password-based admin endpoint is added.
The executable plan is [WEB_SESSION_IMPLEMENTATION_PLAN](../../v1/WEB_SESSION_IMPLEMENTATION_PLAN.md);
the normative Web boundary is [protocol sections 5–6](../../v1/DEVICE_SESSION_PROTOCOL.md).

## Custody, bounds and transport

- Production cookie: `__Host-sw-session`, CSPRNG 256-bit opaque `swb1_` handle,
  `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain. It is not the native
  session UUID. It expires at the immutable native session deadline. Only new
  login sets it; refresh, status, resources and logout do not.
- Explicit loopback HTTP testing uses `sw-session`; request Host cannot enable
  insecure mode. Old access/refresh cookie tuples never authorize resources;
  only explicit freshly verified password login may replace them and expire
  obsolete names. Mixed incoming Authorization remains rejected.
- One Node request process owns a versioned process-wide registry keyed by the
  handle's SHA-256 digest. Current access/refresh strings remain only in memory;
  old refresh references are discarded after an acknowledged atomic swap. No
  browser JSON/storage/SSR/log contains these credentials or the opaque handle.
  JavaScript string zeroization is not promised; routine heap/core capture is
  inappropriate for this process.
- Bounds: 64 combined active/pending/reserved slots; 8 combined admitted-login
  operations/pending confirmations; pending confirmation expires after 60 seconds;
  at most 32 refresh followers per record. Auth owner calls/probes have 10-second
  deadlines. Cleanup has at most 4 concurrent calls, a 5-second deadline each,
  and no queue/retry. All reservations release in `finally`; live sessions are
  not silently evicted. Backend's independent 32-live-session cap remains.
- Origin plus `X-StudyWorkbench-CSRF: 1` protects every unsafe Web operation.
  Fixed upstream, exact route/method policy, no browser/platform Cookie forwarding,
  mixed-credential rejection and manual redirects remain mandatory. Native
  passthrough is separately gated; an arbitrary native/client-kind header grants
  nothing. `/config` reports `web_session_protocol: 'bff-memory-v1'`; mismatched
  Web/backend modes fail closed, never fall back to password Bearer.

## Refresh, expiry and loss-hop semantics

One record-level metadata-only singleflight owns rotation. Followers inspect the
established current generation; no raw native envelope is shared or replayed.
Rotation is a substate of an already-confirmed session: still-live old access may
serve parallel requests, subject to API validation. Pending records cannot mutate
resources. Resources never rotate implicitly or retry their original body.

Normally an explicit refresh is due within 30 seconds of access expiry. **Do not
proactively rotate if current access already lasts through the absolute session
deadline**: validate/report it while usable, then require login at the deadline.
A prior access ending before that deadline may need one rotation; its clipped
successor cannot trigger a terminal-lifetime refresh storm.

Classify resource failures using record identity, dispatched generation and
access deadline. Locally expired access, including `AUTH_REQUIRED` after expired
rows were pruned, means refresh-needed, not proven revocation. A late failure
whose snapshot has now expired permits explicit refresh without replaying the
resource. Fresh current-generation `AUTH_REQUIRED` retires the handle. Old-generation
failures cannot retire a newer winner. Rejected explicit refresh is terminal.

- API → BFF uncertain refresh commit/ack, timeout, malformed envelope, native 429/
  503 or rejection: retire the handle, discard custody, require login, never resend
  the old refresh. Duplicate rejection alone does not revoke the native family.
- BFF → browser delivery loss **after acknowledged swap**: retain the current
  record. Stable-cookie status recovers metadata without another native rotation
  or resource mutation; no clean browser profile is required.
- Frontend crash after API commit: memory is lost; old handles cannot recover it.
- After every awaited probe, recheck registry identity, retirement, pending deadline
  and relevant generation before promotion/metadata publication. Disconnected
  browser delivery does not undo a completed BFF swap.

## Login admission and known-orphan cleanup

Assign a monotonic nonsecret admission sequence before the first upstream await.
Track the highest admitted sequence whose success was published. An older
completion after a newer published success emits no cookie: retire its known
session and attempt cleanup once. A newer wrong-password failure does not suppress
an older valid attempt. Wrong-password failure preserves an existing valid handle.

After validated native create, issue a new random handle in pending-confirmation
state; never promote a caller-chosen handle. Safe status, using the cookie and a
fresh protected API probe, confirms it. Pending means no BFF acknowledgement of
possession/validation, **not** proof the browser never received its cookie. New
successful issuance retires older pending records, not unrelated active devices.
Successful replacement retires only its specifically captured old handle.

Every known orphan retired by pending supersession, admission-order suppression,
expiry/timeout or authorized logout receives at most one bounded best-effort native
revoke using held access; successful replacement applies the same cleanup to its
captured predecessor. Cleanup cannot target the replacement. If no cleanup slot
is available, or acknowledgement is lost, retain only bounded nonsecret
unconfirmed metadata and discard credentials; no queued work or automatic retry.
Unknown native create commits are unrecoverable and cannot be claimed canceled.

A logout fence covers only login operations already admitted by this BFF at the
captured boundary. A previously unseen request arriving later is a new
server-observed login attempt, not resurrection of a retired handle. Optional
browser Web Locks improve login/logout UX but are not refresh correctness or
browser-support requirements.

## Logout, authority and delayed responses

Own-handle local retirement works without API availability. It is a synchronous
registry transition, independent of a refresh network wait. It may cancel narrowly
associated own operations but cannot cancel global pending issuance or another
client merely because a handle exists in memory.

Cross-record revoke-other/revoke-all/global pending cancellation requires a fresh
successful protected caller check before the local transition, or acknowledged
native revocation before those effects. After the check, recheck the caller
snapshot and synchronously capture **affected record identities and the local
login-fence boundary**. The API management call still authenticates authoritatively.
A revoked/expired caller cannot globally invalidate others from a map lookup.

A delayed revoke-all response may update outcomes only for those captured
identities; it must not rescan and retire newer logins. A login after the local
boundary but before native commit may still be revoked by the API; one after
native commit may survive. Subsequent protected validation resolves that distinction;
no remote commit timestamp is guessed. Already-authorized writes/streams cannot
be undone.

Logout emits **no stable-cookie deletion, Max-Age=0 or Clear-Site-Data**. Server
invalidation is security logout; the now-useless cookie may remain until its
original expiry/new login. This avoids delayed logout deletion of a newer login.
Report native revoke confirmed only after acknowledged success; otherwise distinguish
local signed-out from remote revocation unconfirmed. A Web-only CSRF-protected
local-signout control retires only its valid own handle, not anonymous global state.

Late login headers can still overwrite a newer fixed-name cookie with an older
retired handle. That handle must remain unauthorized, never aliased/reinserted.
Ordinary in-place login is the safe recovery; perfect cookie-header ordering is
not promised. Ignore stale login JSON in the client using operation generations.

## Restart/cap consequence and activation gates

Frontend-only restart loses native credentials while backend sessions still count
toward its cap of 32. Unknown create commits/failed cleanup can also strand slots.
Recovery is management from another still-valid client, otherwise an **authorized
coupled frontend/API restart**. Retry-After does not promise orphan expiry in a
minute. Do not raise the cap or add password-admin APIs to hide this limitation.

Session-mode activation requires the supported deployment to stop serving after
frontend loss, restart API to obtain a fresh epoch, then serve the new frontend.
Native clients also reauthenticate. Existing independent supervisor/Compose restart
policies and startup health dependencies are not evidence of crash coupling.
Executable unclean-failure/cap tests are required; documentation alone is not enough.

Defaults remain `legacy_password`. No runtime/security activation, actual-secret
configuration, private-ingress/native approval, Docker host/toolchain installation,
or publication authority follows from this ADR. Device Web activation waits for
actual Next/browser headers, loss-hop/concurrency tests, mounted-draft and no-retry
regressions, verified coupled lifecycle and independent security review.


## Metadata ingress clarification (2026-10-21)

Preserve ambient same-origin hosting credentials for browser metadata requests, while omitting app-supplied Authorization/password and rejecting redirects. Cookie-free means BFF-to-API, not browser-to-an-authenticated-private-ingress. Exact GET `/api/config` ignores app-cookie parsing/authority without authenticating anyone; retain safe-read and mode checks and strip all credentials upstream. `/api/auth/status` and protected/unsafe routes keep their original boundaries. This is compatibility hardening with synthetic tests, not a claim about undocumented Sites cookie mechanics or a passed private-ingress gate.
