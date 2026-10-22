# Native fixture UI implementation plan — 2026-10-22

Goal: a genuine React Native source slice for Android/iPad, over the unchanged reviewed in-memory domain, not an installable or connected app.
Spec: docs/v1/MULTICLIENT_ARCHITECTURE.md and recovered native fixture plan; core review and re-review both read. User delegates plan self-review and ordinary execution.

## Architecture and boundaries
Use React Native Text/View/FlatList/TextInput/Pressable, React Navigation native-stack, and safe-area context. App owns one FixtureSession outside routes. Session owns notebook loads, note drafts and outline operations; subscribers observe immutable snapshots without cloning SaveAttempt objects. Screens are projections with commands. At >=840 logical units a 280-unit notebook sidebar appears beside the same navigator; width changes never create a session. No WebView, DOM, network, credentials, persistence, SDK scaffolding or platform commands.

Alternatives considered: screen-local reducers lose drafts on unmount; a custom navigation stack lacks native platform behavior. Choose app session plus native-stack, despite the additional scoped dependencies.

## Task 1 — session and dependencies
- [x] Verify official npm/vendor version and peer metadata; exact pins plus integrity lockfile. Install only scoped registry packages with scripts disabled, no native toolchains.
- [x] Add `test/session.test.mjs` RED for repeated/unknown saves, exact attempt callback across edits, reset invalidation, stale load, independent operations, receipt-only resume.
- [x] Implement `src/session/FixtureSession.ts`: subscribe/getSnapshot, loadList/openWorkspace, openNote/edit/save, submitOutline/resume, reset. Public methods own and capture repository lifetime; unknown throws are unknown outcomes, not retry permission.
- [x] Run domain and session Node tests and strict types.

## Task 2 — native views and navigation
- [x] Add mocked-native JS component tests RED for list/workspace/public text, draft back/dismiss, width switches, missing note text, unknown/conflict, queue receipt without output, empty/error/loading, settings separation and reset confirmation.
- [x] Implement `src/App.tsx`, `navigation/WorkspaceNavigator.tsx`, `screens/*`, `components/*`, session context. Use native-stack back/sheet dismissal; store operations outside sheet. Sidebar opens workspace with existing session. Settings is separate; no endpoint/login fields.
- [x] Preserve exact Chinese demo/save/queue messages. Explicitly distinguish public synthetic text from empty server sources. Render retained source/job/history summaries read-only; no replay actions.
- [x] Native text scales by default, scrollable layouts have no fixed text heights, buttons min48, labeled inputs/status/busy/disabled. KeyboardAvoidingView, scroll keyboardShouldPersistTaps, native header/back and safe areas. Restore focus through navigator, document real focus/runtime gate.
- [x] Run mocked-runtime component tests plus actual vendor declaration strict tsc; never label this device acceptance.

## Task 3 — review and handoff
- [x] Add ADR for app-lifetime state vs navigation; README exact commands, dependency research and gates; global scoped CHANGELOG entry.
- [x] Run all mobile tests/types, diff whitespace and dependency scope checks; unchanged core fixture equality still passes. Self-review product experience and hostile asynchronous order. Commit locally with exact hashes/evidence, request independent review through parent. No publication.

## Review focus and acceptance
1. Late pre-reset callback: must not settle any new session state (session tests).
2. Edit while save pending and completed duplicate press: retain later draft; no unchanged write (session + component tests).
3. Back/sheet dismissal or width changes: draft and action survive (component tests).
4. Unknown submission/save: no blind retry; receipt resume reads only same job (session + component tests).
5. Metadata absent/null/opaque/history: never invent source text, writable empty note or generated output; history no replay (domain + component tests).

Self-review: bounded to UI/source and JS verification; native-stack needs genuine peers and mocked-runtime tests, not ambient stubs. Missing-content input remains unavailable until explicit text entry, not saved empty by opening. Conflict preserves revision and explains no automatic merge; no new conflict-resolution semantics. Reset requires confirmation and explicitly discards in-memory work. All five review risks have owned checks. Approved to execute under user's delegation.

NOT RUN gates: Android/iPad native builds; device/simulator/accessibility/keyboard/focus acceptance; persistent storage/process death; network/auth/provider/PDF/signing/distribution. Cloud SDKs unverified; user laptop inventory UNKNOWN after pre-launch environment failure. No contact with user computers.

## Execution outcome

Tasks1–3 implemented and locally checked on2026-10-22. The frozen domain/fixture
source was not changed. Added8 session and11 JS component tests; all11 original
core tests still pass. Source-strict tsc uses official RN declarations with the
vendor-required skipLibCheck setting; full vendor declaration trial failed and is
recorded separately. Native/deployment gates above remain NOT RUN.

Product self-review corrected duplicated sidebar/main notebook lists on wide
landing into one index and a calm welcome. Settings remains separate; ambiguous
save/submission outcomes preserve text/action rather than offering a misleading
retry. Public text and empty workspace sources remain visibly distinct. Width and
large-text tests establish state retention only, not rendered-device quality.

## Independent review correction — sidebar safe area

Confirmed the wide sidebar was outside the native header and had no top-inset
owner. It now consumes only the top inset through the vendor hook; the app root's
bottom/left/right edges and native-stack main pane are unchanged. A nonzero44-unit
mocked-inset regression failed before the fix and passes afterwards, also checking
that the root does not acquire top padding. All19 domain/session and12 mocked UI
tests plus both strict source typechecks pass. This asserts source ownership, not
device pixel geometry; all native/device gates remain NOT RUN. Nonblocking review
suggestions are separate from this narrow correction.
