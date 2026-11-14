# Tools → Models return-path review

- Specification: [Notebook 产品体验红队审查与功能验收规范](https://chatgpt.com/space/page_48a624e1d6908191887f55de4294d2d7), read in full.
- Requirement mapping: CFG05, NB05, J02 (partial component evidence only).
- Defect: SETUP-RETURN-001. Delivery priority P0; severity S2 because ordinary navigation provides a workaround.
- Baseline: 9ee810fe30fc3723ff18068d2514abf1212a3130.
- Code fix: 0ee8d4b734c0b7d46cc1e8ee4f56049d75f51859.
- Environment: DESKTOP-UQ2EMAP, Ubuntu WSL, Node 24.19.0; jsdom mounted application routes with synthetic fetch responses. No browser/viewport or external provider acceptance.

## Reproduction and root cause

From a notebook, type a question, expand a source and select another version, then use Tools → Settings → Models. Cancel the unsaved-navigation prompt once, then explicitly leave. Expected: Models offers Back to the original notebook including query/hash. Baseline actual: no Back link. NotebookShell used react-router Link, whereas the existing SetupLink supplies the validated setupReturnTo state needed by SetupReturnLink.

Three pre-fix cases failed at the missing Back link. The minimal fix uses SetupLink only for this Models destination. It does not alter draft ownership, source selection, guarded navigation, provider/default configuration or credential handling.

## Reverification

The three mounted journeys now pass:
1. Cancel configuration and return.
2. Save configuration through a synthetic success response and return.
3. Receive synthetic HTTP 422, cancel the form, explicitly choose Keep work and continue, then return.

Each verifies unchanged question text, both selected source versions, exact notebook/query/hash, and no automatic provider-test/discovery/turn submission. Cancel sends zero POSTs; the two save attempts send exactly one explicit POST each. This proves same-session component behavior, not persistent storage or real model use.

Adjacent safe-return tests cover nested settings navigation, explicit podcast return targets and rejection of unsafe/irrelevant return URLs. Independent review reran these plus the three journeys: 12 passed, no blocker identified. Another adjacent rerun including classic references passed 20 tests.

## Verification and retained failures

- Baseline focused checks: 69 passed.
- Red: 3 failed at missing Back; green: 3 passed.
- Final root npm test: exit 0; 2651 tests passed across workspaces (1050 BFF, 1202 web, 71 contracts, 235 domain, 58 transport, 35 script tests).
- Root npm run typecheck: passed.
- Root npm run lint: passed.
- Root npm run build on the clean code-fix commit: passed BFF/Web source/artifact gates; large-chunk warning remains. No listener/runtime gate was run.
- Initial full test attempt lacked the ignored test scratch directory and failed five PDF asset script cases. Creating that isolated scratch directory addressed the environment precondition.
- The next full run had one 5000ms timeout: classic-reference.test.tsx, “opens full typed source, note and insight alias references through supported reads, with detached notes read-only”. It passed independently in 1291ms, and the final complete suite passed without changing that test or increasing its timeout.
- Initial added-test type errors from unsupported exact role-selector options were corrected, then typecheck passed. Initial build correctly required a clean committed source; the clean-commit build passed.

Evidence logs are under [evidence/setup-return-2026-11-11](evidence/setup-return-2026-11-11/). They contain synthetic fixtures only.

## Remaining acceptance boundaries

Real Windows browser interaction remains stopped under the existing URL-identification restriction. No alternative browser/session was used to bypass it. No live credentials, data, service, nginx configuration or runtime processes were changed. No push, merge or deployment was performed.

J02 remains unaccepted end to end: actual model configuration, verification, continued question and single real task require separately authorized real-service evidence. J03's 24-provider real interaction matrix and J12 visual/keyboard/viewport evidence remain separate. There is no new visual before/after screenshot. Unsaved drafts after refresh/force quit are outside the specification's persistence promise; this fix only preserves same-session navigation behavior.
