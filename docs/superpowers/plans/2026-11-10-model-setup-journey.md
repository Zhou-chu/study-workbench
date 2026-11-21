# Model Setup Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** Make credential-to-usable-chat setup explicit without automatically testing or changing user configuration.
**Architecture:** Read-only overview derived from the existing configuration row, with existing captured actions reused for next steps. Keep mutation safety and secret custody unchanged.
**Tech Stack:** React, TypeScript, React Router, existing Vitest/UI harness.
**Spec:** docs/superpowers/specs/2026-11-10-model-setup-journey-design.md

## Global Constraints
No real provider requests; no key reads; no automatic default/relink; no frozen/live writes. Preserve encryption/session/unknown-write guards. Independent audit owns NotebookShell and return-journey tests.

## Review Focus
- Existing other-provider chat default must remain visible and unchanged after new DeepSeek credential save.
- Missing/loading/error metadata must not claim setup absent or ready.
- Multiple credentials and a model bound to an older credential must be understandable without reassignment.
- Unbound/unknown credential references must not silently imply the new key is used.
- Displaying guidance must make no test/discover/register/default requests automatically.

## Task 1: Configuration overview and next-step feedback
Files: ModelsPage.tsx, a focused ModelSetupGuide.tsx if useful, model-setup-messages.ts, model-setup-journey.test.tsx. Existing CredentialEditor may be changed only if needed for safe saved-state feedback.
- [x] Add failing UI tests for saved DeepSeek credential + no registered model, preserved old default, linked/unbound credential names, source error states, zero automatic provider/mutation calls.
- [x] Run tests and record expected red before production edits.
- [x] Implement typed read-only guide using current providers/credentials/models/defaults phases; wire explicit existing actions only. Keep all old controls accessible.
- [x] Run new tests plus configuration suites, typecheck and lint. Add changelog entry.
- [x] Review code independently; review desktop/mobile light/dark rendering with synthetic data, marked as such.
- [ ] Run full suite with maxWorkers2 separately from browser QA, then commit. Do not deploy from this worktree.


## Task 2: State-aware read-only primary navigation (visual S2)
Approved during review on 2026-11-10. Preserve the matrix screenshots as red evidence: the saved-but-unregistered state currently sends the first action to an empty chat selector.
- [x] Add and observe failing navigation tests before source changes.
- [x] With complete current metadata, prioritize verified zero-linked language credentials. Link a single candidate directly to its named credential area; link multiple candidates to an explicit list rather than choosing a provider.
- [x] Otherwise, registered language models (including environment/unbound models) can lead to chat defaults. Only an absence of both language models and language credentials leads to adding a chat configuration.
- [x] Missing, inconsistent, retired, session-suspended, setup-unready or write-locked metadata offers safe status viewing only. Non-language credentials do not displace the chat path.
- [x] All links are local and keyboard-focusable. Credential anchors use safe encoded IDs; raw IDs are not displayed. No automatic discovery, test, relink, refresh or default update.
- [x] Repeat focused/type/lint verification and independent review, then affected synthetic visual scenarios including multiple pending credentials and keyless environment models.
- [ ] Parent owns the integrated full-suite check, commits and deployment decisions.

### Verification status, 2026-11-10T19:24:54Z
Task 1 review was completed, not fully accepted: initial visual matrix retains shared header/focus failures plus the primary-navigation S2 now addressed by Task 2. Task 2 focused tests (166), typecheck/lint/diff-check pass; independent review and affected rendering remain pending. Parent retains full-suite/integration/commit ownership.

### Independent navigation boundary correction
Review reproduced three additional boundaries. Null-bound environment language models remain valid configuration choices without saved keys or encryption setup. A non-null missing/mismatched/decryption-failed credential reference is unknown, not an environment model. Empty configurations require encryption setup before the Add action can be offered as a next step. Only when there are no registered language models globally may a consistent language-capable credential with non-language models already linked be offered for additional registration; an existing language model must not force every multipurpose credential to register chat again.
Local RED: 3/49. Local GREEN: 171 focused, typecheck/lint/diff-check; freeze 2026-11-10T19:32:43Z. Independent re-review and affected visual checks remain pending.

### Scoped verification complete, 2026-11-11
Independent re-review: 171 focused + unchanged 15 probes passed, all three prior failures resolved. Affected synthetic Firefox QA produced 66 records and 56 passing primary-navigation checks across four widths and both themes; no page errors, console errors, external requests or automatic writes. Five shared header/dialog-focus checks still fail and remain separately assigned. See .superpowers/sdd/2026-11-10-model-setup-journey/visual-review.md. Parent-owned integrated full-suite/build/commit/deployment gates remain unchecked.
