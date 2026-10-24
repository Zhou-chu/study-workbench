# StudyWorkbench V1 progress

## 最新源码审查与分批计划：2026-10-24

[架构与 code smell 审查](ARCHITECTURE_REVIEW_2026-10-24.md) 基于 `e8c5c572` / tree `07eaf90`：保留模块化单体，优先修异常边界、任务 ACK 竞争、Web 宽松响应读取和安全开发入口，不做重写或全仓搬迁。
[可执行修复计划](../superpowers/plans/2026-10-24-architecture-boundary-repair.md) 已完成文档自审，安排四个独立回归/提交批次；Ask/Outline fresh-key 重复风险、提供方错误分类器及测试替身契约等仍明确在后续清单。
本检查点**仅源码审查与文档**，未运行测试、构建、数据库、浏览器或提供方；旧通过数不是本轮证据。应用修复、独立审查及远端发布分别记录，不代表 main 合并、部署或数据备份。下方仍为历史检查点。

## 最新离线加固增量：2026-10-23

[保留输入与证据读取加固](VERIFIED_HARDENING_2026-10-23.md)：本地受测 `90bcf371`，后端 **2443 通过 / 128 跳过 / 2 警告**，聚焦 **188 通过**；308 文件静态检查与 OpenAPI 通过。
对应源码已核验发布到私有分支 [`0c428117`](https://github.com/Zhou-chu/study-workbench/commit/0c4281177d260d696adab17e874f8e89b31934ee)，不代表主分支或部署。
包含详情读取批处理、存储证据身份/归属检查及同步处理异常后的保留保护；模拟查询次数下降不等于真实数据库延迟改善。
前端未变，本轮未重跑前端或浏览器；netlink 准备 **BLOCKED** 与其他运行边界不变。下方检查点保留为历史。

## 最新恢复检查点：2026-10-23

[恢复后的验证检查点](RECOVERED_CHECKPOINT_2026-10-23.md) 记录从 `4d2b3e42` 重建后的五次私有源码发布，最新为 `680d2eb8`。
新鲜后端 **2325 通过 / 128 跳过 / 2 条警告**；未改变的前端 **1354 + 25 测试通过**，独立离线 LSN97G 构建与关联通过。
实际浏览器尝试在网络命名空间 loopback 准备时 **BLOCKED**，应用服务和浏览器均未启动，不是页面 PASS/FAIL。
旧工作区及旧验收不可替代新证据；主分支、部署、提供方、Harmony、Docker 运行与用户数据恢复边界未解除。
以下原有章节保留为历史，不代表恢复后的最新验收。

## Current priority: repository remediation, 2026-10-22

The owner requested risk/error repairs before completing feature gaps. See [the repository audit](REPOSITORY_AUDIT_2026-10-22.md) and [the revised gap plan](GAP_CLOSURE_PLAN.md). Changes are integrated separately from the running preview; this is not a deployment announcement.

First remediation checkpoint: **1965 backend tests passed / 60 opt-in skips / 2 existing dependency warnings**, plus **14 separately executed disposable SurrealDB tests**; **1207 frontend tests across 78 files**, frontend types/build and lint (0 errors / 7 existing warnings) passed. Full Python Ruff/format/mypy passed for 268 files. [Machine-readable evidence](evidence/repository-audit-2026-10-22/summary.json) identifies the verified code and exclusions. The remaining 46 opt-in skips are not passed gates. Default Compose now has no services and inherited unsafe operations fail closed; actual Docker acceptance remains pending.

The latest preview checkpoint is the owner-approved **fresh empty** 2026-10-22 instance with public-fixture authentication/worker/original-byte checks. User-data restoration, user browser login, live web discovery, actual model/Google calls, Docker runtime and native clients are not inferred. Earlier sections are historical, not the current release gate result.

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

## 2026-10-21 backup transport checkpoint (d)

This iteration closes a concrete data-portability defect: a successful export could exceed its own restore metadata limit or the HTTP/frontend transport limits. The shared contract now checks ZIP wire bytes, all expanded members including the manifest, per-entity metadata, manifest size and entry count. Export fails durably without publishing a download when the contract is exceeded. The restore dialog obtains fresh authenticated limits, disables confirmation while they are unavailable/stale, supports explicit retry and rejects oversized files before upload.

The generic Next.js rewrite was actually reproduced truncating a valid 108 MiB ZIP at 100 MiB and returning 500. A dedicated streaming App Route forwards only the required headers and original body to the configured backend, preserving origin rejection, authentication challenges, no-store and nosniff; the global 100 MiB clone setting is unchanged. Only the authenticated portable POST receives its archive budget plus bounded multipart overhead; other upload limits remain unchanged. Portable form parsing accepts exactly one named file and no fields, closes temporary spools, and rejects other content types before consuming their body.

Evidence and final integrated verification are recorded under `evidence/continuation-2026-10-21d/`. The large payload is public synthetic saved audio, not generated audio or user data. The native checks use disposable databases and loopback services; private runtime credentials and data are not touched.

Archive directory preflight bounds the actual entry count before Python constructs ZIP member objects, including forged low declared counts and ZIP64 cases. Its use of private stdlib EOCD parsing is isolated and compatibility-tested. This does not promise constant memory: permitted large comments/extra metadata and JSON parsing still consume resources.

External capability gates are unchanged: the current app host has no verified stable protected ingress or approved visible Google-login path. SDK 0.8.5 still does not provide proven non-destructive fresh conversation isolation; no cookie transfer, destructive history clearing or fake success was substituted. The user has been asked whether to use an existing Linux host or compare hosting options. No Google access, paid resources, network/security setting changes or new credentials were performed.

Final integrated verification: **1341 backend tests passed, 1 opt-in skip, 2 existing dependency warnings**; **328 frontend tests passed across 50 files**; mypy **213 source files passed**; Ruff check/format, frontend types/lint and production build passed. Existing frontend lint warnings remain unchanged. Coverage percentages were not rerun for this checkpoint; prior measured coverage is historical, not relabeled.

Final real acceptance: a **113,257,860-byte** synthetic ZIP imported through production Next.js; a genuine worker exported **113,258,240 bytes**; real Firefox selected that export, fetched limits and confirmed restoration into a fresh database/filesystem. All 21 manifest members and the **113,246,252-byte** saved WAV matched their hashes. Both imports returned 201, malicious cross-origin requests with valid auth returned 403, and direct headers-only anonymous/oversize probes retained 401/413. Final dialog screenshots were inspected after animations settled. This proves the >100 MiB regression, not an executed 1 GiB maximum or general host-memory guarantee.

## 2026-10-21 product experience and recovery checkpoint (e)

User-directed focus: add a product-manager perspective red team for actual operation and approachability, not cosmetic polish or unit-test totals alone. The [Chinese expert-walkthrough report](UX_RED_TEAM_2026-10-21.md) distinguishes real fixture actions, expert interpretation, controlled fault injection and untested user-study/accessibility claims. The initial Chinese desktop/mobile walkthrough actually created a notebook, uploaded/read public Markdown without a model, saved a note, downloaded an export and restored it into a new notebook.

Implemented: direct study-workspace links from notebook cards/rows; local-first empty guidance with a keyboard-focusable upload next step; explicit reading-versus-selected-question-scope explanation; accurate mobile “reading and questions” tab; optional Google controls behind a native disclosure with truthful loading/error/known-state labels. Existing linked or selected remote context is not mislabeled as an empty project, and no source scope or engine is changed implicitly. Friendly task operation names replace raw codes in the primary presentation; diagnostic identities remain accessible and remote uncertainty warnings stay visible.

Recovery: uncertain upload responses retain the original File, source/notebook target and idempotency key for explicit retry in the mounted workspace. In-flight duplicate retries are blocked; dismissing a notice never claims to cancel server work. The browser does not persist these file handles or claim recovery after reload. Initial document/PDF failures can retry in place without resetting parent drafts or historical identity/page. Stale downloads and a transition to unmapped remote citations cannot contaminate the new reader context. Model defaults loading/error/stale-error fail closed; manual configuration retry never submits a question and a configured model is not claimed to have passed inference.

Product follow-up still open: the export initiation location should guide users more directly to the completed download, especially on mobile. This is documented as a remaining P2 usability issue, not silently marked fixed. No Google login, inference, paid resource, private runtime access or external deployment was performed.

Final integrated automated gates: **1341 backend tests passed, 1 opt-in skip, 2 existing warnings**; **381 frontend tests passed across 53 files**; mypy **214 source files passed**; Ruff, frontend types/lint/build passed with 7 existing frontend warnings. The final full frontend run used two workers after the initial parallel locale-source scan timed out; no timeout or assertion was relaxed. Prior coverage percentages remain historical and were not relabeled.

Final production-build Firefox/native acceptance passed seven scenarios: direct list-to-study entry; mobile local-first CTA and optional-Google keyboard disclosure without upload/scope mutation; real committed upload whose browser response was deliberately aborted, followed by same-key/file retry resulting in exactly **one source and one version**; reader 503 followed by keyboard retry preserving both unsaved note and unsent question; real unconfigured model defaults plus controlled error/loading and manual retry without any question submission; friendly local-task label with keyboard-accessible diagnostics. All three 390×844 panels matched viewport width/height, page errors were zero, and no blocked external/question request was observed. Faults were browser-controlled, not real-service incidents or real-user research. Services were stopped after the run; screenshots were inspected locally and are omitted from the private GitHub snapshot.

## 2026-10-21 export delivery follow-up (checkpoint f)

Closed the remaining PM workflow gap in implementation: the same project-backup disclosure now shows preparation, terminal status, explicit status-refresh recovery and the download action. It tracks only the export initiated in that mounted workspace; history remains available in Notes & artifacts after leaving/reloading. The download uses the authenticated existing endpoint and a readable `study-workbench-project.zip` filename. Successful server generation is never labeled as a saved device file; browser handoff asks users to confirm their Downloads.

A failed status read pauses this disclosure's polling until explicit refresh; a failed download retries the same artifact rather than submitting another export. An in-flight export or unreadable job status blocks another export. A request-level failure without a job identity is described as unconfirmed, with a history-check instruction, not falsely labeled a confirmed server failure. Notebook-keyed state prevents late requests/download feedback from crossing projects. No backend production code or remote capability changed.

Final f verification: **390 frontend tests / 53 files passed**, types/lint/production build passed (7 unchanged lint warnings), mypy **215 files**, Ruff passed. Backend production code did not change; the focused portable/body/directory contracts were rerun (**101 passed, 1 opt-in skip**). The full 1341-test backend result belongs to checkpoint e, not a new f full-suite run.

Actual Chinese Firefox at 390×844 passed genuine queued export (worker deliberately started later), controlled status-read failure and explicit refresh, genuine worker completion, controlled first-download failure and keyboard download retry in the same disclosure without visiting Notes. Exactly **one export POST and one backend export job**, two requests to the same download artifact; the saved test ZIP's v1 manifest hashes, original bytes and note content were verified. Page errors and blocked requests were empty. The UI truthfully distinguishes prepared, download-in-progress and browser handoff, not proof of a user-device saved file. All services stopped after verification.

## 2026-10-21 gap-closure planning checkpoint

The user-requested [gap-closure plan](GAP_CLOSURE_PLAN.md) prioritizes the current dot cloud computer as the full-stack single-user test server, with an owner-private Sites ingress through supported private connectivity. Tunnel registration for this exact runtime remains an unresolved setup gate; no deployment or new credentials were created. The plan separates real independent-model evaluation, application Google login, remote migration/audio, strict-history isolation, and V1.1 deep-reading scope. This is documentation only, not additional runtime acceptance.

## 2026-10-21 offline model acceptance checkpoint (g)

Implemented the offline portion of gap-plan Tasks 0/2: a fixed CC0 synthetic corpus with 30 questions (12 single-source, 6 multi-source, 6 insufficient-evidence, 6 scope/injection), exact expected evidence, and a simulation-only acceptance runner. Its default is non-executing; the CLI validates fixtures without credentials or network and explicitly rejects live mode. Integer call/reservation gates include primers and failures, stop on errors or malformed turns, and never claim actual provider cost bounds. Semantic review remains pending even when structural citations validate.

Tests include the real GroundedChatService with memory storage, actual local extraction and an injected fake model; all four changed-scope cases keep old questions/evidence out of the new scope. This is not real inference. See [live acceptance specification](LIVE_ACCEPTANCE_SPEC.md). Real provider binding, retry/cost enforcement, account authorization, PDF/scanned-document evaluation and human semantic scoring remain open.

Independent review passed the focused 28-test set. Final full backend: **1359 passed, 1 opt-in skip, 2 existing warnings**; mypy **217 source files**, Ruff check/format passed. Evidence is recorded under `evidence/continuation-2026-10-21g/backend/`; no frontend production code changed, so prior frontend counts remain historical rather than a new run. No services, Google session, model credentials, paid resources or public listener were started in this checkpoint.

The new Docker and Android/HarmonyOS 6/iPadOS scope is at architecture planning: the current Docker/Compose definitions are not yet a verified StudyWorkbench deployment; per-platform client branches have not been created. Sites can bind private HTTP tunnels, but the current surface still lacks a discovered supported registration procedure for this exact dot cloud. Neither a private URL nor completed clients are claimed.

## 2026-10-21 multi-client architecture proposal

The user selected native-oriented clients: shared React Native Android/iPadOS core and an ArkTS/ArkUI HarmonyOS 6 client, retaining Web. The [written architecture and phased branch roadmap](MULTICLIENT_ARCHITECTURE.md) is ready for review before detailed implementation planning and branch creation. It includes four-service Docker migration, revocable device sessions, shared contracts, protected local draft recovery, canonical private Git baseline normalization and distinct build/simulator/device/signed-package evidence. Sites native access and dot tunnel registration are explicit separate feasibility gates. This is documentation only; existing runtime acceptance remains checkpoint g.

## 2026-10-21 multi-client construction foundations

The architecture is approved; the user explicitly requested self-reviewed plans followed by direct execution, without another review pause. The canonical private Git baseline is normalized and isolated branches now contain real work. See [implementation plan](MULTICLIENT_IMPLEMENTATION_PLAN.md), [baseline audit](MULTICLIENT_BASELINE.md), and [current multiclient acceptance](MULTICLIENT_ACCEPTANCE.md).

Reviewed local foundation batches: actual API schema snapshot/drift guard (including isolated dotenv regression), static four-service deployment (including public-Origin import regression), and offline exact-tree publication helper (including no implicit Git fetch and shallow-parent metadata regressions). No deployed containers or native clients are claimed. Conditional note revisions must cover legacy/domain writers, deletes and archives, not only personal PATCH; that implementation continues separately.

Final integrated foundation regression: **1473 backend tests passed, 1 opt-in skipped, 2 existing deprecation warnings**. Canonical frontend baseline remains **390 tests**, typecheck, lint (7 existing warnings) and production build passed; no frontend production code changed in these foundation batches. No live model calls are claimed. Reviewed API and Docker feature branches are published with exact-tree verification; this is progress delivery, not completed container/native/Sites acceptance.

## 2026-10-21 atomic note backend

Backend revisions, legacy/domain writer closure, coherent note/snapshot transactions, deletion-race guards and portable revision preservation are implemented and independently reviewed. Two compatibility defects found by review were fixed before integration. Combined backend: 1499 passed, 19 gated skips; 77 native database note/portable checks passed separately. Default remains legacy_single_web. Both Web editors' conflict handling and device sessions are still in progress.
