# StudyWorkbench Multiclient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a portable four-service backend and independently verified native Android, iPadOS and HarmonyOS 6 online clients without weakening private access or existing study workflows.

**Architecture:** Keep Next.js, FastAPI, SurrealDB and the worker; freeze generated contracts and revocable device authentication before native implementation. Share platform-free transport/types and RN domain state, not browser internals; HarmonyOS consumes the same fixtures through native ArkTS DTOs.

**Tech Stack:** Existing locked Python/Next.js stack; SurrealDB 2.3.10; Docker Compose; React Native for Android/iPadOS; ArkTS/ArkUI for HarmonyOS 6. Native SDK versions must be selected from verified host/device compatibility, not guessed here.

**Spec:** `docs/v1/MULTICLIENT_ARCHITECTURE.md`; also read root/component `AGENTS.md`, `API_CONTRACTS.md`, `GAP_CLOSURE_PLAN.md`, `LIVE_ACCEPTANCE_SPEC.md`, `PRIVATE_SNAPSHOT.md`.

## Authorization and status

The user accepted the design and instructed self-review, revision and direct execution without another plan-approval pause. The architecture document's older “awaiting review” wording is historical, not a new approval requirement. This plan is an implementation instruction, **not implementation or acceptance evidence**.

Proceed with authorized local code/test work after self-review. Do not infer permission for new credentials/configuration activation, networking changes, third-party tunnels, paid services, new toolchain installation, signing-key uploads, store publication or external writes. Ask only for the exact additional action when one is actually needed. Continue independent local work while a gate is blocked.

## Global Constraints

- Four services: `frontend`, `api`, `worker`, `db`; API and worker use one identical backend image, one instance each, one host/local shared filesystem.
- Only frontend publishes a host port, bound to loopback; API/DB do not. Internal backend name is `http://api:5055`; SurrealDB remains `2.3.10`.
- Personal volume: `/app/data/personal`, `STUDY_WORKBENCH_DATA_DIR`; upstream volume: `/app/data/upstream-data`, `OPEN_NOTEBOOK_DATA_DIR`; DB has a separate persistent volume.
- Async-first DB/AI/graph operations; bound query parameters; secrets outside images/source/project ZIP; `_FILE` secret support; no default root credentials or placeholder encryption keys.
- Preserve `/api/personal` routes, evidence/version identity, portable archive structure with explicit version compatibility, and explicit capability failures. New exports use format 2; current readers retain format 1 support (ADR-014). Turn events describe persistent state, not token streaming.
- Online MVP only: no offline mutation queue, automatic conflict merge, end-device model, indefinite background worker or client-side Google integration.
- Keep Google strict-isolation fail-closed; real model/Google evidence remains a separate release gate. Independent-model-only release needs explicit scope acceptance.
- No upstream push, force-push or silent history replacement. Snapshot/private history and source history are distinct.
- Each user-visible implementation batch updates the existing appropriate `CHANGELOG.md` Unreleased section; integration owner serializes these edits.
- New Web copy uses all existing locales and design tokens; keep the existing `apiClient`, replacing its authentication behavior rather than adding another axios client.

## Review Focus

1. Lost refresh response must trigger explicit safe re-login without lost drafts; simultaneous requests must be coordinated and old refresh tokens must not remain usable (T4/T5).
2. A platform login redirect to another host must never receive the application Bearer token (T2/T6/T8).
3. A delayed save from one device must not overwrite a newer note from another (T3/T7).
4. Process death during upload/export or background suspension must preserve operation identity without duplicate writes (T7–T10).
5. A plausible backup missing upstream SQLite or encryption secrets must fail restoration acceptance, not be called portable (T11).

## Immediate bounded batch

Start **T1 static configuration** and **T3a actual API snapshot/guard tests** in parallel now; neither needs external ingress, real credentials, Docker runtime or native tools. T3b conditional writes and T4 device-auth protocol review follow; do not make snapshot export wait for those feature changes. Auth service implementation with synthetic fixtures is safe code work, not provisioning real persistent user credentials.

Parent verified canonical private baseline `07654a46` (10-commit history; 987 files): integration `/workspace/shared/study-workbench-private-git`, deployment `/workspace/shared/study-workbench-wt-docker`, contracts `/workspace/shared/study-workbench-wt-contracts`, private-only origin. These are parent-reported audit results; attach the full SHA/inventory before publication. Canonical backend baseline: 1359 passed, 1 skipped, 2 pre-existing warnings (2026-10-21); frontend baseline: 390 tests, typecheck, lint and production build passed (7 existing lint warnings). Documentation is authored in the source checkout and copied by integration owner.

## Dependency graph and ownership

```
T0 baseline audit ─┬─ T1 container static contract ───────────┐
                  ├─ T2 private ingress feasibility ───────┤
                  └─ T3 API contract/concurrency ─ T4 auth ┤
                                                     T5 Web migration
T3 + T4 + T5 + T2 native gate ─ T6 SDK ─ T7 RN core ─┬─ T8 Android
                                                   └─ T9 iPadOS
T3 + T4 + T5 + T2 native gate ───────────────────────── T10 HarmonyOS
T1 + T4 + T5 + authorized Docker host ─ T11 runtime/migration
T8/T9/T10 (independent) + T11 + live-capability evidence ─ T12 release acceptance
```

