# StudyWorkbench V1 progress

Original checkpoint: 2026-10-18 UTC. Continuation updated: 2026-10-21 UTC. Branch: `feature/study-workbench-v1`. Baseline: Open Notebook 1.15.0 at `a0f6f3081ae06328f0a451b3a3ef2959ca25721d`. Exact handoff commit and archive hashes are recorded in the accompanying delivery manifest; use `git rev-parse HEAD` in the Git bundle checkout.

This is a reproducible development delivery with a working local document workflow, **not a fully accepted personal NotebookLM deployment**. No real Google login, model call, NotebookLM write or paid resource was used. Production credentials remain awaiting approval.

| Stage | Result at handoff |
|---|---|
| T00 | Complete: upstream pinned, environment evidence, 1000-test upstream baseline, official registry and native SurrealDB provenance |
| T01 | Native SurrealDB/API/worker and migration 26 integrated; default-on fail-closed private access verified. Production credentials and protected external HTTPS pending |
| T02 | Immutable originals/versions and CPU PDF/MD/TXT evidence implemented; real upload, worker parse, exact download and restart verified |
| T03 | Three-panel workbench, persistent source choices and PDF.js reader implemented. Real Firefox login, desktop and Chinese 390px mobile checks passed; mobile drawer and no-overflow assertions included |
| T04 | Scoped lexical retrieval implemented; 20 Chinese retrieval gold cases and exact locator tests pass without a model |
| T05 | Independent grounded answer and bounded-outline contracts implemented with immutable turn scopes, citations and actual retrieval coverage. Fake-model tests pass; actual model unconfigured |
| T06 | Pinned notebooklm-py adapter and auth state machine implemented with injected-fake tests. Real runtime Google login/read-only verification pending |
| T07 | Import/link/create/sync IDs, idempotency and unknown-outcome recovery implemented with fake tests. SDK inventory is explicitly recent-only/incomplete; live Google operations unverified |
| T08 | Turn persistence/reference resolution implemented; published SDK 0.8.5 cannot provide proven non-destructive fresh context. Strict NotebookLM ask fails closed; core live Q&A remains incomplete |
| T09 | Notes save/edit/history/export and actual UI save/refresh verified. Bounded outline and audio state machines tested with fakes; real outline/audio generation and playback pending |
| T10 | Snapshot export and atomic remapped restore implemented. Real UI download/import and fresh DB/filesystem restore passed, including source removal, rollback and re-export. Restored historical references remain readable and unverified |
| T11 | Focused review fixes include authentication, worker races/cancellation, historical readers, MIME/page/ZIP checks and persistent archive trust. Full backend/frontend regressions, types, lint, build and real local/browser checks passed |
| T12 | Source, lockfiles, runbooks, A01–A24 matrix, machine-readable evidence, public fixture ZIPs and Chinese screenshots prepared. Source ZIP and Git bundle provide reproducible handoff; no public deployment claim |

## 2026-10-18 checkpoint verification

- Backend: **1182 passed, 1 skipped**, 2 existing dependency warnings; `evidence/python-tests.txt` and `python-tests.xml`
- The default-suite skip is opt-in native restoration, separately executed in the dedicated suite: **39 passed** against official disk-backed SurrealDB; `evidence/portable-native-restore.txt`
- Frontend: **266 passed**, TypeScript and production build passed; lint passed with 7 unchanged upstream warnings; `evidence/frontend-*`
- Real native API/worker and Firefox: login, original reading, lexical search, save/refresh persistence, export/download/import, preserved unverified reference navigation, PDF raster and explicit malformed-PDF fallback, Chinese desktop/mobile; `evidence/browser/`
- Scope coverage shows selected versus actually contributing sources and evidence excerpts. Bounded outline never claims the entire selected collection was processed
- Archive imports get server-controlled provenance markers on every extraction/evidence record. Editing notes, searching or answering cannot turn those records green by trusting the same archive; fresh extraction creates new IDs instead

Coverage baseline and targeted follow-up are retained in `COVERAGE.md`. The follow-up found and fixed MIME/filename upload-idempotency conflict detection and restored-subquote page navigation; it was not a blanket effort to maximize a percentage.

## Remaining gates and next practical action

