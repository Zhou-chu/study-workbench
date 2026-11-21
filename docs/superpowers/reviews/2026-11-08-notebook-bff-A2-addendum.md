## Focused A2 addendum: legacy fallback versus new allowlist

Date: 2026-11-08 UTC. Scope is only the later A2 migration conflict. This does not block A1. The old reference source remains unchanged.

### Evidence and exact conflict

- frontend/src/lib/api/session-proxy.ts:487-511 calls matchApiRoute, but legacy_password deliberately skips rejection when route is null. It selects destination = legacyPath ?? path and fabricates a generic JSON RoutePolicy when no route matches. Consequently method/path rejection, canonical encoding rejection and local OPTIONS handling in the later device branch do not govern legacy. The destination still uses fixed config.internalOrigin; this is broad API surface, not an arbitrary external upstream URL.
- Same file:495-511 also bypasses webBoundary entirely. getWebSessionConfig returns publicOrigin:null in legacy at session-proxy-policy.ts:54-55. This is not an exact browser-origin boundary. The new BFF must not claim that migrating those lines unchanged satisfies the new spec's explicit allowlist/origin gates.
- Existing legacy regression session-proxy.test.ts:743-754 expressly expects GET /api/commands/registry/debug to succeed through broad fallback while retaining password Bearer and stripping Cookie. That test is a known deliberate old behavior, not evidence that debug is required by any user-facing workflow.
- The checked-in policy/corpus expressly excludes that debug endpoint and unsupported GET /api/models/{id}. session-proxy-policy.test.ts:230-265 scans current static apiClient calls; :268-303 denies malformed, unknown, wrong-method and encoded-static routes. These matcher tests do not prove the legacy dispatch path enforces the matcher.
- A read-only set comparison found 153 method/path/kind entries in routeDefinitions and exactly the same 153 in browserRoutes, with no differences. No runtime regression test was run.
- Direct auth callers (auth.ts) use canonical GET /api/auth/status, GET /api/notebooks for legacy password probe, and reviewed device auth endpoints. Direct SSE callers use POST /api/search/ask and POST /api/sources/{source_id}/chat/sessions/{session_id}/messages, both already covered; protected download routes are explicitly covered. The source-chat legacyPath re-encoding alias is a Next routing implementation detail, not an additional required endpoint.
- No currently required browser route was identified that needs broad fallback. This is a source/corpus finding, not a claim of full runtime route acceptance. Backend GET /api/personal/note-capabilities exists but is not a current browser caller/policy entry; its backend existence alone does not justify adding it. Add it only if an actual approved new client consumer requires it, through explicit policy review.

### Smallest ruling for A2

Preserve LEGACY AUTHENTICATION COMPATIBILITY, not the broad proxy fallback.

1. In the new standalone BFF, validate the original raw request target and exact method against the static reviewed route table in BOTH modes before readiness probes, credential forwarding or body reads. No route-null fabricated policy; no legacyPath override/reconstruction; no runtime OpenAPI-generated expansion. Keep the current explicit download/SSE/multipart/public header classes.
2. Add only the approved A1 GET /api/personal/notebooks/{id}/workspace-view and authenticated GET /api/personal/client-capabilities to the reviewed table/corpus. Preserve the existing legal 153 entries as mode-appropriate. A table entry for device auth is not permission to execute it in legacy.
3. Maintain password Bearer, existing status/password-probe shapes, per-dispatch credential-free backend mode check, mode-mismatch fail-closed before upload bytes, same-origin ingress Cookie retention, Cookie stripping toward FastAPI, fixed internal upstream and streaming/abort/backpressure behavior. Canonical native/device auth issuance remains unavailable in legacy.
4. Use the already-existing explicit server setting STUDY_WORKBENCH_WEB_ORIGIN as the trusted public origin in the NEW BFF for legacy too, with validated exact origin and safe-read rules. Do not infer authority from Host/Forwarded/X-Forwarded-* or call device webBoundary unmodified: it rejects the legacy Bearer that must remain supported. Keep legacy authority handling separate from origin/site checks. Require exact configured Origin for state-changing browser requests; safe reads may omit Origin but any supplied value must match and cross-site metadata is rejected.
5. Do not silently impose the device-only X-StudyWorkbench-CSRF protocol on old legacy callers, which do not send that header. Preserve the existing device Origin+CSRF requirement unchanged. Any additional legacy header requirement needs a documented client contract rather than being smuggled in through extraction.
6. Missing/invalid trusted origin must fail closed for new BFF browser mutation readiness, without guessing it from request headers. This is a code/config-contract ruling only; no production environment or Access settings are changed by this review.
7. OPTIONS stays local for a recognized route/method and never goes upstream; HEAD is allowed only where explicitly listed. Unknown route is local 404, known path/wrong method 405, and canonical legacy-unavailable auth retains its mode-specific refusal. Encoded invalid paths need not mimic the old fallback's auth error status.

