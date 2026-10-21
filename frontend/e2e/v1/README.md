# StudyWorkbench browser acceptance

Entry: open an existing local notebook, then **Open study workbench**. The route is
`/notebooks/{encoded-notebook-id}/study`. The existing notebook UI is retained.

## Verification already automated

Vitest exercises the real React components with controlled API responses, not a
separate mirrored implementation. Coverage includes exact version selection,
empty scopes, no write retries, per-file upload isolation, historical scope saved
with notes, historical extraction selection, Unicode codepoint highlighting,
authenticated PDF bytes, selected-page canvas rendering, cancellation and labeled fallback, Google write confirmation, unknown
submission warnings, portable restore confirmation, and application-vs-Google
401 handling. These are component/contract tests, not live-service E2E evidence.

## Browser checklist when an environment is available

1. Sign in using the application's password. Confirm direct anonymous access to
   workspace APIs, version downloads, jobs and exports is denied.
2. Upload a real PDF, Markdown and UTF-8 text file together with an invalid file.
   Each item must settle independently; valid files must parse without a model.
3. Read a PDF citation on a physical page, then a text citation preceded by emoji
   or a supplementary-plane character. The selected quote must not split a
   Unicode character. PDF exact highlights are explicitly unavailable in V1;
   PDF.js renders the real physical page and the quote is shown. Wait for
   `canvas[data-render-state="ready"][data-page-number="2"]` before capturing
   page 2. A rendering failure must show `[data-pdf-fallback="true"]` with
   extracted text for that physical page (or a missing-text notice), never a
   blank fixed-height pane.
4. Select a historical version, change engine, navigate to page 3, refresh, and
   check the version, engine and page remain. Upload a new version: old selection
   and old citations must not move to the new bytes or a newer extraction.
5. Clear the selection and check Ask is disabled. Select exact IDs and ask only
   when the appropriate real account/model is configured. Save an answer, change
   the current scope, and check the saved note retains its original scope.
6. At narrow viewport widths use Sources / Conversation / Notes tabs. At desktop
   widths resize the side columns without losing state.
7. Google list/link/import/sync/create/audio are explicit actions. Review exact
   target and source IDs before confirming a write. Verify connection expiry
   leaves local reading and export accessible. Never retry an uncertain remote
   submission automatically. Verify original associations only after selecting
   exactly one local version and one remote source.
8. When a real audio result is available, play and download its authenticated
   Blob. Refresh and verify the same job and artifact are still visible.
9. Export, download the ZIP, restore it into a new notebook, and read an archived
   citation. Restore must not connect accounts or replay historical jobs.

Google calls, audio generation, model inference and restore should only be run
against accounts/data explicitly authorized for that verification. Production
must not substitute a fake adapter when a real integration is unavailable.

## Current browser evidence boundary

This checklist itself is not graphical E2E evidence. Initial Chromium launches
were blocked by the execution environment; an official Playwright Firefox
fallback subsequently launched. Actual browser results, screenshots, build,
TypeScript, lint and component-test evidence belong in the project acceptance
report. Consult that report for the latest verification state.

## Pinned PDF renderer

`pdfjs-dist` is pinned to **6.4.299**, Apache-2.0, installed only from
`https://registry.npmjs.org`. Its Node requirement is `>=22.13.0 || >=24`;
the verified build uses Node 24.19.0. `npm run dev` and `npm run build` copy
the package's worker, CMaps, standard fonts and WASM into same-origin
`public/pdfjs/6.4.299/` using `scripts/prepare-pdf-assets.mjs`. No CDN is used.
Generated assets are ignored by Git and must be included with `public/` in
a deployment, as for the existing standalone Next.js app. Exact package
integrity and copied-asset hashes are in `docs/v1/evidence/pdfjs-provenance.json`.
