# Multi-client acceptance ledger

Updated 2026-10-21 UTC. Planned work is not accepted functionality.

| Surface | Evidence | Status / remaining gate |
|---|---|---|
| Canonical Git baseline | 07654a46, full history/tree/file hashes and fsck | Verified; two reviewed feature branches published with exact-tree mappings below |
| Backend baseline | 1359 passed, 1 skipped, 2 existing warnings | Passed on canonical baseline |
| Integrated foundations | 1473 passed, 1 skipped, 2 existing warnings; 72.29 seconds | Passed with deterministic external-metadata/DNS fixtures, verified tokenizer cache and credential-free guarded Python runner |
| Frontend baseline | 390 tests / 53 files, types, lint (7 existing warnings), production build | Passed; initial external node_modules symlink rejected by Turbopack, resolved by isolated local dependency copy without code changes |
| Docker deployment | d773de0; 61 final focused tests; independent fix re-review approved | Static PASS. No Docker runtime; build/Compose/restore NOT RUN |
| API contract foundation | 47d0134; 84 regression tests passed / 1 skipped before final test-only addition; final 15 contract tests passed; independent review approved | Integrated locally; current generic response-schema gaps remain explicit |
| Note revision backend | dc96f38 reviewed; 77 isolated note/portable checks; integrated 1499 passed / 19 gated skips | Backend integrated; reviewed Web conflict UX integrated below; legacy compatibility still default |
| Device sessions | Reviewed core and real adapter/HTTP 56b43f4 integrated; 1597 combined backend tests passed / 37 gated skips | Not activated; Web migration and coordinated acceptance pending |
| Native private ingress | No verified supported dot tunnel registration/native HTTP path | BLOCKED/UNKNOWN, not declared unsupported |
| Android | No client build | Not started; SDK/device evidence pending |
| iPadOS | No client build | Not started; macOS/Xcode/device evidence pending |
| HarmonyOS 6 | No client build | Not started; SDK/device evidence pending |
| Live AI / Google | Existing offline tests only | Real capability gates remain open |

## Explicit design tradeoffs

- Initial refresh protocol uses strictly one-use random refresh credentials. If a successful refresh response is lost, the user signs in again; protected drafts must survive. This avoids a bespoke recovery cryptographic protocol and never retries an ambiguous resource write.
- Initial sessions invalidate on API restart/full restore. This intentionally favors non-resurrection of revoked sessions over seamless restart login.
- Cookie/Bearer Web migration activates atomically across regular proxy, SSE/events, uploads and downloads; partial activation is forbidden.

## Review closure and publication

- T1 public-Origin and runtime metadata findings: fixed and independently re-reviewed. Foreign-Origin rejection remains tested.
- Publisher lazy-fetch and shallow-parent findings: fixed and re-reviewed; final import guards pass type checks.
- Whole-foundations review: specification PASS and quality/security APPROVED, with the acceptance ledger reconciled here.
- API branch `feat/api-contracts-v1`: remote `0ea2733fbfbb2eabc10cb3cac2b9b21e87a25e9a`, reviewed local `47d01348dd1ae8107f20b11f766d11c97469b817`, tree `ea27e2960b152af6b886bc68224f4ec84b85a320`, 996 files verified.
- Docker branch `feat/docker-deployment`: remote `47fcdf97d908100595dda9e55b78a65c765f4585`, reviewed local `d773de04acb6df53044641ba7294395195e5c138`, tree `250a893f005ec3d7a0c07cfd6787083899a64325`, 995 files verified.
- Both remote branches retain parent `07654a46f70e5a02dc97e9bf4359a734e6bbdcdd`; connector commit metadata differs from local commits. Exact trees and refs were verified. Stable main was not advanced by these branch publications.

## Verification limits and corrected test setup

A fresh-worktree suite was stopped by safety review for an unexpected Azure Blob access; another guarded attempt was blocked on a GitHub update check. Neither attempt is a pass. Static diagnosis identified missing tokenizer cache and unmocked unit-test metadata/DNS dependencies. The public tokenizer cache matches the installed package's SHA-256; tests now use scoped synthetic fixtures without weakening SSRF negative tests.

