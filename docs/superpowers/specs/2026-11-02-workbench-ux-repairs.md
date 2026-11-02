# Workbench bounded UX repair specification — 2026-11-02

Eventual repository path: `docs/superpowers/specs/2026-11-02-workbench-ux-repairs.md`.

## Decision and evidence
Continue the user's requested red-team improvements without a process questionnaire. Keep Quiet Green and existing architecture; repair six confirmed source-level gaps, not the P3 reading-line-length hypothesis. Alternatives considered: cosmetic redesign (reject: no pixel evidence), button-only patches (reject: stale dispatch/lifecycle failures), bounded presentation + dispatch guards (chosen).

Grounding: GitHub `Zhou-chu/study-workbench` product SHA `df94d8c18bfbae217aea5c9283b7a24d38844d24`; later `28d270c1213cfe620c311b0b6a54aa3dd081f9e5` is docs-only. Read both 2026-11-02 audit reports, root/frontend AGENTS, actual components, read projections, search hook, backend retrieval allowlist, and existing component/hook tests at the product SHA. Old local checkout is not evidence. This document is a design, not a test-pass report.

## Global constraints
- No dependency changes, installation, service startup, browser/desktop control, external model calls, real notes, or user credentials. Use prepared offline test dependencies only. ZC_LAPTOP is forbidden; desktop task access remains false.
- Preserve F1/auth/target ownership, immutable citation and version identity, exact selected scope, note draft ownership/revisions, no automatic retries, and backend fail-closed validation. No silent source exclusion.
- Preserve Quiet Green semantic tokens and existing touch-target rules; every new string uses i18n with locale-key parity.
- Semantic retrieval, external knowledge-base connections, provider disclosure redesign, and P3 line-length redesign are outside this plan.
- Unit/CSS-contract tests establish logic and authored constraints, not browser geometry, visual comfort, native Tab behavior, or real PDF sharpness.

## A. Selected-source readiness and empty extraction
For local scope, resolve every selected immutable version ID against current workspace sources. Exactly one match with authoritative `status` equal to `ready` or `partial` is usable. Missing/duplicate identities, unknown/missing status, `completed`, queued/extracting/needs_ocr/empty/failed/unsupported are blocked. Do not let `extraction_status` override nonready/missing `status`; it remains display-only. Unselected nonready sources do not block. Remote scope keeps its existing capability/connection rules and is not evaluated as local evidence.

Keep selected blocked sources selected and readable; keep checkboxes usable so users can explicitly deselect. Show title, exact version ID and localized status in a compact wrapping status list near Ask/outline and search, with guidance to wait or deselect; empty says to upload a new version containing text; needs_ocr says OCR is needed, without pretending OCR is implemented. No automatic OCR/upload/reparse, selection repair, filtering, or new polling. Existing workspace refresh/status updates release the gate without sending a request.

Guard Ask, outline confirmation and search submission, not just disabled buttons. Search readiness participates in generation identity and is rechecked at dispatch; ready→blocked→ready cannot resurrect old hits. Readiness recovery requires a fresh explicit search. Unknown backend races still fail closed as today. Do not rewrite already-captured recovery requests.

Add `states.empty` = “No searchable text” / “无可检索文字”; separate hint = “This file contains no searchable text. Upload a new version containing body text.” / “此文件没有可检索文字，请上传含正文的新版本。” Unknown future statuses still show unavailable, never ready.

## B. Visible identities and long-token wrapping
Search result card hierarchy: source title (fallback exact version ID), complete quote, physical page if a nonnegative integer page_index exists (index + 1), print-page label separately if supplied, version label, source-kind/derived-warning text. Do not fabricate a page for missing locators or equate print and physical page. Preserve existing hit→citation construction and activation ownership check. Put rich provenance outside the main button to avoid nested buttons/links/details. Always show not-independent-evidence text for derived kind or independent_support === false; no inference that all other hits are independent.

Version rows show locale-formatted UTC date/time through seconds, visibly labeled UTC; date-only legacy records show a date only (no invented time). Invalid dates use existing unavailable fallback. Show a version prefix of at least 8 characters, extending to distinguish the other displayed IDs; full ID is selectable/copyable in a per-row details disclosure, not hover-only. Identical duplicate IDs remain visible but must not become readiness authorization. Labels never replace canonical IDs in requests/keys/citations or change newest-version selection logic.

