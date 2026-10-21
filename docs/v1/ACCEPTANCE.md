# V1 acceptance matrix

Original checkpoint: 2026-10-18 UTC. Continuation: 2026-10-21 UTC. Environment: requested dot cloud Linux workspace, native SurrealDB 2.3.10, Python 3.12.14, Node 24.19.0. Baseline and versions: `UPSTREAM.md`. This is a development delivery, **not all acceptance criteria passed**.

Definitions: **Real local** uses actual CPU/filesystem/HTTP/DB/browser operations with public fixtures. **Simulated** uses injected store/provider/Google doubles. **Partial** has a useful implemented/tested subset but a missing required gate. **Blocked** names a permission, runtime or SDK blocker. No real Google operation or model inference was performed.

| ID | Status | Evidence and remaining boundary |
|---|---|---|
| A01 Private page | Real local browser | Anonymous workbench navigation redirects to login; actual Firefox password form login succeeds against the real private API. Public deployment remains A22 |
| A02 API/files | Real local + simulated adversarial | Native unauthenticated source-original/job/export HTTP requests return 401; dedicated password-enabled tests cover missing password503, legacy data routes, cross-origin mutation and path escape |
| A03 No-model upload | Real local | Native API/worker parsed Chinese PDF3+4 pages, Markdown and TXT, downloaded identical original bytes, idempotent upload retained IDs. No model configured |
| A04 Parse degradation | Real local + parser tests | Image-only PDF is needs_ocr with warnings/no fabricated evidence; malformed PDF failed; partial-page and limits covered by actual CPU parser fixtures |
| A05 Exact location | Real local browser + parser | Ten known citations across two PDFs open the exact immutable version, quote and physical page with nonblank PDF.js canvas; manual page change and restored page 3 also checked. Unicode offsets are exact; text-fragment highlight is validated. Exact PDF bbox highlighting is unavailable and explicitly labeled |
| A06 Stable versions | Real local parser + service tests | New versions and forced extraction retain historical evidence; historical reader API selects citation extraction. 2026-10-20 real Firefox reparse and newer-version upload retain the old citation on physical page 3 |
| A07 Selection | Real local + simulated turn scope | Actual browser refresh preserves selection and note; native API restart preserves persisted selection. Immutable per-turn source scope is separately tested with fake models |
| A08 Scope switch | Simulated + honest blocked Google | Fake independent A→B/no-evidence case isolates prior facts. Production NotebookLM strict ask rejects unsupported fresh-context isolation; no real answer/follow-up test |
| A09 Google login | Blocked | Application-runtime credential/profile authorization not completed; no real network authentication/read-only verification. Existing assistant connection is not used |
| A10 Remote inventory/import | Partial, simulated | Adapter pagination/import reports and missing-original states tested with fake. SDK notebook inventory may be recent-only, explicitly listing_complete=false. No live complete inventory claim |
| A11 Create/sync | Simulated, live blocked | Durable returned IDs, exact version mapping, explicit confirmation, ambiguous-response guards tested. No Google create/upload authorized or performed |
| A12 Real NotebookLM Q&A | Blocked | No authorized account session; SDK0.8.5 defaults can continue server history, so production strict-scope guard prevents ask. Connector implementation is not a live ask capability pass |
| A13 Honest remote refs | Simulated | Same-name/ambiguous/unmapped refs retain remote title/quote/reference but no invented local page or green verification; explicit source association required |
| A14 Independent engine | Partial | Actual scoped lexical retrieval with20 Chinese gold questions passes; fake model protocol and citation tests pass. No real configured model or gold answer-quality verification |
| A15 Failure/injection | Simulated + real no-model state | Missing-model, timeout/context bounds, forged citations and untrusted source instruction data tested. Answer pipeline has no tool side-effect interface. Real provider timeout unverified |
| A16 Notes/outline | Partial | Native note save and restart verified; bounded outline mode uses per-source sampling with coverage warning in fake tests. Actual browser note save/refresh and ZIP round-trip passed; real model outline generation unverified |
| A17 Audio generation/import | Real local saved-asset playback; remote generation blocked | Submission ID, polling, cancel/unknown, existing artifact import/download contract tested with fake. Saved-audio import/playback/download/reload/fresh restore passed on 2026-10-21; real generation remains unverified, and importing a synthetic example cannot prove generation |
| A18 Idempotency | Real local upload + simulated Google failures | Native duplicate upload; fake double-click/retry/lost response/worker restart cases, account-call serialization and durable remote-ID commit tests. No actual Google-side fault injection |
| A19 Recovery/concurrency | Simulated + native worker | Short polling commands and original task IDs; submission_unknown no replay; local cancellation preserves remote uncertainty. Fake long audio does not block unrelated reads. Live Google quota/recovery unverified |
| A20 Fresh restore | Real local + adversarial tests | Actual two fresh SurrealDB databases, separate files/SQLite, source data removed before restore; original hashes, remapped IDs, evidence/notes/turn/history restored and re-exported; forced transaction error rolls back. Imported verification badges intentionally downgraded to unverified archive references; 2026-10-20 local historical revalidation HTTP/UI now implemented using independent retained-original parsing; supplied archive revalidation reports are stripped. Real Firefox restore first keeps ten historical references unverified, then fresh-original revalidation checks/verifies three evidence records and preserves historical page 3 through navigation/reload; note edits/search/model finalization alone cannot establish archive trust |
| A21 Export/security | Real ZIP/native + adversarial tests | Closed snapshot graph, hashes, missing-content manifest, secret exclusion, path/symlink/bomb/MIME/type/quote/page forgery checks. Hashes establish consistency, not trusted authorship. Original referenced content remains readable |
| A22 External access/lifecycle | Blocked / partial local persistence | No protected externally accessible HTTPS URL established. Actual API restart persistence passed; per-command namespaces documented. Workspace deletion/rebuild guarantees unknown |
| A23 Reproducible code | Real local, production launch gated | Fixed baseline, lockfiles, no-secret example config, native scripts, docs and public project ZIP included. Source ZIP and Git bundle contain the exact final commit; archive hashes are in the accompanying delivery manifest. Production launch needs approved secrets and target ingress |
| A24 Honest report | Complete for current evidence | This matrix separates real local, fake and unverified; machine-readable tests and human logs retained. No account access, generation or external deployment inferred from unit tests |