T2 research and platform/SDK inventories can run immediately. Until native ingress passes, architecture probes and fixture-only tests may proceed; do not start production connected native implementations or claim native usability. T11 need not wait for clients. Real-model/Google gap work can proceed independently under its existing authorization and file ownership.

| Branch/worktree owner | Exclusive write surface | Merge prerequisite |
|---|---|---|
| integration owner: `integration/multiclient-v1` | baseline, shared docs, CHANGELOG, test/evidence matrix | T0 audit |
| deployment: `feat/docker-deployment` | `.dockerignore`, `deploy/v1/`, container checker/tests | T0; coordinate `api/main.py` and config edits with backend owner |
| contracts/backend: `feat/api-contracts-v1` | `contracts/v1/`, contract scripts/tests, personal concurrency | T0 |
| auth/backend: `feat/device-auth` | auth service/router/store, Web auth migration | T3; sole writer to `api/main.py` while active |
| core: `feat/mobile-core` | `packages/api-client/`, `clients/mobile/src/` except platform directories, mobile root config | T3–T5/T2 |
| Android: `feat/android-client` | `clients/mobile/android/`, `clients/mobile/src/platform/android/` | T7 |
| iPadOS: `feat/ipados-client` | `clients/mobile/ios/`, `clients/mobile/src/platform/ios/` | T7 |
| HarmonyOS: `feat/harmonyos6-client` | `clients/harmonyos/` | T3–T5/T2 |

Do not concurrently edit the same tracked file in shared checkout. Use separate worktrees on the audited baseline; merge shared interfaces into integration before consumers synchronize. Native platform owners request shared-core edits from its owner. Root lockfiles, API bootstrap and CHANGELOG have one writer. Create branches only when real bounded work starts; remote branches/publication are separate external actions.

## Execution conventions and evidence

Every task follows RED → minimal implementation → GREEN → review → small Conventional Commit, using only owned files. Commands below are **planned commands**, not claims they ran. Test names and newly named scripts are deliverables to create in their owning task. Expected success is exit 0 with all listed assertions passing; an unavailable tool is BLOCKED, never PASS. Record baseline failures separately and do not erase them.

Maintain `docs/v1/MULTICLIENT_ACCEPTANCE.md` with commit, contract hash, command, UTC timestamp, sanitized result, host/OS/SDK/device and limitation. Native statuses separately track source, unit/static, compile, emulator, real device and signed install. Keep raw potentially sensitive output outside committed evidence.

### T0 — Audited local integration baseline

**Owner:** integration. **Dependencies:** none.

**Files:** Create `docs/v1/MULTICLIENT_BASELINE.md`, `docs/v1/MULTICLIENT_ACCEPTANCE.md`; inspect `scripts/v1/prepare_private_snapshot.py`, `docs/v1/PRIVATE_SNAPSHOT.md`, `README.md`, `LICENSE`, `PUBLISH_MANIFEST.json` if present. Modify snapshot script/tests only in a separate reviewed correction if the audit proves necessary.

- [ ] Capture `git status --short`, `git branch --show-current`, `git remote -v`, `git rev-parse HEAD` and current local private-snapshot inventory without network writes.
- [ ] Run `uv run pytest tests/test_prepare_private_snapshot.py`; compare locally available private manifest/source SHA, exclusions, README rewrite and full retained-tree hashes. If private baseline is unavailable, report that exact missing input and continue source-local tasks; do not invent a private common ancestor.
- [ ] Document canonical local source and private publication mapping, exclusions and license preservation. Select integration base only after differences are accounted for; no reset/clean of user changes.
- [ ] Create isolated implementation worktrees from the verified local baseline; preserve current snapshot publishing until replacement is separately verified. Record source baseline limitation if private reconciliation remains pending.
- [ ] Run baseline Python/frontend checks listed in the final gate; record failures before feature work. Commit only audit documents, with `docs: record multiclient baseline and gates`.

**Gate:** Proven local source SHA and ownership; private publication cannot advance without verified destination mapping. T0 does not authorize any push.

### T1 — Four-service static deployment contract

**Owner:** deployment. **Dependencies:** T0; runtime execution waits for T11.

**Files:** Modify `.dockerignore`; create `deploy/v1/Dockerfile.backend`, `deploy/v1/Dockerfile.frontend`, `deploy/v1/compose.yaml`, `deploy/v1/entrypoint.py`, `deploy/v1/env.example`, `scripts/v1/container_check.py`, `tests/test_v1_container_contract.py`, `docs/v1/DOCKER_MIGRATION.md`. Coordinate changes to `frontend/next.config.ts`, `open_notebook/config.py`, `api/main.py` only through their owners.

**Interfaces:** `container_check.py --static` exits nonzero for insecure/missing configuration structure; it never starts Docker. `entrypoint.py api|worker` validates secret files and environment, then execs the selected command without logging values. `GET /ready` has bounded DB/migration checks and returns 503 until ready; `/health` remains liveness only.

