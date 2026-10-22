# Research workspace v2 — acceptance record

Date: 2026-10-22 UTC.

**Status: merged-code regression gates passed; live preview replacement and browser/provider acceptance remain pending.**

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

Root verification on the merged code through `95e42c7`, including keyless trial and the regenerated actual OpenAPI schema:

- [x] Aggregate backend: `python -m pytest -q`, **1,712 passed, 46 gated skips, 2 dependency deprecation warnings**.
- [x] Focused isolated SurrealDB suite: snapshot, web-import and native-note repository tests, **29 passed**, including concurrent/replayed transactions, lost acknowledgements, deletion races and archive export. The provider and worker submissions are mocked; this is not a live scraping test.
- [x] Aggregate frontend: `npm test -- --run`, **77 files / 1,162 tests passed**, including locale checks and existing auth/SSE/draft regressions.
- [x] Production `npm run build`, fresh `tsc --noEmit`, and lint passed. Lint has **0 errors / 7 existing warnings** outside the new feature changes.
- [x] Actual guarded OpenAPI export/check and exact browser-route audit. Only the four intended paths were added; no existing path or schema was removed or changed by the initial integration. Trial adds its explicitly typed status metadata.
- [x] Static/synthetic PM review fixes: discovery entry, settings anchor, dirty-note warning, explicit recovery actions, neutral uncertain/saved states, focus restoration, wrapping controls, and clear Google-unmapped-source guidance. This does not replace visual browser evidence.
- [ ] Browser visual/interaction verification, with evidence distinguished from synthetic DOM tests.
- [ ] Preview update preserving user data, authentication and current work.

Initial verification issues were resolved rather than omitted: the frontend route audit first raced schema generation, then passed after export; the backend found a historical citation regression when its version was missing, fixed by retaining unverified status (including derived non-independent identity). A fresh tokenizer cache was seeded from an existing public encoding after matching the installed package's SHA-256, avoiding an online tokenizer download. An over-isolated build initially lacked the environment's existing proxy for Google Fonts; the successful rerun retained that existing build-time proxy without changing any network configuration or the provider client's no-proxy policy.

No live search, scrape, Google call or model-quality acceptance has been performed yet. Docker definitions are retained, but the current dot-cloud preview is a temporary native-process deployment, not Docker execution or ChatGPT Sites hosting. Preview replacement is waiting for the user to confirm current input is saved; existing data and credentials must remain unchanged.