### Required negative and compatibility tests

Run the same static method/path rejection corpus through the real createBffHandler and native HTTP adapter in BOTH auth modes; testing matchApiRoute alone is insufficient.

- Explicitly reject GET /api/commands/registry/debug, unknown paths, extra trailing segments, unsupported GET /api/models/{id}, TRACE, wrong verbs, unlisted HEAD, and malformed OPTIONS. Assert no upstream call, including no readiness probe, and zero upload/body reads.
- Encoded static names, single/double-encoded slash/backslash, dot/traversal segments, control bytes, malformed percent/UTF-8, duplicate slash and trailing slash cannot fall through to legacy forwarding. Raw HTTP request-target tests must happen before Request/URL construction normalizes it.
- Canonical auth/sessions remains unavailable in legacy before reading body. Encoded aliases of auth issuance must also remain rejected; no token JSON, native passthrough or device-mode downgrade. Split the old canonical-versus-encoded refusal expectations instead of requiring every spelling to keep the exact old 503.
- A valid same-origin legacy request with password Bearer still succeeds on listed routes; Cookie, arbitrary authentication headers, forwarding headers and unreviewed response headers never reach API. Credential-free readiness/public metadata stays credential-free.
- Legitimate encoded IDs (colon, Unicode) and allowed encoded QUERY text remain intact; do not fix the conflict by rejecting all percent-encoding. Source-chat/search SSE, protected Range download and multipart routes retain correct header classes/body semantics.
- Foreign/null/ambiguous Origin and cross-site metadata are rejected in legacy and device; exact legacy mutation Origin works with Bearer and without a newly invented device CSRF requirement. GET with absent Origin remains usable. Duplicate Host/Origin/Authorization and forged forwarding headers cannot supply authority or select destination.
- Unknown paths with a crafted legacyPath/decoded-param alias cannot dispatch at all in the standalone handler. A fixed upstream response redirect is not followed and does not leak credentials.
- Preserve existing fresh legacy readiness mode-mismatch and zero-consumed multipart tests, including API replacement between requests.

### Effect on A2 parity gate

Replace “all old proxy tests unchanged” with an explicit parity ledger:

- PRESERVED: all reviewed browser routes, legitimate IDs/query bytes, credential custody and public status, current legacy password behavior, device session protocol, mode mismatch, bodies/streams and error recovery.
- INTENTIONAL APPROVED DELTA: the standalone legacy BFF no longer forwards unlisted/noncanonical/wrong-method routes; legacy browser requests gain a fixed configured origin boundary. Keep old source tests unchanged as historical reference, but in the NEW BFF test package split the old legacy test: a listed GET /api/notebooks proves Bearer/Cookie compatibility, while GET /api/commands/registry/debug must now be denied before upstream.
- UPDATE NEW TEST EXPECTATIONS ONLY: default legacy BffConfig must not inherit publicOrigin:null as a production browser-origin claim; canonical device-auth refusal remains, encoded aliases are route-policy refusal; HEAD/OPTIONS are explicit/local in legacy too.
- EVIDENCE REQUIRED: full positive 153-entry policy corpus plus approved A1 additions, both-mode dispatch negatives and native HTTP raw-target/header tests. No new legitimate omission was found in this review; any later one gets an explicit reviewed entry rather than restoration of the fallback.

This is a later A2 execution-before-implementation ruling. It neither changes A1 scope nor authorizes a production origin/config/Access change.


### A2 origin/native clarification and completed static inventory

The following makes the preceding addendum's Origin paragraphs precise; it does not activate any runtime mode or native ingress.

Read-only AST inventory was completed with the parent's already-prepared Node 24.19.0 and the reference checkout's installed TypeScript compiler. It found 140 static apiClient examples; the only unlisted example is GET /api/models/{id} from models.ts, already intentionally excluded because there is no corresponding backend GET operation. There is no additional legitimate static apiClient route requiring broad fallback. This was source parsing, not a regression test or service run. Direct auth/SSE and returned download patterns were checked separately as described above.

Trusted origin failure:
- The new standalone BFF must validate explicit STUDY_WORKBENCH_WEB_ORIGIN in legacy as well as device mode. Absent/empty/malformed/ambiguous value is invalid BffConfig, never publicOrigin:null readiness.
- Prefer rejecting createBffHandler/createBffServer/CLI configuration before a server can become ready. If configuration is evaluated lazily, return fixed 503 AUTH_UNAVAILABLE for config/protected browser handling, with zero upstream dispatch, no Authorization forwarding, no upload/body consumption and no success/ready metadata. Do not log the rejected value.
- No fallback to Host, Forwarded, X-Forwarded-Host/Proto, request URL authority, INTERNAL_API_URL, or an inferred localhost. Config validation is local and must not change actual production settings or Cloudflare access.
- Validate and forward a supplied legitimate legacy Origin as it is. Do not synthesize browser Origin on an origin-less native call, do not disable legacy Bearer, and do not add device CSRF to legacy. Device Origin+CSRF remains unchanged.