- [ ] Write failing tests: exactly four services; identical backend image/build; DB 2.3.10; frontend-only loopback publication; no secret values/default root password; dependency health ordering; required data mounts; non-root processes; no runtime package downloads; `.runtime`, `.env*`, browser profiles, credentials, backups, nested native builds and node_modules excluded from build context.
- [ ] Run `uv run pytest tests/test_v1_container_contract.py`; confirm the missing/new contract fails.
- [ ] Add context exclusions **before any build**; use explicit COPY and existing lockfiles. Pin validated base tags/digests at build verification, never substitute upstream `v1-latest`. Frontend image gets no database/model/encryption credentials.
- [ ] Implement two images and service commands; API/worker share data volumes and UID/GID. Preserve existing checkpoint/podcast/upload paths under upstream-data, checking every `open_notebook/config.py` consumer. DB credentials are file-fed through a checked launch wrapper, not baked or printed.
- [ ] Bake `INTERNAL_API_URL=http://api:5055` into the standalone build rather than relying on runtime rewrite mutation. Preserve allowlisted proxy behavior, portable import streaming route and `/config` same-origin behavior; test changes against existing proxy tests. Database healthcheck must use the pinned image's actual supported probe, verified in T11.
- [ ] Add bounded readiness tests in `tests/test_v1_readiness.py`: migration failure/timeout and unavailable DB return 503; migration complete and DB query success return 200. Never label worker health as inferred from API readiness.
- [ ] Run `python scripts/v1/container_check.py --static` and focused pytest; commit `feat(deploy): define isolated four-service deployment`.

**Gate:** Static PASS only. Docker build, DNS, uid permissions, streaming and actual readiness remain NOT RUN until T11.

### T2 — Supported private ingress and native identity feasibility

**Owner:** integration/research; no network configuration changes implied. **Dependencies:** none for research; T1/T11 for eventual container endpoint.

**Files:** Create `docs/v1/PRIVATE_INGRESS_VERIFICATION.md`, `docs/v1/PLATFORM_TOOLCHAINS.md`.

- [ ] Inventory existing supported tooling and exact dot tunnel registration capability using read-only documentation/tool discovery. Record supported action, target network namespace, owner-private policy and unknowns; a tunnel binding type is not a working registration procedure.
- [ ] Record host/device/OS, available Android JDK/SDK, macOS/Xcode and HarmonyOS DevEco/SDK, package-ID and signing constraints. Verify current official compatibility before freezing versions; do not install missing tools or purchase accounts.
- [ ] If an authorized supported entry already exists, verify owner access, non-owner rejection, assets, config, API, uploads/downloads and durable event responses. Otherwise record the exact additional registration action requiring authorization; no fallback public tunnel.
- [ ] On a native-capable approved host, prove supported platform authorization/callback and native HTTP access without copying browser Cookies. Test platform expiry, app expiry, logout, wrong host and redirect stripping. Verify final upload/download URL and audience binding.
- [ ] Record gate A (dot hosting) and gate B (native access) separately. Gate B requires actual native HTTP proof, not successful browser login. If unsupported/unknown, keep private Web and propose an independently private API alternative for explicit approval; do not implement it unilaterally.
- [ ] Commit evidence-only report `docs: record private ingress and native toolchain gates`.

**Stop condition:** Native connected work blocked until B passes. Missing discovery/authorization is UNKNOWN/BLOCKED, not “platform unsupported.”

### T3 — Generated API contract and safe concurrent edits (two independently reviewed batches)

**Owner:** contracts/backend. **Dependencies:** T0.

**Files:** Create `contracts/v1/openapi.json`, `contracts/v1/README.md`, `contracts/v1/fixtures/workspace.json`, `contracts/v1/fixtures/turn.json`, `contracts/v1/fixtures/job.json`, `contracts/v1/fixtures/errors.json`, `contracts/v1/fixtures/note-conflict.json`, `scripts/v1/export_contract.py`, `tests/test_v1_api_contract.py`, `tests/test_v1_note_concurrency.py`; modify `api/routers/evidence.py`, `api/routers/notes.py`, `api/personal_service.py`, `api/personal_store.py`, `docs/v1/API_CONTRACTS.md`. Add focused models in `api/personal_contracts.py` instead of enlarging an already large router.

**Interfaces:** Keep current route paths; note responses gain integer `revision >= 1`; note PATCH accepts `expected_revision`. Successful compare-and-save increments revision; stale revision returns HTTP 409 with `code=NOTE_REVISION_CONFLICT`, `current_revision`, no automatic overwrite. Existing notes read as revision 1. Expose a typed capability indicating conditional note writes and contract version.