1. Obtain targeted authorization for private application/encryption/database credentials and provision them outside source/export
2. Establish a protected HTTPS ingress and known storage lifecycle; this environment offers no verified external address
3. Authorize application-runtime Google login plus a read-only account check
4. Resolve the published SDK strict-history isolation blocker before enabling real scoped NotebookLM Q&A
5. Explicitly authorize remote create/sync/audio checks and optionally configure an existing independent model for real gold-answer tests
6. Local API/worker SIGKILL maintenance recovery is now verified (2026-10-21). Browser interruption, host reboot, database corruption and remote-service recovery remain distinct unverified scenarios.

Filesystem persists across commands, but command PID/network namespaces differ. Reproduction scripts launch services/browser in one process tree and stop them afterward. Sandbox/workspace lifetime beyond this task is not guaranteed. No production credentials, Google profile or publicly reachable service were created.

## 2026-10-20 continuation

Implemented durable local reparse/revalidation HTTP and reader UI, independently comparing retained originals while preserving historical identities/locators. Restore discards supplied revalidation reports; explicit invalid/out-of-scope citation decisions remain intact. Same-job status polling recovers stale maintenance under locks without replaying restored history; failed/restarted reparse preserves the old ready extraction. Strict remote capability is rechecked inside the call lock and SDK ask remains blocked. Matching terminal jobs now release the composer even when no turn was created.

Current verified frontend: **289 tests passed across 48 files**, TypeScript passed, lint passed with 7 existing warnings, production build passed. The new trust regression first failed three targeted tests before the fix, then passed. Backend: **1211 passed, 1 opt-in skip**; coverage rerun remains separate. Real Firefox/native DB/API/worker maintenance checks now passed: explicit reparse, newer-version upload with historical page 3 preserved, ZIP restore with ten initially unverified historical references, fresh-original revalidation (3 checked / 3 verified), and navigation away during another job followed by stable reload. Evidence: `evidence/continuation-2026-10-20/browser/browser-results.json` and screenshots. A06/A20 local maintenance gates are now passed; no actual process-kill maintenance recovery, Google/model/HTTPS acceptance is inferred.

## 2026-10-21 next-stage verified checkpoint

Current stage: reading-first frontend refinement and local reliability acceptance. Current commit is recorded by the source checkpoint manifest (`git rev-parse HEAD`); baseline for this continuation was `63b8eceb46c4010873f76cfabcebc419b291e2f3`.

Completed: reviewed/downloaded official Anthropic and Vercel design text; retained licensed Anthropic text and provenance; refreshed existing layout, source/version hierarchy, compact backup disclosure, pinned panel headers and keyboard narrow-screen tabs. Tablet uses a single active workbench panel until xl. Positioned hidden file inputs within their labels to fix actual document overflow rather than cropping screenshots. Reader maintenance remains explicit and initially visible for restored citations.

Actual checks: backend 1224 passed / 1 opt-in native skip / 2 existing dependency warnings; frontend 292 passed across 48 files, types, lint (7 existing warnings), production build; all-repository mypy 205 files, Ruff and diff checks pass. V1 backend line/branch coverage 81.28%/68.79%; frontend 83.33%/68.17%, with all production files included in denominators.

Real local: final fresh native DB/API/worker + Firefox flow passed authentication, upload/extraction/hash, search, note/selection persistence, API restart, reparse/new-version/historical-reference navigation, export/restore/revalidation, backup keyboard toggle and responsive layout. Exact viewport checks: desktop document/body/viewport 1000/1000/1000, tablet 900/900/900, phone 844/844/844; phone workbench header 242 px. Desktop/phone/tablet/dark screenshots were inspected locally. Browser evidence: `evidence/continuation-2026-10-21/frontend/browser/`.

Real recovery: isolated reparse and revalidation SIGKILL cases passed with the same durable job/extraction, two attempts, preserved old evidence and idempotent resubmission (93.32 s and 94.77 s). Normal status polling triggers recovery; this is not a browser-crash/host-reboot/Google recovery claim.

Simulated: SDK health/profile/schema failures and actual SDK RateLimitError are tested with injected clients. Quota failure does not revoke authenticated listing; historical verification does not override current connection failure. Four synthetic launcher tests verify dotenv isolation. No real Google account, model inference, generated audio, private credentials or protected public HTTPS was configured.

Remaining blockers: runtime credentials and protected ingress need targeted approval; actual application-runtime Google login needs authorization; strict Google session isolation remains unsupported by pinned SDK 0.8.5 and is not solved by login alone. Actual independent model/audio acceptance remains unverified. Next executable step after appropriate authorization is private runtime provisioning and read-only Google verification; never bypass strict isolation or enable fake production output. Ordinary future defects remain in the authorized autonomous development scope.
