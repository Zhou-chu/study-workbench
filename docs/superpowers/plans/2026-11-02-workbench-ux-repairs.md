# Workbench bounded UX repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the six source-confirmed reading, selection and credential UX gaps without changing retrieval semantics or safety boundaries.

**Architecture:** Four independent fix commits extend existing React components and search ownership guards. Small pure readiness, display-label and PDF sizing helpers isolate decisions from JSX; PDF zoom belongs to the reader's version identity, not its replaceable Blob.

**Tech Stack:** Existing React/TypeScript, TanStack Query, i18next, Tailwind semantic tokens, pdfjs-dist 6.4.299, Vitest/Testing Library/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-02-workbench-ux-repairs.md`.

Eventual plan path: `docs/superpowers/plans/2026-11-02-workbench-ux-repairs.md`.

## Global Constraints
- No dependency changes, installation, service startup, browser/desktop control, external model calls, real notes, or user credentials. Use prepared offline test dependencies only. ZC_LAPTOP is forbidden; desktop task access remains false.
- Preserve F1/auth/target ownership, immutable citation and version identity, exact selected scope, note draft ownership/revisions, no automatic retries, and backend fail-closed validation. No silent source exclusion.
- Preserve Quiet Green semantic tokens and existing touch-target rules; every new string uses i18n with locale-key parity.
- Semantic retrieval, external knowledge-base connections, provider disclosure redesign, and P3 line-length redesign are outside this plan.
- Unit/CSS-contract tests establish logic and authored constraints, not browser geometry, visual comfort, native Tab behavior, or real PDF sharpness.

## Review Focus
1. Missing/duplicate selected IDs or contradictory status/extraction_status must block, not silently shrink scope (Task 1).
2. ready→blocked→ready before an asynchronous response/dispatch must retire old evidence rather than resurrect it (Task 1).
3. Same-second dates, prefix collisions, invalid/date-only dates and absent page locators must not invent identity/location (Task 2).
4. Zoom/resize while getPage/render is pending, mixed page sizes and extreme aspect ratios must not race canvas ownership or breach memory bounds (Task 3).
5. Same-version PDF refresh and credential reopen/target switch must retain the right reading preference but never retain an exposed secret (Tasks 3–4).

---

## Preparation and evidence
- [ ] The execution controller verifies the restored isolated worktree content matches product `df94d8c18bfbae217aea5c9283b7a24d38844d24` plus docs-only remote `28d270c1213cfe620c311b0b6a54aa3dd081f9e5` (reported restored local HEAD `36d1bdaa`, tree `5231eee8`, branch `fix/ux-rag-redteam-20261102`; content equivalence is not commit ancestry), reads root/frontend AGENTS and applicable installed Next docs, and checks clean status before copying the two handoff docs to their eventual paths. Do not use or mutate the old checkout.
- [ ] Confirm prepared offline dependencies exist. All commands below run inside `frontend/` unless stated otherwise; `npm run test:unit -- <paths>` is the existing script and does not install packages. If unavailable, record command/target/reason and pause execution-dependent work. Do not use npx auto-download, npm install, uv sync or service startup.
- [ ] Capture baseline targeted suite before changes: `npm run test:unit -- src/components/evidence/PdfCanvas.test.tsx src/components/evidence/EvidenceReader.test.tsx src/components/workbench/WorkbenchSourcesList.test.tsx src/components/workbench/StudyWorkbench.test.tsx src/components/workbench/StudyWorkbench.reader-navigation.test.tsx src/components/workbench/workbench-responsive.test.tsx src/lib/hooks/use-workbench-evidence-search.test.tsx src/lib/locales/index.test.ts`. Record actual results, not historical audit counts.

## Task 1: Ready-source dispatch gate and recoverable empty status

**Files**
- Create: `frontend/src/lib/utils/workbench-readiness.ts`, `.test.ts`.
- Create: `frontend/src/components/workbench/SelectedSourceReadiness.tsx` (only blocker presentation).
- Modify: `frontend/src/components/workbench/StudyWorkbench.tsx`, `WorkbenchSourcesList.tsx`, `StudyWorkbench.test.tsx`, `WorkbenchSourcesList.test.tsx`.
- Modify: `frontend/src/lib/hooks/use-workbench-evidence-search.ts`, `.test.tsx`.
- Modify: `frontend/src/lib/utils/workbench.ts`, `frontend/src/lib/locales/workbench.ts`, `CHANGELOG.md`.

**Interfaces**
- `SelectedSourceBlocker = { versionId: string; title: string | null; status: string | null; reason: 'not-ready' | 'missing' | 'ambiguous' }`.
- `selectedSourceBlockers(ids: readonly string[], sources: Workspace['sources'] | undefined): SelectedSourceBlocker[]` in readiness utility. Preserve selected order; one blocker per distinct selected ID; undefined sources makes each selected ID missing. `projectWorkbenchVersion` safely projects version fields. Match raw authoritative status only against ready/partial.
- `SelectedSourceReadiness({ blockers }: { blockers: readonly SelectedSourceBlocker[] })` renders nothing when empty, otherwise localized wrapping status list; exact IDs remain visible. Uses existing checkboxes for explicit scope change.
- Change `useWorkbenchEvidenceSearch(notebookId: string, selection: WorkspaceSelection | null, sources: Workspace['sources'] | undefined)`; required third argument, no permissive default. Return existing fields plus `sourceBlockers: SelectedSourceBlocker[]`. Existing `ready` still describes connection readiness, not combined source availability.

- [ ] Write utility tests `blocks_every_nonallowlisted_authoritative_status`, `does_not_trust_extraction_fallback`, `blocks_missing_or_duplicate_id`, `ignores_unselected_versions` with assertions:
  ```ts
  expect(selectedSourceBlockers(['good','bad'], sources).map(x => x.versionId)).toEqual(['bad'])
  // good.status='partial'; bad.status='queued', bad.extraction_status='ready'
  expect(selectedSourceBlockers(['gone'], sources)[0].reason).toBe('missing')
  expect(selectedSourceBlockers(['duplicate'], duplicateSources)[0].reason).toBe('ambiguous')
  ```
  Parameterize bad statuses null, completed, queued, extracting, needs_ocr, empty, failed, unsupported, unknown; test status=ready and partial allowed regardless original_status.
- [ ] Add hook tests `readiness_blocks_submit_and_deferred_dispatch` and `readiness_aba_retires_hits`: update `show()` fixture to pass sources for all selected IDs; use real hook rerenders/deferred promises. Assert blocked submit makes zero evidenceApi.search calls; ready→blocked before mutation microtask makes zero calls; ready→blocked→ready after dispatch hides hits and saved isCurrent handler returns false; transition to ready does not send; explicit resubmit sends unchanged ordered IDs exactly once.
- [ ] Add workbench tests `mixed_scope_blocks_question_outline_and_search_without_deselecting` and `readiness_refresh_preserves_note_draft`: ready+each blocked state disables Ask/outline/search (including Enter), shows correct source title/ID/status, leaves checkboxes checked and note editor values untouched. Refresh to ready enables controls without requests; explicit deselection changes only that ID; full-ready submit retains exact scope. Add empty status/hint tests and unknown fallback test to SourcesList. Keep remote-scope existing behavior.
- [ ] Run `npm run test:unit -- src/lib/utils/workbench-readiness.test.ts src/lib/hooks/use-workbench-evidence-search.test.tsx src/components/workbench/StudyWorkbench.test.tsx src/components/workbench/WorkbenchSourcesList.test.tsx`; expected red from missing helper/gating/empty localization, not fixture setup errors.
- [ ] Implement helper and component interfaces above. In StudyWorkbench derive local blockers, add them to canAsk, render near both entrypoints, and recheck latest sources + synchronous selectionRef in submitTurn (including deferred outline confirmation). Never filter submitted IDs. Keep already-captured recovery request semantics unchanged.
- [ ] Extend search's latest ref with sources; include deterministic `[selected ID, authoritative status, match count]` readiness fingerprint in sync(); check blockers in submit(), canSubmit and mutation dispatch/isCurrent. Preserve all existing query/scope/auth/context generation checks and explicit no-retry mutation options. Selected source readiness changes invalidate; unrelated source changes need not.
- [ ] Add `empty` state mapping and hint plus blocker/wait/deselect/OCR guidance to workbenchEn/workbenchZh. Reuse the existing shared workbench locale imports; verify all 14 locale shapes, not English fallback assumptions. Add Unreleased Fixed entry.
- [ ] Rerun targeted command and `npm run test:unit -- src/lib/locales/index.test.ts src/lib/locales/interpolation.test.ts`; expected all pass. Inspect diff for any selection filtering, new external calls, recovery replay or note-owner changes; reject those.
- [ ] Stage only Task 1 files and commit `fix(workbench): block unready selected evidence before dispatch`.

## Task 2: Visible evidence identities and complete wrapping content

**Files**
- Create: `frontend/src/lib/utils/workbench-labels.ts`, `.test.ts`.
- Create: `frontend/src/components/workbench/WorkbenchSearchResult.tsx`, `.test.tsx`.
- Modify: `frontend/src/components/workbench/StudyWorkbench.tsx`, `StudyWorkbench.test.tsx`, `WorkbenchSourcesList.tsx`, `WorkbenchSourcesList.test.tsx`, `workbench-responsive.test.tsx`.
- Modify: `frontend/src/lib/locales/workbench.ts`, `CHANGELOG.md`.

**Interfaces**
- `versionPrefix(id: string, displayedIds: readonly string[]): string`: shortest unique prefix, starting at min(8,id.length); extend on prefix collisions; duplicates yield full ID.
- `versionDateLabel(value: string | null, language: string): string | null`: input already projected/validated by projectWorkbenchVersion; null→null, date-only→localized UTC date only, timestamp→localized UTC date/time with seconds and timezone name. Use Intl.DateTimeFormat, fallback locale en-US for unsupported locale errors; never Date.parse an invalid raw wire value directly in JSX.
- `WorkbenchSearchResult({ hit, versionLabel, onOpen }: { hit: EvidenceRecord; versionLabel: string; onOpen: (hit: EvidenceRecord) => void })`: main button contains title/quote/page/version and text warning, sibling SourceProvenance outside button. Parent onOpen retains search.isCurrent() and exact existing citation mapping.

- [ ] Write helper tests `same_day_and_same_second_versions_remain_distinct`, `prefix_collision_extends`, `date_only_never_invents_time`: assert distinct prefixes for abcdefgh1/abcdefgh2, full value for duplicate IDs; timestamp UTC times differ for 09:00/10:00, date-only has no time, null returns null. Use Intl-derived assertions rather than machine-local timezone assumptions.
- [ ] Write card tests `identical_quotes_show_distinct_sources`, `physical_page_is_not_print_page`, `derived_warning_is_visible_without_opening`, `provenance_has_no_nested_interactive_content`: assert source titles, full quotes, distinct version labels; page_index=0 displays physical page 1, missing/negative/NaN does not; print label remains separate; independent_support=false and derived_snapshot show warning; `button.querySelector('a,button,details') === null`.
- [ ] Extend SourcesList test for three same-day versions: visible times/prefixes, row disclosure exposes exact full ID, selecting each passes exact original ID. Preserve missing/invalid dates and unknown status safety tests. Update responsive test date expectation to its locale display while retaining whole-label click/44px authored-rule tests.
- [ ] Add StudyWorkbench long-token test using `'x'.repeat(500)` for question, saved-note title and hit quote/title: exact text retained, each consumer and shrinkable card have `min-w-0` and `[overflow-wrap:anywhere]`; no truncate class on evidence. These assertions are authored CSS-contract checks, not measured overflow.
- [ ] Run `npm run test:unit -- src/lib/utils/workbench-labels.test.ts src/components/workbench/WorkbenchSearchResult.test.tsx src/components/workbench/WorkbenchSourcesList.test.tsx src/components/workbench/StudyWorkbench.test.tsx src/components/workbench/workbench-responsive.test.tsx`; expected red on absent helpers/card/labels/wrapping.
- [ ] Implement above interfaces, wrap headings and cards, and use per-row full-ID details. Build prefixes from all displayed source-version IDs so rows and search hits disambiguate consistently; include hit IDs if absent from source list. Do not alter newestSelectableVersionId, raw IDs, citation validity, provenance payload, reading position or scope. Add localized version/UTC metadata labels as needed and changelog Fixed entry.
- [ ] Rerun targeted command plus locale parity/interpolation; expected pass. Verify existing reader-navigation and search ownership tests still pass. Stage Task 2 files and commit `fix(workbench): expose evidence identity and wrap long content`.

## Task 3: PDF in-place zoom and resize-safe bounded raster lifecycle

**Files**
- Create: `frontend/src/components/evidence/pdf-render-sizing.ts`, `.test.ts`.
- Modify: `frontend/src/components/evidence/PdfCanvas.tsx`, `PdfCanvas.test.tsx`, `EvidenceReader.tsx`, `EvidenceReader.test.tsx`.
- Modify: `frontend/src/lib/locales/workbench.ts`, `CHANGELOG.md`.

**Interfaces**
- Export `type PdfZoom = 'fit' | number` from sizing helper.
- `pdfRenderSizing(pageWidth: number, pageHeight: number, containerWidth: number, zoom: PdfZoom, devicePixelRatio: number): { cssWidth: number; cssHeight: number; scale: number; rasterScale: number; pixelWidth: number; pixelHeight: number } | null` implements spec formula; rasterScale is pixels per CSS pixel. Invalid page/container geometry or nonfinite computed CSS dimensions/area returns null; invalid numeric zoom becomes 1; invalid/nonpositive DPR becomes 1; numeric zoom clamped [0.25,3].
- Extend PdfCanvas props with `zoom: PdfZoom; onZoomChange: (zoom: PdfZoom) => void`; existing blob/pageIndex/fallbackText unchanged. EvidenceReader state holds `{ versionId: string | undefined; zoom: PdfZoom }`, derives fit immediately if owner differs, and writes current identity on user change. Do not reset on Blob identity.

- [ ] Write sizing tests `fit_and_numeric_zoom_have_separate_css_and_raster_size`, `bounds_extreme_aspect_ratio_and_dpr`, `rejects_invalid_geometry`. Assertions include:
  ```ts
  expect(pdfRenderSizing(600,800,300,'fit',2)).toMatchObject({cssWidth:300,cssHeight:400,scale:0.5,pixelWidth:600,pixelHeight:800})
  expect(pdfRenderSizing(600,800,300,1,2)).toMatchObject({cssWidth:600,cssHeight:800})
  // table: square, portrait, 100000×1, 1×100000; widths 1/300/1920; zoom fit/.25/1/3; DPR 1/2/8
  expect(size.pixelWidth).toBeLessThanOrEqual(3200)
  expect(size.pixelHeight).toBeLessThanOrEqual(3200)
  expect(size.pixelWidth*size.pixelHeight).toBeLessThanOrEqual(10240000)
  expect(pdfRenderSizing(0,800,300,1,2)).toBeNull()
  ```
- [ ] Add controlled-toolbar harness in PdfCanvas tests and deterministic ResizeObserver/rAF mocks. Tests: `fit_resize_rerenders_without_reloading_document`, `numeric_zoom_survives_resize`, `zoom_limits_and_fit_keep_page`, `zero_width_waits_until_visible`, `cleanup_disconnects_and_cancels_frame`. Assert effective CSS dimensions/raster call args, same pageIndex, unchanged getDocument count, no max-w-full canvas class and viewport overflow-auto; don't assert jsdom scrollWidth.
- [ ] Add deferred render/getPage tests `cancel_settles_before_canvas_reuse`, `late_generation_cannot_mark_new_page_ready`, `unmount_cancels_and_releases_backing_store`. Mock cancel to settle its render promise by rejection, as PDF.js does. Assert no second render or canvas resize before first settles, stale completions can't change ready/failure state, final canvas width/height zero after settlement, document task destroy called, observer disconnected. Cover zoom and width changes, not only page changes. Keep protected bytes/local assets/fallback tests.
- [ ] Add EvidenceReader tests `zoom_survives_same_version_refetch_and_citation_jump` and `zoom_resets_on_new_version`: mocked PdfCanvas captures/changes controlled props; page moves and same-version new Blob keep zoom=2; sourceVersionId change yields fit; ReadingPosition callback retains exact pre-existing shape.
- [ ] Run `npm run test:unit -- src/components/evidence/pdf-render-sizing.test.ts src/components/evidence/PdfCanvas.test.tsx src/components/evidence/EvidenceReader.test.tsx`; expected red on missing sizing/controls/resize/lifecycle behavior.
- [ ] Implement pure sizing and controlled reader zoom. Add localized toolbar using existing Button semantics/focus/touch tokens, no absolute overlay. Use actual CSS width/height and viewport-only scrolling; render viewport uses PDF scale×rasterScale with canvas dimensions matching bounded bitmap (or equivalent PDF.js transform), never allocate CSS-sized then downsample.
- [ ] Implement coalesced positive-width ResizeObserver lifecycle and serial render ownership. Track a render settlement promise/ref plus generation token; cancellation must precede awaited settlement and latest generation check before canvas allocation. Await old task rejection harmlessly; no detached extra backing canvases, cached pages or setState after cleanup. Late getPage must check generation before render. Release backing dimensions only after current task settles. Preserve selected-page fallback and document destroy. Add locale copy and changelog Fixed entry.
- [ ] Rerun targeted command and locale tests, expected pass; rerun StudyWorkbench reader-navigation regression. Review bitmap bounds and cleanup against spec; do not count real image sharpness as verified. Stage Task 3 files and commit `fix(reader): add bounded PDF zoom and resize rendering`.

## Task 4: Keyboard-accessible localized credential visibility

**Files**
- Modify: `frontend/src/components/settings/CredentialFormDialog.tsx`.
- Create: `frontend/src/components/settings/CredentialFormDialog.test.tsx`.
- Modify: locale `index.ts` in `frontend/src/lib/locales/{bn-IN,ca-ES,de-DE,en-US,es-ES,fr-FR,it-IT,ja-JP,pl-PL,pt-BR,ru-RU,tr-TR,zh-CN,zh-TW}/` and `CHANGELOG.md`.

**Interfaces**
- Existing CredentialFormDialog props unchanged. Add `apiKeys.showKey`, `hideKey`, `showKeyLabel`, `hideKeyLabel` in every locale; English Show/Hide/Show API key/Hide API key; Chinese 显示/隐藏/显示 API 密钥/隐藏 API 密钥. Translate other locales explicitly; do not introduce missing-key fallback.

- [ ] Write mocked-provider/mutation tests `visibility_button_is_focusable_and_non_submitting`, `visibility_action_is_localized`, `close_reopen_and_target_change_remask`, `edit_never_prefills_existing_secret`. Assert initial password, button.tabIndex=0, type=button, aria-controls=api-key, focus ring class; clicking toggles input type without changing synthetic value or calling mutation; disabled while submitting. Switch open true→false→true and provider/credential target, assert masked; stored credential metadata never appears as input key. Run both Chinese and English with real locale values (not key-only mocks).
- [ ] Run `npm run test:unit -- src/components/settings/CredentialFormDialog.test.tsx`; expected red for negative tabIndex, hard-coded names and retained visibility. Do not claim fireEvent proves browser Tab/Enter/Space defaults; retain those in pending browser matrix.
- [ ] Implement adjacent translated normal button, visible focus ring, aria-controls, type=button and disabled=isSubmitting. Remove tabIndex=-1. Reset only showApiKey on open/provider/credential identity changes; keep existing apiKey edit initialization and submission payload logic. Add locale keys and changelog Fixed entry.
- [ ] Run `npm run test:unit -- src/components/settings/CredentialFormDialog.test.tsx src/lib/credential-update-payload.test.ts src/lib/locales/index.test.ts src/lib/locales/interpolation.test.ts`; expected pass. Stage Task 4 files and commit `fix(settings): localize and enable keyboard key visibility`.

## Final verification and delivery
- [ ] Run available prepared offline gates: `npm run test:unit`, `npm run test:artifact`, `npm run lint`, `./node_modules/.bin/tsc --noEmit`, `npm run build`. Build only if prepared local assets/dependencies meet its existing contract; no missing-asset download/install workaround. Record each actual pass/failure/block separately; fix regressions inside scope.
- [ ] Review `git diff --check`, `git status --short`, commit diffs and changed-file list. Ensure no package/lockfile, backend, credential storage, F1/recovery, CI/publication or user-data changes. Keep docs and exact gate evidence in final progress commit if needed.
- [ ] The execution controller pushes reviewed commits to the authorized existing GitHub branch using the approved route and verifies remote HEAD contains them. Report SHA and offline results promptly. No claim of CI: repo has no active checked-in CI workflows.
- [ ] Record remaining browser/runtime gate as pending due to desktop is_authorized_for_tasks=false; no laptop fallback. Ask for specific required platform access only if proceeding to that blocked work; do not make optional process approval a condition for these already-authorized repairs.

## Self-review performed
Spec coverage: A→Task 1, B→Task 2, C→Task 3, D→Task 4; all six audit categories covered, line length and semantic retrieval excluded. Fixed status/extraction fallback ambiguity, readiness ABA, timestamp/prefix collision, nested provenance interactions, Blob-vs-version zoom ownership and serialized canvas cleanup in the plan. Interface names/types match across tasks; required search sources argument updates its test harness. Tests distinguish authored CSS/native browser behavior. Four coherent commits, each red/green/reviewable; no application edits or test-pass claims were made while planning.