A local verification-wrapper bug reran pytest inside spawned extraction workers and caused an extraction timeout. Adding the normal main-entry guard resolved it; six extraction-command regressions passed before the final full run. No application extraction timeout was relaxed.

The final Python runner clears ambient credentials/dotenv, reuses the verified cache and rejects external Python DNS/connect. This is a regression tripwire, not a claim of an OS-level network sandbox. Reviewed subprocess paths and exporter isolation remain separate checks. Final full result: **1473 passed, 1 opt-in skipped, 2 existing deprecation warnings**.

No actual Docker build/Compose, native client build/device test, live model/Google acceptance or private Sites publication occurred in this foundation checkpoint. User explicitly requires owner-private ChatGPT Sites publication after completion and acceptance; the supported dot connection and native access gates remain unresolved.

## Note-backend checkpoint

The two Note.save compatibility findings were fixed and re-reviewed: projected notes retain omitted body fields; strict domain validation happens before any write. Integrated backend result: **1499 passed, 19 gated skips, 2 existing warnings**. The native SurrealDB note/portable run independently passed **77 checks**. At that checkpoint, Web conflict UI, device-session storage/HTTP integration and enforcement activation remained incomplete; later evidence follows below.

Foundation integration is published at remote aa029330e85c78b637ee4df90b7c1f6f40e85eff. Updating main was denied pending explicit user permission; main remains 07654a46. This permission gate does not stop implementation or reviewed feature/integration-branch publication.


## Note Web recovery checkpoint (2026-10-21 18:44 UTC)

Reviewed source `ae9e81c6cc2ce2d7766dc274c2cde0e12fa865c6` (after `ffa20301`) integrated without conflicts. Full frontend suite: **414 passed / 55 files**, focused **105 passed**, typecheck and production build passed; lint has zero errors and seven unchanged warnings. No auth-mode activation or deployment occurred.

Independent browser checks used synthetic data with real SurrealDB/API and the exact frozen frontend build. Initial coverage passed stale-revision 409 handling in both editors, retained drafts, read-only comparison, canceled/confirmed reload, subsequent revision-conditioned saves, duplicate-click protection, committed-but-lost responses, and bounded candidate inspection. Desktop/tablet/mobile widths and Chinese mobile confirmation were inspected.

Independent RED reproduction exposed buffered inline-title loss during a pending acknowledgement and duplicate Save Answer creation after a committed-but-lost response. On the final fix build, scoped GREEN confirmed the newer focused title stays visible and the next explicit save persists revision 3; ambiguous Save Answer remains blocked with exactly one POST, explicit read-only candidate comparison and unrelated draft retention. Final code review passed. Real-component unit tests additionally cover create/update buffered titles and Escape; real-hook tests cover create/update/delete with a global retry default. These last cases were not all repeated in browser. Owned synthetic services were stopped.

## Portable format and core checkpoint

Revision-aware archives now write format 2; exact-integer format 1/2 reading remains supported. Reviewed `7265593` passed 106 focused tests (one gated skip), its branch suite 1560 tests (19 skips), and a separate actual database export revision 7 → restore 7 → save 8 check. Old readers reject format 2 instead of silently discarding revisions. This is not a full deployment migration drill.

Pure device-session core `b3f18b0` passed 28 focused tests and independent contention/mutation review before integration. At that checkpoint the real database/HTTP extension still required correction for a damaged-schema readiness gap; final evidence follows below. No browser cookie migration, native client or actual user session is claimed.


## Device-session backend checkpoint (2026-10-21 18:53 UTC)

Source `56b43f43526f2fdca83171717472d8e9c10245c7` passed independent re-review and was integrated at `b241b43e932c56402c5118c5935de24c9b2132a6`. The combined canonical suite passed **1597 tests, 37 gated skips, 2 existing warnings in 96.35 seconds**. Whole-repository Ruff/format, mypy **239 source files**, and actual-app OpenAPI equality passed. Frontend bytes remain identical to the independently tested `ae9e81c6` note-recovery build; no auth Web implementation is claimed.

Dedicated real SurrealDB 2.3.10 tests passed **33 checks** including 17 damaged-schema cases. Independent review reran **55 repository/HTTP tests**, healthy actual app migrations 1–28 and login/rotation/overlap/revocation, then the original missing-table restart failure. Missing/incompatible auth tables, fields or unique index definitions now fail closed without implicit table recreation. Generic auth-only 404/405 envelopes preserve status and Allow headers.