- [ ] Write tests for actual app OpenAPI completeness, stable IDs/enums/nullability/UTC timestamps and sanitized fixture parsing. Assert portable/download endpoints retain existing shape and path confinement.
- [ ] Audit and unify every note writer, including existing `/api/notes/{id}` PUT. A conditional check only in personal PATCH leaves an overwrite bypass. Workspace content and revision must be read consistently; separate upstream update and snapshot writes must not return a mismatched pair after failure. Pin alternate-writer and torn-read cases in tests before choosing transaction/lock boundaries.
- [ ] Write simultaneous note PATCH test: both submit revision 1; exactly one succeeds at revision 2, the other gets 409, content/citation metadata remains the winner's. Missing expected revision follows explicit compatibility mode, not silent multi-device overwrite.
- [ ] Run focused tests and observe RED; implement atomic revision check/update within existing project lock and persistence boundary. New native clients always send revision; Web migration T5 sends it. Production multiclient mode rejects absent revision with 428; any legacy single-Web compatibility is explicit, disabled before multiclient release.
- [ ] Add typed public response models so generated schema reflects actual JSON, not generic dictionaries. Pin nullability, cancellation vs local stop-waiting, submission_state, capability errors and idempotency-conflict cases in fixtures; include archived/historical citation and unmapped Google reference cases.
- [ ] Implement `export_contract.py --check` to compare normalized actual `app.openapi()` against committed snapshot without live credentials/provider requests; default mode writes deterministic schema. Additive changes are reviewed; breaking changes require new contract version and compatibility window.
- [ ] Run `uv run pytest tests/test_v1_api_contract.py tests/test_v1_note_concurrency.py tests/test_v1_evidence_routes.py tests/test_v1_portable_roundtrip.py`, then `uv run python scripts/v1/export_contract.py --check`; commit `feat(api): freeze multiclient contract and conditional note writes`.

**T3a exit:** Actual existing-app schema snapshot, synthetic fixtures and drift guard pass without changing auth or concurrency behavior. Commit this bounded foundation first. **T3b exit:** Conditional-write implementation and tests then pass in a separate commit.

**Gate:** No native implementations before auth additions from T4 are regenerated into this same owner-controlled contract.

### T4 — Reviewed device authentication and strict rotation

**Owner:** auth/backend. **Dependencies:** T3. Code/tests may use synthetic credentials; activating changed live auth configuration requires the corresponding authorization.

**Files:** Modify `api/auth.py`, `api/routers/auth.py`, `api/main.py`, `api/personal_security.py`; create `api/device_session_service.py`, `api/device_session_store.py`, `api/device_session_models.py`, `tests/test_v1_device_sessions.py`, `tests/test_v1_device_session_security.py`, `contracts/v1/fixtures/auth.json`, `docs/7-DEVELOPMENT/decisions/ADR-014-device-sessions.md` (use next unused ADR number if 014 exists). Contract owner regenerates `contracts/v1/openapi.json`.

**Proposed HTTP interface — freeze after bounded auth security design review, before client implementation:**

- `POST /api/auth/sessions`: `{password, device_name}` → `{session_id, access_token, refresh_token, access_expires_at, refresh_expires_at}`.
- `POST /api/auth/sessions/refresh`: `{session_id, refresh_token}` → new token envelope. Initial implementation uses strictly one-use refresh; a lost success response requires fresh login, with protected drafts retained. No custom deterministic token/replay recovery protocol is frozen by this plan.
- `GET /api/auth/sessions`: authenticated metadata only; `DELETE /api/auth/sessions/{session_id}` and `DELETE /api/auth/sessions` revoke one/all, including current session.
- Access TTL 15 minutes; absolute refresh/session lifetime 30 days, not extended by rotation. Tokens opaque random 256-bit or greater, server stores only digests. All endpoints no-store; no plaintext tokens/password/auth headers in logs/errors.

**Service interface:** async `create_session(password, device_name)`, `authenticate_access(token)`, `rotate_session(session_id, refresh_token)`, `list_sessions()`, `revoke_session(session_id)`, `revoke_all_sessions()` returning validated models. Store atomic operations use async DB queries and the existing single-host locking assumption; authentication checks revocation on every request, not only expiry.

