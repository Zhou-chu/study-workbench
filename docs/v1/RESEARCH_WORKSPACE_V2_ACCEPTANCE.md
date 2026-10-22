# Research workspace v2 — acceptance record

Date: 2026-10-22 UTC.

**Current preview status: the owner approved a fresh empty instance on 2026-10-22; its direct/proxy authentication, public-fixture worker extraction and original-byte checks passed (see the fresh-preview checkpoint below). This is not recovery of old user data. User browser login and live web discovery remain unverified. Subsequent repository-audit fixes are isolated and are not automatically deployed to this preview. Earlier recovery/build/browser entries remain historical evidence.**

## Intended user workflow

1. Open a notebook in the study workspace. Ordinary work centers on materials, questions, reading, notes and results; configuration belongs in Settings.
2. Discover web material by submitting an explicit search, reviewing result snippets and selecting pages to import. A search snippet is not imported evidence. A successful scrape retains a Markdown snapshot with attribution, not the original HTML page.
3. Add a saved note revision or completed answer/outline to the same notebook's materials. Unsaved edits are not silently saved or substituted. The new material is an immutable snapshot, not a live link to the editor.
4. Newly imported/promoted material appears after workspace refetch but is not automatically selected for questions.
5. Derived material remains labeled in reading and grounded-answer evidence. It must not count as independent corroboration of its own cited inputs.

## Configuration and privacy boundaries

- Search/import use the configured Firecrawl service. The Settings status distinguishes missing configuration from configured credentials; configured does not mean credentials, quota or service availability have been tested.
- The default mode uses `FIRECRAWL_API_KEY` from the server's environment. Do not place a secret in Git, browser bundles, documentation or a client-visible response. No credentials or paid access were configured in this iteration.
- The user approved testing the explicitly opt-in `STUDY_WORKBENCH_WEB_SEARCH_MODE=keyless_trial` mode. It omits Authorization even with an ambient key, never changes to paid mode, and stops on provider limits. Official current documentation describes daily per-IP request and credit caps without numerical allowances; shared egress can exhaust the trial. The Settings/discovery UI labels this limitation. Operator activation and live results are separate acceptance steps below.
- Search sends the submitted query. Import sends the selected public URL. Notebook text is not included in discovery requests, and typing does not submit a search.
- The application server calls only the fixed provider API, not arbitrary result URLs. No environment proxy, redirect following, TLS bypass, stealth browser, site-login cookie or automatic paid retry is enabled.
- Local note/result promotion does not call a model or request embeddings. It provides local lexical evidence; generating a new answer still depends on the configured answering engine.
- New local material is not automatically uploaded to Google NotebookLM. Existing engine/scope guards continue to apply.

## Exact new browser/API surface

- `GET /api/personal/web-search/status`
- `POST /api/personal/web-search`
- `POST /api/personal/notebooks/{notebook_id}/sources/web-import`
- `POST /api/personal/notebooks/{notebook_id}/source-snapshots`

These routes must be registered in the backend, exported into the actual OpenAPI contract, and narrowly allowed by the browser proxy in both supported authentication modes. Other methods, trailing suffixes and encoded path separators must remain rejected.

## Recovery and compatibility

- Unknown transport outcomes are not proof of rollback. Preserve request identity and reconcile durable receipts rather than create duplicate materials or silently repeat a paid scrape.
- A retained web snapshot can be reparsed locally without pretending that original HTML is available.
- Deleted targets must not be reported as ready merely because an old receipt remains. Do not silently resurrect a user-deleted source.
- Archive restore preserves derived identity and historical distrust. The existing archive sanitizer is unchanged; structured web URLs omitted by it have an explicit historical marker. Readable attribution is retained in the snapshot text.
- Derived snapshots intentionally do not populate legacy `Source.full_text`: classic source chat does not preserve their derived-evidence semantics. Read and use them in the primary study workspace. Successfully extracted web imports do populate legacy text through the existing evidence worker.
- Existing classic notebook access remains available; this is not an implicit migration of all legacy features.

## Verification ledger