Schema metadata is checked without caching before every store operation on the same connection, intentionally adding query overhead. Concurrent administrative DDL/restore between metadata validation and the transaction remains unsupported; no atomic DDL defense is claimed. Accepted new deployment definitions pin 2.3.10; older root Docker configurations are not this deployment's accepted path. Actual container execution remains NOT RUN.

Legacy password mode remains the default, empty/unknown modes fail closed, and no user credentials/sessions were created or activated. Browser migration, protected in-place reauthentication, private ingress, Docker runtime and each native platform still need their own acceptance.


## Web policy preparation checkpoint (2026-10-21 19:26 UTC)

ADR-016 and the standalone Web implementation plan adopt a stable opaque HttpOnly BFF handle with bounded current native-token custody in process memory. Independent design review corrected terminal-deadline refresh storms, pruned-access recovery, login admission ordering, orphan cleanup and authority before cross-session effects. This supersedes earlier three-cookie rotation proposals; native protocol version 1 is unchanged. Coupled frontend/API restart is an additional activation requirement, not yet implemented or verified.

Reviewed Task 1 commit `428ab5270a04cd8424fd3d84151842fc85c71c0f` is integrated at `6829f49ef3530b1aa0b70ce1beaf39c835fd734a`. Its branch passed **681 frontend tests / 56 files**, production build, installed local TypeScript and focused ESLint; independent review reran **285 focused tests**, checked **146 route/method entries**, and found no server configuration references in **49 browser bundles**. The shared test-only server-marker alias is present in integration but was not required by that branch. Combined frontend acceptance will rerun after the memory-core merge; branch results are not relabeled as a new combined suite.

An `npx tsc` attempt was denied because it could resolve/download a package. No retry of package resolution or installation occurred; the already-installed TypeScript CLI was verified and executed directly with Node. Existing public Google font assets were permitted only for the normal build, which passed without source/vendor/dependency changes.

The existing `modelsApi.get(id)` has no actual `GET /api/models/{id}` backend contract and remains deliberately denied by device policy. Backend mode readiness enforcement, actual cookie proxy/store wiring, browser migration and activation are still pending. The memory-core implementation is isolated and under test, not yet accepted.

The full-service migration preflight branch is unmerged and unaccepted: its independent review was blocked by safety review. Restricted probing was not retried through another route; this does not block unrelated Web work. Its passing focused tests alone do not satisfy the independent review or actual restore gate.


## Memory BFF core checkpoint (2026-10-21 19:34 UTC)

Reviewed source `0d72b971da910971e9dcd860ab75f787c6696b3d` was cherry-picked as `855358f93025146958e5e4ad59bb5ede7a77e428`; the branch's separate shared test-alias commit was not duplicated. Independent review reran **43 focused tests** and approved the core. Branch evidence: **457 tests / 56 files**, installed local TypeScript and focused ESLint passed. Combined canonical policy/core evidence: **724 tests / 57 files in 73.89 seconds**, installed local TypeScript and focused core/policy ESLint passed. No production-build claim is added for the unwired core; actual route bundling will be checked with Task 3.

The bounded core keeps physical capacity occupied when an adapter ignores abort, instead of accumulating hidden outstanding requests after logical timeout. Captured native revocation deliberately does not auto-clean the caller first; the one-use proof retains request-local authority for the single management call. These are synthetic state-machine properties, not actual browser-cookie, backend-hop, Docker restart or deployment evidence.

Tasks 3 and 4/5 now proceed in isolated server-proxy and browser-recovery branches against the frozen Web-only response contract in the implementation plan. Legacy remains the default. No actual credentials, sessions or mode changes occurred.


## Web server proxy checkpoint (2026-10-21 20:09 UTC)

Task 3 source `ed080f38b67f07c06e885331d32aa5806c8f4450` passed independent review and was integrated at `da0bde23f23fa7801f7ff09c5ca1a0893a2ef16c`. Integration's frontend tree is byte-identical to that tested source. Final branch checks: **862 tests / 60 files in 75.81 seconds**, installed TypeScript, full ESLint with **0 errors / 7 unchanged warnings**, and production Next build passed. Four independent narrow regressions verified the review fixes on the final commit. Earlier pre-fix 853-test evidence is historical, not the accepted final result.