- [ ] Write expiry, revocation, malformed token, wrong password, no-secret-log and no-store tests with injected clock/random source. Login limit: five failed attempts per client address per minute plus 30 globally per minute, 429 with Retry-After; do not trust arbitrary forwarded IP headers. Limit auth bodies and device names; never reveal whether a guessed session exists.
- [ ] Before implementation, write a short ADR comparing strict one-use refresh with bounded recoverable rotation. Use strict one-use for the initial bounded implementation; document degraded weak-network UX and re-login on ambiguous rotation, never repeat ambiguous resource writes. Any richer protocol needs a separate security review, not automatic adoption of the review report's HMAC suggestion.
- [ ] Write rotation tests: single-flight across concurrent requests/tabs, atomic one-use consumption, dropped success response leading to re-login with drafts retained, expired absolute lifetime, store failure and restart. Prevent normal concurrent local refresh through coordination; unknown or duplicate results do not trigger infinite retries. Revoked families cannot be revived by a refresh racing revocation.
- [ ] Run focused tests RED; implement async transactional state transition and dedicated session storage, outside `PersonalStore.KINDS` and project exports. Register the next numbered up/down migration in `AsyncMigrationManager`; inspect the manager's actual path and latest migration before allocating the number.
- [ ] Use an in-memory boot epoch to invalidate all prior sessions on every API restart, including full restores. Document the deliberate re-login-on-restart UX. Password-file changes invalidate all sessions; missing/unreadable required password fails closed. Do not persist a plain hash verifier of a human password. Environment password changes require restart.
- [ ] Use a zero-duration password-Bearer migration window in session mode: fresh sign-in, no global-password fallback. T4/T5 must activate together; rollback is coordinated, never silently re-enables legacy password storage. Existing dev-mode tests remain explicit fixtures, not a deployed compatibility mode.
- [ ] Ensure auth login/refresh routes bypass access-token checks narrowly while retaining body limits, Origin protection and rate limiting; general `/api` protection and download auth remain intact. Test untrusted Origin writes and ensure OPTIONS cannot perform mutations.
- [ ] Run `uv run pytest tests/test_v1_device_sessions.py tests/test_v1_device_session_security.py tests/test_v1_access_control.py`; regenerate schema/fixtures through T3 exporter and commit `feat(auth): add revocable rotating device sessions`.

**Gate:** Security review of rotation/recovery and real API test under synthetic DB fixture; token storage must not be included by portable export. Native auth contract frozen only now.

### T5 — Web migration without long-lived password persistence

**Owner:** auth/Web. **Dependencies:** T3/T4.

**Files:** Modify `frontend/src/lib/api/client.ts`, `frontend/src/lib/auth-token.ts`, `frontend/src/lib/stores/auth-store.ts`, `frontend/src/lib/hooks/use-auth.ts`, `frontend/src/lib/types/auth.ts`, `frontend/src/app/api/_sse-proxy.ts`, `frontend/src/app/api/personal/imports/portable/route.ts`; create `frontend/src/app/api/auth/[...path]/route.ts`, `frontend/src/lib/api/session-proxy.ts`, `frontend/src/lib/api/session-proxy.test.ts`, `frontend/src/lib/stores/auth-store.test.ts`. Add all new UI keys to each existing locale. Also modify `frontend/src/lib/api/search.ts`, `frontend/src/lib/api/source-chat.ts`, `frontend/next.config.ts`, `frontend/src/lib/api/workbench.ts`, `frontend/src/components/workbench/StudyWorkbench.tsx` and their existing tests; direct fetch consumers must not retain password Bearer.

**Interface:** Browser uses same-origin HttpOnly Secure SameSite cookies managed by a constrained Next auth proxy; browser JS never sees refresh tokens. Proxy supplies API Bearer server-side, never to a user-selected URL. Keep existing `apiClient` as browser entry. Cookies are not a substitute for CSRF/Origin validation.

- [ ] Write tests for migration deleting `auth-storage` password/token remnants, cold reload, single-flight refresh, logout/revocation, duplicate refresh and no sensitive value in localStorage/HTML/logs.
- [ ] Implement cross-tab/server-side single-flight for refresh; strict one-use lost response causes re-login with protected drafts preserved, not grace replay or automatic writes. No pending plaintext token persistence or bespoke cryptographic recovery protocol in this batch.
- [ ] Treat cookie migration as one atomic activation: current personal middleware allows missing Origin, SSE proxy strips Origin, portable proxy strips Cookie, axios has `withCredentials: false`, and search/chat direct fetches read the password. Write actual-header integration tests for every route. Cookie-auth mutations reject missing/null/foreign Origin and require CSRF defense; native explicit Bearer requests can omit Origin, but mixed credentials are rejected. Forward validated Origin and only intended cookies; do not trust fabricated identity headers.
- [ ] Write proxy tests for allowlisted API paths, login/refresh responses with no token JSON leakage to browser, forbidden Origin/CSRF, no arbitrary upstream host, streaming and portable ZIP limits. Confirm multi-cookie forwarding and deletion paths.
- [ ] Implement the cookie/Bearer bridge for **all** existing browser API paths, including explicit streaming/portable routes; replace catch-all rewrite only after equivalence tests pass. Do not leave any raw-password fetch path bypassing `apiClient` unexamined.
- [ ] Update note saves to send expected revision and preserve editable local content on 409; show explicit reload/compare action rather than overwrite. Block multiclient mode if compatibility omission remains.
- [ ] Run `cd frontend && npm run lint && npm run test && npm run build`; run existing `scripts/v1/browser_check.py` with its documented supported invocation against a synthetic instance. Verify direct API/native Bearer remains supported independently of Web cookies; commit `feat(web): migrate browser login to protected device sessions`.

**Gate:** Existing Web flow/login/upload/download/event/import remain functional; old persisted global password removed and legacy password Bearer disabled for trial. Cookie approach must pass Origin security review before deployment.

### T6 — Platform-free typed SDK and transport contract

**Owner:** core. **Dependencies:** T3/T4/T5 and T2 native gate for connected implementation.