Question headings, saved-note headings, search titles/quotes/metadata and their shrinkable card containers use min-width:0 and overflow-wrap:anywhere. Keep complete strings; do not truncate evidence. Leave code/table local horizontal scrolling and already-fixed citation styles alone.

## C. PDF zoom, resize and bounded rendering
EvidenceReader owns `PdfZoom = 'fit' | number`, keyed to sourceVersionId, default `fit`. Keep zoom through page changes, citation jumps, container resize, and same-version blob refetch. Reset on source-version change, reader unmount, or explicit Fit width; do not persist zoom or alter ReadingPosition/scope. PdfCanvas receives zoom and onZoomChange; it owns raster lifecycle and its toolbar.

Controls: localized Fit width, 100%, Zoom out, Zoom in, and current effective percentage; numeric zoom 0.25–3.0 in 0.25 steps, clamped, with disabled limits. First +/- from fit uses the effective current fit scale before stepping/clamping. 100% means one CSS pixel per PDF viewport unit at scale 1, not a promise of physical print size. Fit scale = min(containerWidth / originalWidth, 3), including fits below 0.25. Invalid/zero container sizes defer rendering until positive observation rather than allocating a fallback oversized page. Missing ResizeObserver may use initial clientWidth + cleaned-up window resize fallback.

The PDF viewport alone has overflow:auto; canvas CSS width/height follows requested scale and is not max-w-full squeezed. Separate display zoom from raster density. With desired CSS dimensions W,H and density d clamped to (0,2], raster factor r = min(d, 3200/W, 3200/H, sqrt(10240000/(W*H))). Allocate floor(W*r) × floor(H*r), each at least 1; reject nonpositive/nonfinite page geometry or nonfinite computed CSS dimensions/area. Thus each axis ≤3200 and backing pixel count ≤10,240,000, independent of page aspect ratio, zoom or DPR. A capped raster may be softer: do not claim unlimited high-resolution zoom.

One live render/backing canvas at a time. Cancel the old RenderTask and wait for its promise to settle before resizing/reusing its canvas. Coalesce resize callbacks to the latest positive width with requestAnimationFrame, skip unchanged widths, disconnect observer/cancel scheduled frame on cleanup. Fence document/page/zoom/width generations so late getPage/render completion cannot show stale ready/failure state or mutate the new canvas. Clear backing dimensions after final cleanup once rendering has settled. Destroy owned PDF loading task on replacement/unmount. Preserve local pdfjs 6.4.299 assets, enableXfa:false, protected Blob input, selected-page fallback and no iframe/remote PDF URL. Do not render/cache all pages.

## D. Credential visibility
Use normal button Tab order, visible semantic focus ring, type=button, aria-controls=api-key and localized action names “Show API key”/“Hide API key” (“显示 API 密钥”/“隐藏 API 密钥”). Visible short text Show/Hide (“显示”/“隐藏”) also translated. Do not combine changing action names with ambiguous toggle aria-pressed semantics. Disable while submitting. Prefer an adjacent button rather than overlay text overlapping long translations; no new icons dependency.

Start masked; toggling preserves typed value and does not submit. Remask on open/close and provider/credential-target change. Continue never filling an existing stored key; do not broaden form-reset behavior or add persistence/logging/telemetry.

## Acceptance and stopping boundary
Four independently reviewable fix commits: readiness+empty; identity+wrapping; PDF; credentials, each with tests/locales/changelog. The execution controller reviews and executes in restored isolated worktree. Run targeted red/green then full available offline frontend gates, report exact commit and commands. Keep any missing tool/dependency gate explicitly blocked, not replaced by installation. Browser matrix remains pending: 360/390/768/1024/1280/1440/1920px, Chinese/English, light/dark, keyboard/touch, 125%/200% browser zoom; PDF mixed page sizes/rapid resize, long content, identical quotes and same-day versions. No browser pass or end-to-end service success may be inferred from unit tests.