Review fixed three issues: legacy frontend/backend mode mismatch now rejects every dispatch before credentials/body forwarding; a known readiness failure during due refresh preserves sanitized 503 rather than falsely reporting authentication rejection; maintenance cleanup diagnostics cannot contaminate an unrelated request's result. Legacy mode adds one fresh credential-free status check per dispatch, deliberately not cached across backend replacement.

Auth input/upstream envelopes/status/error bodies are bounded at 8 KiB; session lists/probes at 256 KiB, without assuming only 32 historical rows or silently truncating. A larger history yields unavailable. Resource JSON/SSE/upload/download bodies remain streams under the API's existing declared/chunked input limits; portable import keeps its separate budget. Actual browser, HTTP loss-hop, production HTTPS/private ingress, coupled restart and activation are still unverified. Tasks 4/5 remain in an isolated branch under corrective review.


## Browser transport and recovery checkpoint (2026-10-21 20:43 UTC)

Task 4/5 source `5aebd705bda888908e38f533490c4ada90f671ef` passed independent review and merged without conflicts at `336ece64072d53e9952490ccb27f83e9971c599b`. Its final branch suite passed **886 tests / 67 files**, production build including TypeScript, and full lint with **0 errors / 7 existing warnings**; all explicit process exit markers were zero. Independent immutable-source review passed **148 focused tests / 12 files** and closed all eleven findings. These are branch results, not yet combined server/browser acceptance.

The browser uses the existing single Axios client with its installed fetch adapter and redirect rejection; device mode never reads/sends a password Bearer and purges legacy storage before backend metadata availability. Explicit legacy compatibility remains separate. Generations fence late resource/auth completions; safe status confirmation, not login acknowledgement alone, unlocks explicit signout. Recovery retains mounted drafts and selected files, provides modal-reachable connection retry and restores focus safely. Only locally proven undispatched or exactly rejected auth writes permit manual note save retry; uncertain commits and conflicts still require reconciliation and mutations never automatically replay.

Metadata bootstrap permits same-origin ambient ingress cookies without application Authorization. Its narrow server companion remains under independent review; actual Sites cookie mechanics, browser pointer/focus behavior, real HTTP loss hops, coupled frontend/API restart, native clients and activation remain unverified. Legacy remains the default.


## Combined Web session checkpoint (2026-10-21 20:56 UTC)

Narrow metadata companion `000de35c62ca4845d77981a6f9dd6e2efe043f4b` passed independent review (463 existing and 26 added synthetic checks). Exact GET `/api/config` ignores app-cookie authority but retains mode/readiness and supplied Origin/Fetch-Metadata checks; fixed upstream headers strip all Cookie/Authorization, and bounded output retains only the existing four public fields. Device `/config` gains the same safe-read guard. Status/protected routes remain cookie-aware and strict. This is compatibility hardening, not actual Sites acceptance.

The initial combined build caught three TypeScript errors in heterogeneous test-header tables despite 1076 passing runtime tests. Test-only follow-up `366180f7767a6dc9299b1176baf0ed4d4f949b11` supplied explicit table types without casts/suppressions or changed cases; independent narrow review approved it. Cherry-picked canonical `656fb667e2a7e413645a7070b0a1142bd9f2fb11` subsequently passed the complete **1076 tests / 70 files in 90.28 seconds**, full lint with **0 errors / 7 existing warnings**, and production build including TypeScript. All final exit markers were zero. An intervening interrupted run had no terminal result and is not counted.

Actual synthetic local-browser acceptance is now starting against that immutable SHA. No production activation, deployment, real credentials, providers, native-client acceptance or coupled-restart claim follows these checks.

Private Sites connectivity remains **unknown/blocked on a documented connection contract**, not proven unsupported: the deployment schema consumes already-registered private HTTP tunnel IDs, but current tools/docs do not establish dot-hosted registration/client setup or native-client onboarding. No token, Site, tunnel, public fallback or platform security change was created.