**Files:** Create `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/generated/schema.ts`, `packages/api-client/src/transport.ts`, `packages/api-client/src/session.ts`, `packages/api-client/src/resources.ts`, `packages/api-client/src/index.ts`, `packages/api-client/tests/contract.test.ts`, `packages/api-client/tests/transport.test.ts`, `packages/api-client/scripts/generate.mjs`; commit package-specific lockfile.

**Interfaces:** `Transport.send(request: ApiRequest): Promise<ApiResponse>`; `CredentialStore.load/save/clear`; `SessionManager.withAccessToken<T>(operation): Promise<T>` uses single-flight rotation; `StudyClient` receives base URL, transport and credential store. Binary requests use adapter-owned URI/bytes descriptors, never browser File/DOM. Generated code is not manually edited.

- [ ] Test shared fixtures, unknown enum handling, nullable evidence, server capability failure and HTTP errors before implementation.
- [ ] Test HTTPS/origin binding, rejected cross-host redirects, redacted errors and single-flight rotation. Mutations never automatically retry; idempotent same-operation reconciliation requires explicit caller action. A timeout is not proof submission failed.
- [ ] Implement minimal generator and dependency-injected transport/session API; test runtime has no `window`, `document`, localStorage or Node filesystem assumptions. Pin generator/dependency versions in local lockfile once verified.
- [ ] Add `npm test`, `npm run typecheck`, `npm run generate:check` scripts; run all three under `packages/api-client`. Commit `feat(client): add platform-free typed API transport`.

### T7 — Shared RN online domain and screens

**Owner:** core. **Dependencies:** T6; native toolchain scaffold only on verified/authorized SDK.

**Files:** Create `clients/mobile/package.json`, lockfile, `tsconfig.json`, `src/App.tsx`, `src/domain/workspace.ts`, `src/domain/operations.ts`, `src/domain/drafts.ts`, `src/platform/contracts.ts`, `src/screens/ConnectionScreen.tsx`, `WorkspaceScreen.tsx`, `ReaderScreen.tsx`, `ChatScreen.tsx`, `NotesScreen.tsx`, `TasksScreen.tsx`, `TransferScreen.tsx` (all screen names under `clients/mobile/src/screens/`), `src/components/AdaptiveWorkspace.tsx`, `src/locales/en-US.ts`, `src/locales/zh-CN.ts`, `tests/workflow.test.ts`, `tests/recovery.test.ts`, `tests/drafts.test.ts`.

**Interfaces:** Platform adapters implement `SecureStore`, `FilePicker`, `ProtectedDownloads`, `PdfNavigator`, `AudioPlayer`, `Lifecycle`, `DraftVault`; native owners consume these interfaces unchanged. `OperationRegistry.reconcile(jobId)` reuses durable identity; `DraftVault` encrypts local unsubmitted drafts and deletes on explicit discard/logout decision. No offline writes are queued.

- [ ] Write fixture-driven workflow tests: connect → notebook list → upload/version → scoped question/follow-up → exact historical citation → note conditional save → existing audio playback/download → portable export/import.
- [ ] Write recovery tests for duplicate taps, unknown submission, revoked session, offline status, service sleeping, app process death, permission denial and stale responses. Pending operation IDs are saved before waiting; app resume re-queries them rather than resubmits.
- [ ] Write draft tests: protected persistence restores unsent content after process death; logout warns and requires discard/save choice; no delayed answer or save overwrites a newer draft; conflict retains user input. Clear vault on confirmed discard/logout and disallow OS plaintext backup.
- [ ] Implement RN domain, accessible screens and phone/tablet layout capability. Separate local stop-waiting from server cancel status; surface Google blocked capabilities honestly. Keep audio playback local without starting remote generation implicitly.
- [ ] Run `cd clients/mobile && npm test && npm run typecheck`; commit `feat(mobile): implement shared online study workflow`.

**Gate:** Fixture tests are not device build evidence. T8/T9 consume one shared business implementation, not copies.

### T8 — Android native adaptation

**Owner:** Android. **Dependencies:** T7; approved available Android toolchain and T2.

**Files:** Create scaffold outputs under `clients/mobile/android/`, including `app/src/main/AndroidManifest.xml`, `app/build.gradle`, `build.gradle`, `settings.gradle`, `gradle.properties`; create `clients/mobile/src/platform/android/index.ts`, `secure-store.ts`, `files.ts`, `reader.ts`, `lifecycle.ts`, `adapters.test.ts`.

- [ ] Test adapters for document-provider content URI lifetimes, canceled/denied picker, large file streaming, filename sanitization/hash match, temporary cleanup, Keystore-backed storage and excluded backups; no broad all-files permission.
- [ ] Implement native adapters, Android back navigation and safe focus/large-text behavior; secure-store failures block login persistence rather than fall back to plain preferences.
- [ ] Run JS adapter tests and `cd clients/mobile/android && ./gradlew testDebugUnitTest assembleDebug`; record exact SDK/JDK and APK hash. Missing toolchain is blocked, not compiled.
- [ ] Exercise emulator, then an actual authorized Android device: full learning flow, rotation, permission denial, background/kill/relaunch, export file reopen/import roundtrip and offline recovery.
- [ ] Verify signed install only with authorized identity; debug APK is development evidence, not release signing. Commit `feat(android): add native study adapters`; record independent platform status.