## 2026-10-18 checkpoint reproduction and evidence

- Upstream baseline: `evidence/upstream-pytest-baseline.txt` (1000 tests)
- Final Python/JUnit: `evidence/python-tests.txt`, `evidence/python-tests.xml`: 1182 passed, 1 opt-in skip, 2 existing dependency warnings
- Coverage: `COVERAGE.md` and `evidence/coverage/` preserve baseline/final counts and explicit denominators; browser/native integration is not merged into pytest/Vitest coverage
- Final frontend: 266 tests; JSON/text, TypeScript, lint and production build evidence in `evidence/frontend-*` (7 unchanged upstream lint warnings)
- Real local HTTP: `UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/local_check.py`; `evidence/native-core-integration.txt` and `evidence/browser/api-results.json`
- Actual browser: `scripts/v1/local_check.py --browser`; Firefox documented in RUNBOOK. Final `evidence/browser/browser-results.json` records ten citations, raster pixels and 390px layout dimensions; numbered screenshots include Chinese desktop/mobile
- Native restore: `evidence/portable-native-restore.txt`: 39 passed; normal portable suite: `evidence/portable-unit-tests.txt`: 38 passed, 1 opt-in skip
- SDK fake contracts: `evidence/notebooklm-focused-tests.log`; exact boundaries in `NOTEBOOKLM_SDK.md`
- CPU parsing/scoped fake-model evidence: `evidence/evidence-local-tests.txt`, final Python run includes trailing-newline regression fixes
- Public example: `examples/public-fixture-project.zip`, manifest and hashes inside; safe public content only, restored jobs never replay

The single default-suite skip is the opt-in real SurrealDB restore test. It is separately executed and passed in the native restore log, not silently counted as a regular unit pass. Existing upstream deprecation/lint warnings are retained rather than reported as new product defects.

## Required next acceptance work

Obtain approved private runtime secrets and protected ingress; perform authorized application-runtime Google login/read-only check; resolve strict-history SDK isolation; explicitly authorize live remote create/sync/audio checks; optionally configure an existing independent model and verify gold answers. Historical version/reparse/index-rebuild behavior is verified with parser/service/component tests; the 2026-10-20 live-browser reparse/revalidation sequence passed; local API/worker process-kill maintenance recovery additionally passed on 2026-10-21 (details below). No external HTTPS, real Google/model or real audio pass is inferred from the local results.

## 2026-10-20 continuation checkpoint