Root backend verification through `95e42c7`, including keyless trial and the regenerated actual OpenAPI schema; frontend rerun through presentation refinement `84cb32b`:

- [x] Aggregate backend: `python -m pytest -q`, **1,712 passed, 46 gated skips, 2 dependency deprecation warnings**.
- [x] Focused isolated SurrealDB suite: snapshot, web-import and native-note repository tests, **29 passed**, including concurrent/replayed transactions, lost acknowledgements, deletion races and archive export. The provider and worker submissions are mocked; this is not a live scraping test.
- [x] Aggregate frontend: `npm test`, **77 files / 1,172 tests passed**, including locale checks and existing auth/SSE/draft regressions.
- [x] Production `npm run build`, fresh `tsc --noEmit`, and lint passed. Lint has **0 errors / 7 existing warnings** outside the new feature changes.
- [x] Actual guarded OpenAPI export/check and exact browser-route audit. Only the four intended paths were added; no existing path or schema was removed or changed by the initial integration. Trial adds its explicitly typed status metadata.
- [x] Static/synthetic PM review fixes: discovery entry, settings anchor, dirty-note warning, explicit recovery actions, neutral uncertain/saved states, focus restoration, wrapping controls, and clear Google-unmapped-source guidance. This does not replace visual browser evidence.
- [x] Isolated browser local-workflow acceptance against the staged `4e741c12` build, as described below. Later small presentation refinements have regression/build coverage, not a second visual acceptance pass yet.
- [ ] Preview update preserving user data, authentication and current work.

Initial verification issues were resolved rather than omitted: the frontend route audit first raced schema generation, then passed after export; the backend found a historical citation regression when its version was missing, fixed by retaining unverified status (including derived non-independent identity). A fresh tokenizer cache was seeded from an existing public encoding after matching the installed package's SHA-256, avoiding an online tokenizer download. An over-isolated build initially lacked the environment's existing proxy for Google Fonts; the successful rerun retained that existing build-time proxy without changing any network configuration or the provider client's no-proxy policy.

## Browser acceptance and provider limitation

A separate, loopback-only stack used a fresh in-memory database and public synthetic electrical-engineering notes. It did not read the user's runtime configuration or modify their notebook. The real preview remained running unchanged.

- At an observed 1,180 × 757 browser viewport, materials, reading/questions and notes/results used the responsive tab layout. Settings were outside the routine working panels. No actual Android, HarmonyOS, iPadOS or wide three-column device acceptance is claimed.
- Created and saved an Ohm's-law note, then added it to the same notebook's materials. Exactly one source appeared, unselected, labeled as derived material. Reading preserved the saved text and explained that the snapshot is not independent evidence.
- Modified the note without saving: promotion was disabled and save-first guidance appeared. Opening and closing notebook Settings preserved the unsaved edit.
- Saved that modification, refreshed the browser, and reopened the previously created material. The original snapshot remained unchanged. Selecting it and searching locally for `欧姆定律` returned a matching evidence result.
- The browser review prompted two subsequent presentation refinements: hide raw version identifiers inside details and use a neutral download label for derived snapshots; defer engine-configuration prompts until the user has selected materials. Existing request, authentication and mapping guards are unchanged.
- One actual keyless search for the public query `site:example.com Example Domain` returned application HTTP 502 without results. There was no automatic retry, scrape or paid fallback.
- One separate, bounded HEAD request to the fixed provider origin, from the same host and with the same direct/no-proxy TLS policy, produced only the exception classes `ConnectError → ConnectError → OSError → ConnectionRefusedError`. No HTTP response was received. This establishes a current transport failure, not a conclusion about account eligibility, trial quota, response schema or provider-wide availability. Network/proxy/TLS settings were not changed.

Successful real web search and import remain unverified. No live Google call or model-quality acceptance was performed. Docker definitions are retained; the tested dot-cloud preview used temporary native processes, not Docker execution or ChatGPT Sites hosting.

## Environment interruption and source recovery