### T9 — iPadOS native adaptation

**Owner:** iPadOS. **Dependencies:** T7; authorized compatible macOS/Xcode host and T2.

**Files:** Create scaffold outputs under `clients/mobile/ios/`, including `Podfile`, `StudyWorkbench/Info.plist`, `StudyWorkbench/StudyWorkbench.entitlements`, `StudyWorkbench.xcodeproj/project.pbxproj`; create `clients/mobile/src/platform/ios/index.ts`, `secure-store.ts`, `files.ts`, `reader.ts`, `lifecycle.ts`, `adapters.test.ts`.

- [ ] Test Keychain access/backup policy, file-coordinator/security-scoped document access lifetime, share cancellation, protected temp cleanup and secure draft recovery. Denied file or keychain access must not silently lose input.
- [ ] Implement iPad sidebar/detail layout through shared layout API, landscape/split-screen, keyboard shortcuts/focus and pointer targets. Do not fork domain state or stretch phone UI.
- [ ] Run adapter tests; on approved macOS host run `xcodebuild -list -project clients/mobile/ios/StudyWorkbench.xcodeproj`, then build/test the generated scheme with an available named iPad simulator destination and record the exact command. Linux JS PASS cannot satisfy this gate.
- [ ] Verify actual iPad import/question/citation/note/export/audio workflow, split-screen/large text, app suspension and document roundtrip. Record signing/install separately; limited personal-account testing does not prove distribution eligibility.
- [ ] Commit `feat(ipados): add tablet-native adapters and layout`; no TestFlight/store upload without explicit authorization.

### T10 — HarmonyOS 6 independent ArkTS implementation

**Owner:** HarmonyOS. **Dependencies:** T3/T4/T5 and T2; can parallel T6/T7 once schema/auth frozen.

**Files:** Create `clients/harmonyos/AppScope/app.json5`, `build-profile.json5`, `oh-package.json5`, `hvigorfile.ts`, `entry/src/main/module.json5`, `entry/src/main/ets/entryability/EntryAbility.ets`, `entry/src/main/ets/contracts/ApiModels.ets`, `entry/src/main/ets/services/StudyApi.ets`, `entry/src/main/ets/services/DeviceSession.ets`, `entry/src/main/ets/platform/SecureStore.ets`, `Files.ets`, `Reader.ets`, `DraftVault.ets` (last three in same platform directory), `entry/src/main/ets/pages/Workspace.ets`, `Reader.ets`, `Chat.ets`, `Notes.ets`, `Transfers.ets` (same pages directory), `entry/src/ohosTest/ets/test/Contract.test.ets`, `Recovery.test.ets` (same test directory).

- [ ] Write DTO/fixture tests against committed contract for every MVP response and error; ArkTS compatibility is proven with its own compiler, not assumed from TypeScript success.
- [ ] Write auth rotation, TLS/host binding, local encrypted draft, upload/download, exact PDF page/version, permission and lifecycle tests matching RN acceptance semantics.
- [ ] Implement ArkUI navigation and full online MVP with platform-native adapters. Use verified HarmonyOS secure credential facility; no preferences fallback, Google SDK or APK compatibility assumption.
- [ ] On authorized supported DevEco/SDK host run its generated project wrapper build and native tests, recording actual wrapper command, SDK, product/target and artifact hash. Tooling unavailable means blocked; don't fabricate a generic Linux build success.
- [ ] Verify emulator and actual HarmonyOS 6 device separately, including full portable file roundtrip and install/signature evidence. Commit `feat(harmonyos): implement native online study workflow`.

### T11 — Actual container build, queue health and restore drill

**Owner:** deployment with backend support. **Dependencies:** T1/T4/T5; authorized working Docker host. No toolchain installation or host networking change inferred.

**Files:** Extend `scripts/v1/container_check.py` with `--runtime` operating only on a named synthetic Compose project; create `commands/health_commands.py`, `tests/test_v1_worker_health.py`, `scripts/v1/migration_check.py`, `tests/test_v1_migration_manifest.py`; modify `commands/__init__.py`, `docs/v1/DOCKER_MIGRATION.md`; record sanitized results in acceptance document.

**Interfaces:** Register `@command("v1_health", app="open_notebook")`, no model/Google calls, returns a nonce tied to durable command identity. Runtime checker requires `--project-name` and refuses existing non-synthetic data roots; it never runs `down -v`. Migration checker compares synthetic backup manifests, record counts, file hashes, SQLite integrity and encrypted fixture decryption.