- A06/A19: local durable reparse/revalidation and same-job polling-driven recovery are implemented with locked dispatch/execution and restored-job replay guards. Failed/restarted reparse preserves the prior ready extraction. The composer exits pending state for matching cancelled/failed/unknown jobs even when no turn exists.
- A08/A12: capability is checked again inside the remote call lock and in the composer. Published SDK strict-context isolation remains unsupported; no real Google Q&A pass is claimed.
- A20 local restore/revalidation gate is **passed**: independent retained-original comparison can validate exact historical references without changing IDs/locators. Imported reports are discarded, and reader updates preserve explicit invalid/out-of-scope citation status. Real Firefox/native DB/API/worker checks passed: UI reparse, newer-version upload, old page 3 preserved, ten restored references initially unverified, fresh-original comparison with 3 checked / 3 verified, and navigation during another job followed by stable reload.
- Frontend: **289/289 tests, 48 files**, TypeScript and production build passed; lint has 7 unchanged warnings. Backend: **1211 passed, 1 opt-in skip**; coverage rerun is tracked separately. Current local browser evidence: `evidence/continuation-2026-10-20/browser/browser-results.json` and screenshots. These results do not establish real model, Google, protected HTTPS, or actual process-kill maintenance recovery.

The earlier dated results above remain historical evidence; current continuation results are separately identified rather than relabeling old runs.

2026-10-20 最终补充：独立 loopback 原生 SurrealDB 恢复套件 40 passed（包含完整套件默认跳过的原生恢复用例）；全部 Python Ruff check/format 和 mypy 102 个源文件通过。证据 `evidence/continuation-2026-10-20/backend/`。

## 2026-10-21 next-stage checkpoint

This section supersedes the earlier unverified *local worker process-kill* limitation only. Other Google/model/HTTPS gates remain unchanged.

- A19 real local worker interruption: both reparse and revalidation passed actual SIGKILL plus normal API polling/restart, preserving job/extraction IDs and old readable evidence, exactly two attempts, and idempotent resubmission. Natural recovery measured 93.32 seconds and 94.77 seconds. Evidence: `evidence/continuation-2026-10-21/crash-recovery-isolated/results.json`. The parser was paused at a deterministic test boundary; production recovery logic/deadlines were not changed. No browser crash, host reboot, database corruption or Google recovery is inferred.
- A09/A12 connection truth: SDK tests now invalidate stale availability after connection/profile/schema failures. The actual SDK rate-limit exception preserves authenticated read-only operations. These are injected SDK tests, not a real Google check; safe fresh-history isolation still blocks ask.
- A23 configuration: synthetic regression tests prove isolated test children do not implicitly reload repository dotenv, and the native launcher honors the explicitly loaded config. No real credentials were read or provisioned.
- Backend final integrated suite: 1224 passed, 1 opt-in native skip, 2 existing dependency warnings. Full-repository mypy: 205 files passed; Ruff check and format passed. The default-suite skip is not counted as a current native full-suite pass.

- A03/A05/A06/A07/A20 final real Firefox/native flow passed again on fresh fixtures after the layout changes, including reference maintenance and ZIP restoration. A01 responsive viewport checks pass at 1440, 1024 and 390 pixels; no vertical document overflow is hidden by screenshot cropping. Backup disclosure keyboard open/close and mobile tab controls were exercised. Light/dark/tablet/phone images inspected locally. Frontend 292/292 tests, types/build and lint passed (7 existing lint warnings).

## 2026-10-21 reliability follow-up (checkpoint b)

- A09/A12 remain blocked. No credential/login/model permission or strict-context capability is inferred from private source publication.
- A16 race regressions (mocked async responses): save → New/Edit/outline and outline request → New/Edit/title/content typing preserve newer editor identity/content. Generated outline remains accessible in history instead of overwriting the draft.
- A18/A19 cancellation regressions: queued calls invoke no provider; running local cancellation invokes at most the original call, preserves IDs/uncertainty and remains cancelled after late success/failure. SSE ends even if a running or late historical turn exists. Queued export cancellation prevents archive work. Unsupported running CPU cancellation returns an explicit error and is not advertised by the UI. These are injected/local service tests, not Google cancellation verification.
- A17/A20 real saved audio: the final production build played a 64,044-byte public synthetic WAV four times across original/restored fresh environments and reloads; decoding, duration, time progression and end succeeded. All downloads matched SHA-256 `902c947de824dbb2997d88492321ae54bb3d38b6bd86c99c53e6dab3b70bf58b`; anonymous downloads returned 401. Genuine worker export was restored into a second independent DB/filesystem, with remapped artifact IDs and no replay. Evidence: `evidence/continuation-2026-10-21b/audio/audio-results.json`. No remote generation, model synthesis or audible speaker-output quality claimed.
- A23 offline private snapshot exporter: 40 tests cover path/output safety, tracked-byte/mode parity, exclusions and incremental deletions. Final integrated suites: backend 1281 passed/1 opt-in skip; frontend 313 passed; mypy 209 files; static checks/build passed.