At 05:18–05:21 UTC on 2026-10-22, following an execution-environment resume, independent read-only GUI-browser checks found both the old frontend and API refusing connections. Metadata checks in both execution contexts found the expected application, runtime configuration and runtime data paths absent. This does not establish the underlying lifecycle cause or prove that every possible backup is unavailable.

- A bounded review of surviving project metadata, recorded artifacts and Library titles found no verified backup of the current user's notebook data. Older public/synthetic fixtures were not substituted for a real backup, and older unverified datastores were left untouched.
- At 05:29 UTC, source recovery reconstructed the published commit `44387d9fcb15a02f294087e42e9d32adbbb6f507` and tree `69e17e07e01dec78c4687aeb1ff8d230c790999e`. All 1,112 tracked paths, modes and blob hashes matched; strict Git integrity and clean-worktree checks passed. The older checkout and its uncommitted work were preserved.
- This was source-code recovery only. At that checkpoint, dependencies and build artifacts had not been reconstructed; runtime configuration, credentials and user data were not restored, and no service was started. Earlier test results were not proof of a working recovered deployment.
- The owner was warned to preserve unsaved browser content and asked whether to authorize an explicitly empty test instance with new dedicated credentials. No affirmative response is assumed. Any owner-supplied notebook export must be validated before restoration.
- Until storage durability and an independent recovery path have been demonstrated, this temporary environment must hold test data only, never the sole copy of important material. See the persistence gates in `RUNBOOK.md`.

## Fresh post-recovery checks

Trusted existing dependency manifests/lockfiles matched exactly. Dependencies were copied independently, public tokenizer bytes were verified by the installed package's expected SHA-256, and the unchanged frontend was rebuilt with genuine public assets. No user runtime configuration or authenticated provider access was used.

- At `3002fd72`, fresh frontend coverage verification passed **1,172 tests in 77 files**, production build, explicit TypeScript and lint (**0 errors, 7 existing warnings**). The standalone bundle includes verified static/public assets. The frontend tree is unchanged by the later Python type-contract fix.
- Fresh full mypy initially found **16 errors in 6 files**. Fix `d45caea` binds provider metadata before narrowing, makes existing optional-receipt guards explicit, fails closed rather than inventing a missing dispatch receipt, and strengthens test assertions. Seven metadata/replay regression cases were added; no provider/network configuration or replay fallback was introduced.
- Root verification on the integrated Python fix passed **1,719 backend tests, 46 gated skips, 2 dependency deprecation warnings**, full non-incremental **mypy on 256 files**, and full **Ruff lint/format on 256 files**. The actual isolated database opt-ins were not rerun after recovery; their earlier 29-test result is historical, not a new live-DB result.
- The full Python run used a separate guarded test harness, not application code. Eight DNS operations were denied by its audit hook; none completed through those attempts. Attribution identifies six source/domain cleanup tests and two explicit-localhost validation tests, without claiming every attempted operation was intended.
- Intermediate verification failures were retained: an empty isolated tokenizer cache attempted a blocked public dependency fetch; a later harness missing its main guard re-entered pytest under multiprocessing spawn. Both runs were reconciled/stopped. The corrected harness used the verified local encoding, kept network denial in force, passed a multiprocessing smoke test, then passed the full suite. No denied network operation was retried through another route.

These checks prepare code and artifacts only. No replacement preview, user database, new credential or restored personal data has been created.

## Second recovery and isolated-launch preparation (2026-10-22)

