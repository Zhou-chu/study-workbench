# Notebook settings control repair

## Confirmed defects and changes

- Credential Add depended on model/default reads unrelated to creating credentials. The create gate now requires current provider and credential metadata plus encryption/setup readiness; full destructive/default gates remain unchanged.
- Invalid credential forms silently returned and erased unsent private fields. Preflight validation now gives actionable field-label-only feedback, keeps unsent input, and focuses/scrolls the error into view. Dispatched, cancelled and retired private inputs retain clearing safeguards.
- Model/search configuration prompts link directly to settings and carry a validated local return route. Podcast profile and generation entry points restore the appropriate tab/workflow; reopening a profile editor is not promised.

## Verification

- Red-to-green focused regressions: 110 tests, including all 24 registry providers with fake success/error POST responses, prerequisite failures, encryption blocking, unrelated metadata failures, invalid fields and focus.
- Full Vitest run: 85 files, 1199 tests pass using `vitest run --maxWorkers=2`. Earlier concurrent browser/test execution produced two timing failures; the controlled full rerun passed without increasing timeouts.
- TypeScript, ESLint and whitespace checks pass. Existing 12 Node artifact-script tests passed in the full npm test invocation.
- `apps/web/scripts/settings-controls-review.py`: isolated headless Firefox, 24 screenshots across 1440/390 widths, light/dark and six states. Zero page errors, horizontal overflow or external requests. Four fake POSTs were intercepted locally. The mobile offscreen-error defect found during visual inspection was corrected and rechecked with focus/in-viewport assertions.
- Independent read-only code review found no security/critical blocker. Its podcast-return finding was corrected; validation-focus follow-up reviewed without new blocker.

## Evidence boundaries and operation safety

All interaction/API tests are synthetic. No real provider request, user credential, user browser/profile or authenticated live-backend interaction was used. The actual failing request in the user's reported session remains unknown: existing access logging was disabled and no authenticated diagnostic request was made. A successful build or served-byte check does not establish that user's browser acceptance.

Only a new static frontend release may be staged by the existing service owner after this review. Preserve the current backend processes, sessions, data, auth rules, rollback slots and encryption key. The test runtime's credential key is process-only: rebuilding that runtime may leave saved credentials undecryptable. Do not persist/change it or restart the backend as part of this UI repair. Long-term credential retention needs a separately authorized stable-key setup.
