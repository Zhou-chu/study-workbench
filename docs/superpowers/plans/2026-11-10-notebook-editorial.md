# Notebook Editorial Implementation Plan
> Execute in the isolated redesign worktree; preserve existing stores and transport.

**Goal:** Replace control stacking with a focused, monochrome research workspace.
**Architecture:** Structural React presentation changes over unchanged feature stores/API. Shared semantic CSS tokens retain theme and responsive support.
**Tech Stack:** React 19, Vite, TypeScript, Vitest.
**Spec:** ../specs/2026-11-10-notebook-editorial-design.md

## Global Constraints
No live application, backend, auth, data or credential changes.
No raw protocol fields in the normal interface.
Keep drafts mounted, action gating and explicit recovery.

## Review Focus
- Long titles and narrow screens: wrap without document overflow.
- Pending/unknown operations: do not imply completion or enable replay.
- Tab/reader switching: retain drafts and input state.
- Notes containing actual code: preserve user-authored content.
- Disabled providers and disconnected state: explain blockers without fabricating readiness.

## Tasks
- [ ] Add failing presentation tests for human-readable results and unknown status.
- [ ] Rebuild global/notebook hierarchy and focused responsive workspace.
- [ ] Refactor notes/results to meaningful outputs and secondary creation controls; remove protocol payloads.
- [ ] Polish shared primitives and home/library/settings rhythm.
- [ ] Run complete regression suite, types, lint and build.
- [ ] Capture synthetic isolated app screenshots in both themes and viewport sizes, inspect and iterate.
- [ ] Document evidence and known limits; commit without deployment.