- At the next continuation, the previously reconstructed scratch checkout and its evidence were absent too, while the older original checkout remained. Neither shared nor scratch storage has demonstrated lifecycle durability. The underlying cause is not established.
- Published source `f61086bd6a0ed73934686b7eed0780370e793dee`, tree `bd0f7acefb93d0963e2898625ebc16ef432aae29`, was reconstructed again: all 1,112 baseline tracked paths/modes/blob hashes matched and strict Git integrity passed. This remains source recovery, not private runtime or user-data recovery.
- Fresh current-session frontend verification again passed **1,172 tests / 77 files**, production build, TypeScript and lint (**0 errors / 7 existing warnings**). Build `C82N_78XX_9-2xL1dZdG4` includes 125 verified static and 206 public files; there are no external Next.js rewrites. The launcher-only Python change does not alter this frontend source tree.
- The native launcher now accepts separate database/API/frontend ports, propagates them through child commands, runtime defaults, readiness and listener checks, and rejects contradictory local routing before storage mutation. Nondefault backends require exact IPv4-loopback endpoints; browser URLs reject ambiguous authorities and recognize numeric/reserved-localhost aliases without DNS. Explicit remote public settings remain supported under the documented constraints.
- Final reviewed Python verification passed **1,785 tests / 46 gated skips / 2 existing dependency warnings**, including **84 launcher tests**. Full Ruff lint/format and mypy passed on **257 files**. The offline audit guard remained active: eight DNS attempts and one bind were denied, not performed. Application/DB/frontend startup in the new launcher tests is mocked; the existing bounded owned-Python-descendant cleanup regression uses synthetic processes, not services. Actual database opt-ins were not rerun. An independent integration rerun reproduced 1,785 passed / 46 skipped in 70.64 seconds; see the sanitized [verification receipt](evidence/native-isolation-2026-10-22/summary.json).
- The previously used official SurrealDB 2.3.10 binary was independently copied and source/destination SHA-256 matched (`bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7`); only its version command ran, not a database server.
- Review added explicit separate-storage and browser-cookie guidance. Port changes separate origins/localStorage, not cookies. A temporary HTTP standalone preview remains legacy-password mode; production device-session HTTPS guards are unchanged. Existing user browser content must remain untouched.

These are code/artifact preparation and offline verification only. No new user instance, credential or service has been created, and old notebook data has not been recovered. The explicit fresh-empty-instance/new-credential confirmation remains pending at this checkpoint. Real web search/import, live Google/model acceptance, Docker execution, native-client delivery and external Sites hosting remain unverified. Do not treat either temporary directory or this successful build as durable hosting.

## Fresh empty preview — current checkpoint (2026-10-22 10:42 UTC)

This checkpoint supersedes the earlier pending-approval/no-service statements above for the new test instance only; historical results are unchanged.

- The owner explicitly approved rebuilding an empty test instance with new dedicated credentials at **10:30:50 UTC**, after being told that old notes would not be restored and the old browser page would remain untouched. No old user data was recovered and no data backup was supplied.
- Independently recovered exact source `0fd8956872fc225e7b1264a901543304d3ec152d`, tree `10d76e70a157d8637c23794370665c64378bc3f6`: **1,114 tracked paths** matched. Fresh frontend build `VOfZrEZL2--VmrXztQWOt` passed **1,172 tests / 77 files**, production build and TypeScript; lint reported **0 errors / 7 warnings**. These are fresh frontend results, not a new full backend-suite run.
- Started the native loopback stack on frontend **13001**, API **5056** and database **18001**, with explicit `legacy_password` authentication and `keyless_trial` search mode. The first launch failed because the GUI environment PATH lacked Node/npm; owned child processes were cleaned up. Retrying with the already-installed **Node 24.19.0** on PATH succeeded.
- Actual direct-API and frontend-proxy checks both rejected anonymous and wrong-password access with **401**, accepted authorized inventory requests with **200**, and confirmed the initial inventory was empty. Exactly **one clearly public fixture notebook and one source** were then created. The real worker completed extraction, Chinese extracted text/evidence was verified, and direct/proxy original downloads matched the uploaded bytes. See the [sanitized checks and limitations](evidence/fresh-preview-2026-10-22/summary.json).
- The Chinese login page visibly rendered and manual user handoff was delivered. Password/configuration were delivered privately; no secret contents are recorded here. **The user's browser login has not yet been verified.** API/proxy acceptance is not authenticated browser-workflow acceptance.
- This is a **temporary cloud runtime with no durability guarantee**, for test data only. No Docker execution, Sites hosting, native-client acceptance, live Google/model acceptance or successful actual web search/import is established by this checkpoint. Enabling keyless trial is not proof of provider availability.