- [ ] Test checker safety: no runtime invocation from `--static`; no secret output; refusal to run destructive cleanup or overwrite backup; worker probe job completes only with actual worker execution.
- [ ] Run static checks before sending build context. On approved host run `docker compose -p swb-v1-check -f deploy/v1/compose.yaml config --quiet`, then `build`, then `up -d`; use separate synthetic secret files outside repository. Record actual versions/digests and image provenance.
- [ ] Verify non-root UID, frontend loopback binding, no host API/DB ports, backend DNS, startup migration readiness, live worker nonce completion, correct shared data permissions, process restart and persistent task recovery. Stop worker deliberately in this synthetic project and prove readiness/probe distinguishes queue blockage.
- [ ] Verify browser login, streaming/event response boundaries, upload, config, protected originals/audio/ZIP and large import through the actual frontend image. Restart under a different Compose project with the same service names to prove proxy portability.
- [ ] Seed synthetic personal data, upstream uploads/checkpoints/podcasts, encrypted configuration and unfinished jobs. Quiesce new writes, drain/record jobs, stop writers including DB, snapshot all volumes consistently and independently retain secrets. Restore into a new isolated project; revoke sessions before exposing restored API.
- [ ] Verify counts/hashes, SQLite integrity, decrypted synthetic value, historical citation and exported ZIP; restored jobs do not replay remote writes. Negative drill omits upstream data/key and must fail. Test rollback using matched old code **and** old data snapshot.
- [ ] Record an out-of-workspace backup retrieval location only when authorized and actually verified; local backup alone does not meet disaster-recovery gate. Do not upload real data as an implicit test.
- [ ] Run runtime/migration scripts and focused tests; stop synthetic services without deleting volumes. Commit `test(deploy): verify queue health and migration recovery` with sanitized evidence only.

**Gate:** Runtime PASS requires real commands and restore drill. This dot's missing Docker cannot be solved by relabeling static tests; retain precise blocker until an approved capable host exists.

### T12 — Integration, per-platform red team and delivery

**Owner:** integration. **Dependencies:** release target's platform task + T11 + T2 + actual promised model/Google gates. Other platforms may remain blocked.

**Files:** Update `docs/v1/MULTICLIENT_ACCEPTANCE.md`, `docs/v1/PROGRESS.md`, `docs/v1/ACCEPTANCE.md`, `docs/v1/RUNBOOK.md`, `docs/v1/DOCKER_MIGRATION.md`, `CHANGELOG.md`.

- [ ] Integrate reviewed small batches and run full baseline regression: `uv run ruff check .`, `uv run ruff format --check .`, `uv run python -m mypy .`, `uv run pytest tests/`; in frontend run `npm run lint`, `npm run test:coverage`, `npm run build`; run SDK/RN/native checks applicable to each release target.
- [ ] Run deterministic contract regeneration, fixture parity and secret/build-context scans. Review shared API/worker lock assumptions; no scaling claim without redesign.
- [ ] For each target independently execute first connection → import → question → citation → note → export, plus wrong password, empty sources, offline, denied permission, large text, duplicate click, unknown cancel, app resume and sleeping server. Include history/version accuracy and conflict preservation.
- [ ] Re-run security negatives: unauthenticated/non-owner/ revoked access denied, wrong Origin denied, cross-host token withheld, secret files absent from images/ZIP/logs, private drafts excluded from backups. Confirm old global Bearer acceptance disabled.
- [ ] Link actual real-model and Google evidence from existing gap plan; unavailable Google visible login or strict isolation remains an explicit blocker. Do not mark simulated provider tests as live capability acceptance.
- [ ] After completion and acceptance, publish the application through ChatGPT Sites with owner-private access, as explicitly requested on 2026-10-21. Verify the supported connection to the dot backend, authenticated access, non-owner rejection and end-to-end study workflow before sharing a live URL. Do not substitute public exposure or unrelated existing Sites. If registration/native access remains unavailable, report deployment blocked rather than treating source delivery as completion.
- [ ] Deliver only the independently passed surface with exact install/access limitations and recovery instructions. Record blocked target, required action/host/authorization and completed evidence for every remainder; no “all platforms complete” based on source-only work.
- [ ] Local commit `docs: record verified multiclient acceptance`; private publishing/version tags/external writes proceed only under applicable authorization and audited destination, never implicit upstream push.

## Self-review (completed for this plan)

- Coverage checked against architecture sections 1–12: deployment T1/T11; two ingress gates T2; auth T4/T5; contracts/concurrency T3; SDK/adapters/MVP T6–T10; backup T11; baseline/ownership T0; platform/release/live capability gates T12.
- Corrected sequencing: device auth, Web migration and native ingress precede connected clients; Docker static work and ingress research remain parallel. Runtime verification is separate from source scaffolding.
- Corrected token replay ambiguity after independent auth review: initial strict one-use refresh deliberately requires re-login on lost response, protects drafts and does not retry writes; advanced recoverable protocols are deferred to explicit security review. Restart invalidates sessions conservatively.
- Corrected multi-device data loss: conditional note writes are a prerequisite, with missing revision rejected in multiclient mode and existing Web migrated first.
- Corrected authorization conflation: no approval pause for this plan; new external/network/credential/toolchain/distribution actions still require their specific authority.
- Remaining environmental uncertainties are explicit gates, not unassigned implementation details: supported dot tunnel/native auth, Docker host, macOS/Xcode, HarmonyOS SDK/device and actual model/Google proof.
