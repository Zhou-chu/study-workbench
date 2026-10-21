# StudyWorkbench V1 progress

Original checkpoint: 2026-10-18 UTC. Continuation updated: 2026-10-21 UTC. Branch: `feature/study-workbench-v1`. Baseline: Open Notebook 1.15.0 at `a0f6f3081ae06328f0a451b3a3ef2959ca25721d`. Exact handoff commit and archive hashes are recorded in the accompanying delivery manifest; use `git rev-parse HEAD` in the Git bundle checkout.

This is a reproducible development delivery with a working local document workflow, **not a fully accepted personal NotebookLM deployment**. No real Google login, model call, NotebookLM write or paid resource was used. Dedicated private runtime credentials were authorized and provisioned on 2026-10-21; values remain outside source. Protected external access remains pending.

| Stage | Result at handoff |
|---|---|
| T00 | Complete: upstream pinned, environment evidence, 1000-test upstream baseline, official registry and native SurrealDB provenance |
| T01 | Native SurrealDB/API/worker and migration 26 integrated; default-on fail-closed private access verified. Authorized private credentials and protected loopback startup verified; external HTTPS pending |
| T02 | Immutable originals/versions and CPU PDF/MD/TXT evidence implemented; real upload, worker parse, exact download and restart verified |
| T03 | Three-panel workbench, persistent source choices and PDF.js reader implemented. Real Firefox login, desktop and Chinese 390px mobile checks passed; mobile drawer and no-overflow assertions included |
| T04 | Scoped lexical retrieval implemented; 20 Chinese retrieval gold cases and exact locator tests pass without a model |
| T05 | Independent grounded answer and bounded-outline contracts implemented with immutable turn scopes, citations and actual retrieval coverage. Fake-model tests pass; actual model unconfigured |
| T06 | Pinned notebooklm-py adapter and auth state machine implemented with injected-fake tests. Real runtime Google login/read-only verification pending |
| T07 | Import/link/create/sync IDs, idempotency and unknown-outcome recovery implemented with fake tests. SDK inventory is explicitly recent-only/incomplete; live Google operations unverified |
| T08 | Turn persistence/reference resolution implemented; published SDK 0.8.5 cannot provide proven non-destructive fresh context. Strict NotebookLM ask fails closed; core live Q&A remains incomplete |
| T09 | Notes save/edit/history/export and actual UI save/refresh verified. Bounded outline and audio state machines tested with fakes; real outline/audio generation pending; saved-audio playback/restore verified in the 2026-10-21 follow-up |
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

1. Completed 2026-10-21: authorized private application/encryption/database credentials provisioned outside source/export; do not copy them into GitHub or portable project archives
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

## 2026-10-21 reliability follow-up — tested private-repository sync

Current phase: note-editor safety, honest cancellation, saved-audio acceptance and repeatable private publication. The published private repository is `Zhou-chu/study-workbench`; its `main` contains a filtered snapshot whose manifest records the development commit. The initial published snapshot was `f0610e975a5dc86cc5ab44dee88853f8bae38596`; the next published commit is recorded by GitHub after this source checkpoint is committed.

Completed fixes: late saves cannot retarget a newer New/Edit/outline draft. Outline submission captures editor session and text revision before either asynchronous phase; newer typing is preserved and skipped outlines remain in history. Running chat cancellation ends local waiting and SSE while explicitly allowing remote continuation; late success/failure cannot resurrect the job or repeat a provider call. Queued exports re-read cancellation under the project lock; running CPU jobs reject unsupported cancellation instead of silently succeeding.

Real saved-audio acceptance: deterministic synthetic 2-second WAV imported through authenticated production HTTP, played and downloaded, exported by a real worker, and restored into a second fresh database/filesystem. Four actual Firefox playbacks decode/progress/end including reloads; both API/browser downloads match 64,044 bytes and the same SHA-256, anonymous downloads return 401, artifact IDs remap and historical replay remains disabled. Final run used the final production frontend rebuild. This verifies stored media, not Google/model generation or audible speaker output.

Final integrated validation: **1281 backend tests passed, 1 opt-in native skipped, 2 existing dependency warnings**; **313 frontend tests passed across 49 files**. Full mypy **209 files passed**, Ruff check/format passed, frontend types/lint/build passed (7 existing lint warnings). V1 line/branch coverage: backend **81.72%/69.77%**, frontend **85.41%/73.89%**. Independent review resolved the outline data-loss and exporter runtime-path findings. Evidence is under `evidence/continuation-2026-10-21b/`.

Offline publication helper: `scripts/v1/prepare_private_snapshot.py` verifies tracked commit bytes/modes, rejects unsafe archive/output shapes, excludes runtime/credential paths and upstream workflows, writes deterministic inventory and full-tree SHA, and calculates incremental changes against the previous published inventory. It never authenticates or pushes; publication still verifies the private destination, branch lease and complete tree. Path filtering is not a guarantee that tracked content contains no secrets.

Remaining gates are unchanged: private runtime credential provisioning has been requested but not approved; no real app Google login, safe strict Google history isolation, real model/audio generation or protected external HTTPS has passed. Next external-capability step is approved private credential provisioning and application-runtime login, not bypassing scope isolation. No credentials, public listeners, paid resources or automated remote generation were added in this iteration.

## 2026-10-21 private runtime checkpoint (c)

Credential-generation gate is complete: three independent high-entropy credentials are stored in an owner-only configuration outside source (directory 0700, file 0600), never printed or published. No previous secrets were overwritten and no Google profile was created.

Launcher hardening: explicit config only for credentials; ambient provider keys, secret-file overrides, proxies and interpreter injection are not inherited; dotenv interpolation is disabled; Loguru diagnostic frame values are disabled; config/log ownership and modes are checked. HTTP services must become ready, worker startup is honestly distinguished from completed work, listener addresses remain loopback, and owned process groups are stopped. Empty optional config values fall back safely, while required empty credentials fail closed and source-root/ancestor runtime paths are rejected.

Actual final-code verification passed: missing/wrong password 401 and configured password 200 through both direct API and frontend proxy; database anonymous read rejected/authenticated read accepted; genuine public-fixture worker parsing; full restart retained original bytes; encryption round trip succeeded; all three listeners were 127.0.0.1 and disappeared after shutdown. Services were stopped intentionally after verification; private configuration/data and one synthetic verification workspace remain. Only a sanitized status JSON is included in source evidence.

Full backend **1295 passed, 1 opt-in skip, 2 existing warnings**; mypy **209 files passed**, Ruff check/format passed; frontend rebuilt with explicit IPv4 API rewrite. Frontend application code is unchanged from the 313-test checkpoint. Evidence: `evidence/continuation-2026-10-21c/`.

Next live-capability gates: protected external HTTPS/runtime lifecycle and separately authorized application-runtime Google login. Google strict-history isolation remains unsupported; real model and remote audio generation remain unverified. Provisioning these local secrets does not authorize Google access, public ingress or paid services.