Existing no-Origin boundaries, which must not be conflated:
- Direct legacy API semantics are api/personal_security.py:34-56: a supplied foreign Origin on an unsafe protected operation is rejected; absent Origin is not by itself rejected. api/auth.py still requires explicit legacy Bearer when password authentication is enabled. Preserve that direct API contract, and do not alter it in A2.
- Current legacy Next proxy bypasses webBoundary, so its no-Origin forwarding must not be described as proof that native Web passthrough was activated or private native ingress verified.
- The existing EXPLICIT standalone/Web native classification is session-proxy.ts:134-140 and DEVICE_SESSION_PROTOCOL.md:100: nativePassthrough must be true, Origin absent, all browser sec-fetch-* metadata absent, and app session/obsolete app credential cookies absent. No-Origin alone or an X-Native/client-kind header is never a waiver. Explicit legacy Bearer proves only the existing password authorization, not platform identity or permission to expose an ingress.
- New BFF unsafe origin-less dispatch should stay within that explicit native branch, not re-enter broad legacy fallback. It still needs valid global BffConfig/trusted origin, listed route/method, fixed upstream, mode check, and existing credential validation. The passthrough flag remains absent/false by default; do NOT turn it on as part of SPA/BFF extraction. Safe public/ordinary read handling can allow absent Origin under its existing reviewed policy without granting native mutation authority.
- Actual native ingress remains separately gated on already-required platform classification/private access evidence. Direct API native behavior being supported does not authorize exposing API or opening a new public ingress through BFF.
- Tests must distinguish: legacy listed same-origin browser mutation with Bearer works without device CSRF; browser-looking unsafe request lacking Origin is rejected; no-Origin native conditions cannot bypass disabled passthrough or missing trusted-origin config; explicitly enabled SYNTHETIC native test fixture can use only the reviewed route with existing explicit credentials. No runtime flag/config change is part of those tests.

These are A2 configuration and adapter test gates only. A1 continues unchanged.


### A2 final clarification: safe reads are not origin-less write authorization

The following is the precise final reading of the preceding origin/native recommendations. No contrary existing browser protocol case was found.

- After exact static method/path validation, ordinary allowed GET/HEAD keep isAllowedWebRead semantics in BOTH modes: absent Origin is allowed; any supplied Origin must exactly match the configured trusted public origin; cross-site/invalid Fetch Metadata is rejected under the existing helper. Legacy GET /api/notebooks with Cookie plus legacy Bearer and no Origin must remain valid. Do NOT run the no-app-cookie/nativePassthrough test against that safe read, and do NOT apply the device browser-Bearer prohibition to legacy.
- HEAD remains limited to explicitly listed routes. OPTIONS is local policy handling, never an upstream dispatch. Those method gates do not become broader because Origin is absent.
- For legacy unsafe/write methods, a supplied Origin must exactly match the trusted public origin. Browser Fetch Metadata with missing Origin is rejected. A request with neither Origin nor ANY browser sec-fetch-* metadata may use an origin-less write only through the existing explicit nativePassthrough=true classification and no-app-cookie boundary; the flag stays false by default. Missing Origin alone is no authorization. No device CSRF requirement or Bearer ban is added to legacy.
- Device unsafe Web requests retain their existing exact Origin plus CSRF and mixed-credential rules. The explicitly enabled synthetic native branch is still distinct; no runtime native/device activation occurs.
- The term safe read here describes the existing HTTP/header Origin classification, not proof that every GET is business-side-effect-free. In particular, known GET job can recover dispatch: retain its existing GET Origin behavior, while A4/B5 enforce the already-required single authorized observer, no prefetch/default retry/focus fan-out, and no unknown-operation replay. Do not make normal browser GET depend on an Origin header browsers often omit.
- The direct API contract is unchanged. Missing/invalid trusted BFF origin still fails configuration/readiness closed as specified above; that is separate from an otherwise valid safe request omitting its Origin header.

Tests explicitly distinguish a valid no-Origin legacy GET with Cookie+Bearer, a no-Origin browser-looking unsafe request (reject), a no-Origin/no-metadata unsafe request with native flag disabled (reject), and a fully classified synthetic native write fixture only when the explicit flag is enabled. None of those tests changes production configuration.
