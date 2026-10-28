# StudyWorkbench Product Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close proven draft-safety, scope/search clarity and visual-resilience defects without weakening turn or note-write ownership, then honestly evaluate PM gates.

**Architecture:** Keep the existing Next.js workspace and semantic design system. Add bounded UI transition/request ownership at the consuming components; keep backend contracts unchanged. Four serialized source tasks receive independent reviews, followed by current-build verification and a whole-branch PM/engineering review.

**Tech Stack:** Existing React 19 / Next 16 / TanStack Query / Radix / Tailwind / Vitest; prepared dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-28-workbench-product-gates.md`

## Global Constraints

- Preserve F1 immutable request, synchronous latch, exact target/epoch, conservative unresolved fence, read-only Check and editor generation rules.
- Never auto-submit/retry, expose raw errors, store credentials or call providers/Google; do not change API/database/worker contracts.
- Do not modify the old workspace or actual user files. Use this restored candidate only; no dependency installations.
- New text uses the existing shared workbench English/Chinese locales; all inherited locale keys and interpolation contracts must pass.
- Normal enabled text contrast is at least 4.5:1 for default/hover on its applicable surfaces; disabled states are separately reported.
- At viewport width <=640px or coarse pointer, scoped primary independent controls have at least44×44 CSS px targets; retain fine-pointer desktop density.
- Desktop effective central reading width is at least340px; use existing single-region mode where space cannot support panes.
- Current browser evidence, source math and synthetic tests remain distinct. Never retry denied netlink or weaken isolation. Runtime and Taste installation stay BLOCKED until supported access exists.
- Publication is only to the authorized private branch; no main merge, deployment, CI activation or credentials.

## Review Focus

1. Confirmation shown for draft A must not discard draft B edited or saved while open; Task1 pins session/revision/save state revalidation.
2. A blocked save with unknown outcome must not be erased by a new local action; Task1 pins pending/unknown/conflict/rejected transitions and unchanged comparison evidence.
3. Search response A after source/query change to B must not appear current or be clickable, including A→B→A; Task2 pins action-generation and exact captured inputs, without auto-request.
4. Reading navigation changes are not query-scope changes or selection writes; Task2 pins reading position independently and compact unknown-safe scope summary.
5. Long unbroken citations and maximum side resizing must not squeeze the central reading task; Task4 pins wrapper/constraint semantics, then Task5 measures actual layout rather than treating DOM classes as pixels.

---

### Task1: Protect explicit note-draft transitions

**Files:** Modify `frontend/src/components/workbench/StudyWorkbench.tsx`, `StudyWorkbench.test.tsx`, `frontend/src/lib/locales/workbench.ts`, `CHANGELOG.md`. Create a small `frontend/src/components/workbench/NoteDraftTransitionDialog.tsx` and focused test only if needed to keep the view understandable; use existing AlertDialog, not a new modal framework.

**Interfaces:** Consumes existing editor session/revision refs, saved base in editingNote, `canRetryNoteWrite`, noteSavePending and F1 submitTurn. Produces one guarded entry for New/Edit/Outline; existing submitTurn and completion contracts remain unchanged. Dialog intent includes operation kind, current editor session/revision and target note identity, never closures in global registry.

- [x] Add RED component tests: dirty new note (including title-only), dirty existing note and generated draft are not overwritten by New/Edit/Outline before confirmation; cancel/ESC retains title/content/citations/scope/base; clean empty or unchanged saved notes remain one-click.
- [x] Add RED tests: pending save and unknown/conflict/rejected noteProblem cannot be dismissed by these transitions; comparison snapshot stays intact. Not-sent/auth-rejected keep original retry semantics. Confirmation opened before a new edit, session change or save outcome cannot replace newer content. Repeated confirm does not submit twice.
- [x] Implement precise dirty comparison against saved base and a local intent-bound AlertDialog. Block unsafe save-review transitions with localized reason and existing compare path. On confirm, recheck all state synchronously before any reset/POST; old intent expires safely. Outline confirms before request and preserves old draft until trusted completion; later edits retain existing ownership protection. Keep focus restoration accessible.
- [x] Run GREEN focused component/locale tests and existing note-conflict, recovery, lifecycle tests. Preserve real assertions rather than deleting tests whose old destructive behavior must now confirm explicitly.
- [x] Run full frontend `npm test`, TypeScript and lint; add CHANGELOG entry and commit. Record counts and unresolved runtime coverage for task review.

### Task2: Make current scope and evidence search trustworthy

**Files:** Modify `StudyWorkbench.tsx`, `StudyWorkbench.test.tsx`, `frontend/src/components/evidence/EvidenceReader.tsx`, `EvidenceReader.test.tsx`, `frontend/src/lib/api/evidence.ts` and its adapter tests, `frontend/src/lib/locales/workbench.ts`, `CHANGELOG.md`; create `frontend/src/lib/hooks/use-workbench-evidence-search.ts` and its tests if extraction keeps request ownership cohesive.

**Interfaces:** Consumes current projected selection and existing `evidenceApi.search(query, sourceVersionIds, context?: TurnContext)` with a new optional third parameter forwarded as the existing apiClient `turnContext` config; no server change and ordinary two-argument callers remain compatible. Captured search identity contains notebook, query, local version IDs and live privacy/target context as appropriate; local generation prevents A→B→A response revival. Produces safe current loading/error/empty/results state and an explicit submit action, not automatic query observers.

- [x] Add RED tests for local/remote/unknown engine and origin summary, remote-mode local checkbox explanation with no implicit origin change, exact selected count and unchanged request DTO; visible reading-vs-scope explanation; changing reading position does not select a source.
- [x] Add RED tests for empty query/no selection/remote origin, loading/zero hits/failure, exact query/version capture, scope/query change before and after completion, A→B→A and late responses, privacy invalidation, Enter vs IME composition and repeated click. Old results cannot remain clickable; no automatic request after changes.
- [x] Implement compact engine/origin/count near question with settings access, reusing known-value projectors. Explain reading does not alter scope in Sources without moving configuration out of Settings.
- [x] Bind evidence search result/error to captured request and current generation; pass the captured existing TurnContext through the adapter so a final-send target/privacy change is rejected rather than sending the old query to a new endpoint; clear or mark obsolete results on relevant changes without pretending server cancellation. Keep reading-only position outside scope fingerprint. Group visible search label/input/submit into one compact toolbar; explicit no-results/retry guidance. Do not show raw transport error contents.
- [x] Add RED then GREEN reader tests: filter in document A cannot hide document B or a newly opened citation; zero matching blocks differs from absent extracted text, and explicit Clear restores the current document. Do not change evidence/locator validation.
- [x] Run GREEN focused tests plus Task1/recovery/lifecycle regressions, full frontend tests/types/lint; CHANGELOG and commit for review.

### Task3: Show refresh and selection persistence truthfully

**Files:** Modify `StudyWorkbench.tsx`, its tests, `frontend/src/lib/hooks/use-workbench.ts` and its tests as needed, `frontend/src/lib/api/workbench.ts` and adapter tests, `frontend/src/lib/locales/workbench.ts`, CHANGELOG.

**Interfaces:** Consumes existing useWorkbench query status and useSaveWorkbenchSelection mutation with its existing per-notebook serial scope. Server API contract unchanged. Extend `workbenchApi.saveSelection(notebookId, selection, context?: TurnContext)` internally and forward captured context using existing apiClient config; capture per explicit selection intent before the existing serial queue, rejecting retired target/privacy at final send. Ordinary callers remain compatible. Track latest supported local selection generation and its acknowledged/error state; keep draft separate from cached server selection. Any explicit retry uses latest supported complete selection, never an old failed payload.

- [x] Add RED: existing workspace data followed by failed refresh retains content/draft, exposes a stale/read-failed notice and explicit retry; retry performs workspace GET only and clears notice only after success. Empty initial failure remains separate.
- [x] Add RED: selection/read-position PATCH pending/error/success feedback, rapid A→B with A failure/B success and A success/B failure, same-tick duplicate retry, unsupported selection and authentication/context change; no old outcome mislabels latest draft, no automatic retry or new turn/upload.
- [x] Implement compact localized read failure and selection saving/unconfirmed-save status. Preserve current draft and mutation serialization, recheck latest valid state before explicit retry, retain failure until latest acknowledgement, and distinguish outcome unknown from proven not written. Do not create a second durable selection store or perform hidden synchronization.
- [x] Run GREEN focused hooks/components and all prior task regressions, full frontend tests/types/lint; CHANGELOG and commit for review.

### Task4: Repair readable action tokens and responsive content bounds

**Files:** Modify `frontend/src/app/globals.css`, `frontend/src/components/ui/button.tsx` only for semantic pairing if necessary, `StudyWorkbench.tsx`, `WorkbenchSourcesList.tsx`, `frontend/src/components/layout/AppShell.tsx`, relevant workbench/dialog wrappers, `frontend/src/lib/locales/workbench.ts`, token ADR and CHANGELOG. Add `frontend/src/lib/utils/design-contrast.test.ts` and focused responsive/citation component tests; use existing tests where present.

**Interfaces:** Consumes existing semantic token slots and Task1/2/3 UI. Preserves all callback IDs and request data. Scoped touch selectors must include portal-based workspace dialogs deliberately, not accidentally style every desktop app control. A reusable citation presentation component may accept the existing EvidenceCitation plus click callback; presentation cannot rewrite citation identity or validity.

- [ ] Add RED token math tests resolving actual CSS variables for light/dark primary/default/hover and text action across used surfaces, including related destructive foreground; compute linear sRGB contrast, do not hardcode passing results.
- [ ] Add RED tests for bounded long citation presentation (120-character titles, 128-character unbroken IDs, multiple citations) with accessible full source and unchanged click payload; selected navigation semantics and workspace scoped touch markers; pane width arithmetic at1280/1440 with208px navigation and maximum auxiliary panes.
- [ ] Repair semantic foreground/background/text-action pairing retaining green identity, consistent hover and existing surfaces. Inspect all affected uses; don't darken a token also used as ink without measuring it. Document token-level change, keep design reference coherent.
- [ ] Add phone/coarse-pointer44px hit targets for workspace controls, source labels, navigation opener and associated dialog controls; preserve desktop density and compact Task2 search group. Use neutral selected/pressed navigation variants, not filled action buttons. Keep focus rings and same-row geometry.
- [ ] Bound citation labels to their panel, visually prioritize readable source/short reference description, preserve full accessible source and original identity/locator. Coordinate resizable sidebar maximums to reserve at least340px effective center text (including padding arithmetic); preserve single-region narrow layout.
- [ ] Run focused GREEN, all prior task regressions and full frontend tests/types/lint, update token ADR/CHANGELOG, commit for independent review. CSS/DOM tests are not measured browser pass.

### Task5: Integrated product gate and delivery

**Files:** `docs/v1/PM_UX_AUDIT_2026-10-28.md`, `docs/v1/PROGRESS.md`, a machine-readable gate record; existing isolated browser checks only if supported authorization and environment permit them.

- [ ] Run fresh integrated frontend tests/types/lint and required backend offline/static/OpenAPI checks; run official `npm run build` and separate `build-artifact.mjs --verify` on frozen final source with sanitized environment/local assets.
- [ ] Obtain independent whole-branch review of behavior, design constraints and test evidence. Apply one bounded final fix wave if necessary with scoped re-review; retain explicit rulings for any deferred minor findings.
- [ ] In a supported authorized isolated environment, measure current screenshots/DOM at360/390/768/1024/1280/1440px, light/dark, English/Chinese; run G1–G5 scenarios and current design-token reference. Use test fixtures only. No fallback to unisolated services or old screenshots. If blocked, report exact unmet gate and required user/environment action; do not mark it passed or stop independent authorized fixes.
- [ ] Record Taste installation separately from reference reading; no claim of installed skill unless verified. Publish only source/tests/sanitized gate report to authorized branch with tree/parent lease and readback; no main/deploy/user-data action.

## Self-review

Every confirmed P1/P2 maps to Task1,2,3 or4. Shared StudyWorkbench/locales/CHANGELOG writes are serialized. Task2 must retain Task1 transition entry points; Task4 may change presentation but not callbacks or guards. The five cross-boundary risks above have owning tests. Runtime evidence is required by the spec and cannot be satisfied by source assertions; Task5 explicitly stays blocked if its environment is absent. Unconfirmed visual hypotheses remain in the browser checklist, not a speculative rewrite. User explicitly delegated self-review and execution, so no routine plan-approval pause.
