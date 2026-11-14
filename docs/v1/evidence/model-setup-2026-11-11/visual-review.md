# Model setup visual review

## Current integrated result
The later e59ab1e source-preview verification passes shared smoke 11/11 and full matrix 111/111. All five historical shared UI failures are resolved in that synthetic run. See final-source-review-e59ab1e.md and final-e59ab1e-evidence-manifest.json for exact hashes, commands, screenshots and remaining built/live limitations. Earlier sections below retain the historical failures and their original scope.

## Scope and evidence boundaries
This review uses a disposable Firefox 157.0 profile and a private Vite source preview. All configuration, manifest, capability and API replies are synthetic. Every HTTP request is recorded; other origins are blocked. The browser does not visit live port 18770, use a user profile, read real credentials or invoke a provider.

The completed initial matrix used the source frozen at 2026-11-10T19:08:52Z. The subsequent state-aware-navigation fix is frozen at 2026-11-10T19:32:43Z after three independent boundary failures were fixed, and its affected visual rerun is reported below. Neither pass is live/deployment or real-provider acceptance.

## Initial matrix
- Directory: visual-qa/matrix.
- 390/768/1024/1440 CSS px; light/dark; zh-CN; seven synthetic states (empty, saved/unregistered, registered/no default, old bound model with new credential, positive rate-limit-style receipt, metadata failure, unknown default write).
- 70 records: 56 state pages, 8 result dialogs, 2 computed-text enlargements and 4 keyboard journeys.
- 15,976 audited HTTP requests; no other-origin requests, page errors or console errors.
- 16 explicit synthetic non-GET requests: one confirmed test and one confirmed unknown-default-write fixture per size/theme pair. No automatic provider or mutation requests.
- Source hashes unchanged; owned preview process stopped.
- Exit 1, not full acceptance: one 390px/200%-text header clipping finding and four dialog Escape focus-restoration failures. These are shared AppChrome/LibraryDialog findings assigned to another worktree. No document-wide overflow in any case; visible-control bounding boxes still exposed the header clipping.
- Additional visual S2: saved/unregistered primary action went to the chat-default selector. Parent approved state-aware navigation, which has RED/GREEN tests but is not credited as visually verified in this initial matrix.

## Matched original baseline
Both baseline runs use original git 9ee810 product source in a temporary copy within this worktree. ModelsPage bytes were verified equal to git show 9ee810. Dependency links target only this new worktree; Vite cache is isolated in the QA output.
- visual-qa/baseline-1440-light-r2: old-default fixture, 1440×1000, light, zh-CN.
- visual-qa/baseline-390-dark: saved/unregistered fixture, 390×844, dark, zh-CN.
- Each run: 1 case, 263 HTTP requests, zero failures/page errors/external requests/non-GET.
- Compare with same-named viewport/full screenshots in visual-qa/matrix. Fixtures, typography injection, viewport, language, theme and page state match.
- Original baseline exposes provider controls but not separate saved/registered/default/validation facts or readable model credential links. Revised overview makes these facts visible and keeps generic explanation closed. The primary-navigation problem was retained as a red observation rather than ignored.

## Screenshot inspection
Actual image views completed for:
- matrix/390-light-saved_unregistered-guide.png: readable compact fact grid, two navigation actions and collapsed explanation; wrong primary destination recorded.
- matrix/390-light-rate_limit_receipt-modal.png: neutral receipt title, model-response limitation visible, no meaningless Unknown/None placeholder or raw response.
- matrix/1440-light-old_default-viewport.png: current OpenAI default is explicit; the new credential does not imply a switch.
- matrix/768-dark-metadata_failure-guide.png: unavailable model/default information says unknown/could not load, not zero.
- matrix/1024-dark-old_default-bindings.png: old DeepSeek credential association is readable and distinct from the saved new credential.
- matrix/390-light-old_default-text-200-viewport.png: confirms clipped shared theme controls even without document overflow.
- baseline-390-dark and baseline-1440-light-r2 viewport screenshots: original state/viewport comparisons.
Parent separately inspected 390 dark saved/unregistered and prior smoke images. Final affected rerun inspection will be added after independent code review.

## Prior harness attempts retained
- initial visual-qa/report.json: incorrect synthetic client-capabilities path; harness failure, not product result.
- smoke02: exact-label locator mismatch; preserved failures.
- smoke03: corrected role locator; shared header/focus failures reproduced.
- Initial baseline-1440-light: missing tsconfig.base.json in temporary baseline extraction. Preserved log/FAIL screenshot; fixed only the QA extraction, then baseline-1440-light-r2 passed.
- One baseline startup on port 18864 failed closed with address-in-use immediately after matrix shutdown. ss showed no listening process; subsequent runs used checked-free ports 18866/18867. No unrelated process was stopped.
- Shared-control worker full-suite briefly overlapped the initial matrix before exclusive-window coordination; no matrix timeouts occurred. That worker subsequently released resources. Later affected visual verification is scheduled serially after reviewer tests.

## Reproduction
From the worktree, use its browser Python:
 /home/USER/study-workbench-deploy-20261107/tools/browser-venv/bin/python apps/web/scripts/model-setup-journey-review.py

Environment selectors: QA_RUN (separate evidence directory), QA_WIDTHS, QA_THEMES, QA_SCENARIOS, QA_PORT (defaults 18864; fail closed if occupied), QA_BASELINE=1 for original baseline, QA_KEYBOARD=0 to skip duplicate keyboard journeys. Do not overlap with full-suite/build activity.

Every completed run contains report.json with URL decisions, WebSocket origin audit, state metrics and hashes; screenshot-manifest.json lists PNG hashes. Full-page and viewport screenshots are primary evidence. Oversized Firefox locator screenshots were found to mispaint an offscreen skip-link, so the harness does not capture guide elements taller than the viewport.

## Not run
Real provider connectivity, billing/quota or model generation; persistence on a live service; actual mobile hardware/soft keyboard; native browser zoom. The 200% check doubles every element's pre-enlargement computed font size and is explicitly text enlargement, not browser zoom.

## Resume verification on 2026-11-11
The desktop WSL environment was available. There were no model-setup QA, Vitest or Firefox processes and no listeners on ports 18864–18867. Current five source/test hashes match the independent post-fix snapshot. The reviewer confirmed that 171 focused tests and the unchanged 15 independent probes completed successfully, with all three prior failures resolved; no redundant rerun was performed.

Affected QA will cover all navigation branches at 390/1440 in both themes, plus long single/multiple configuration names at 768/1024 in both themes. The additional fixtures are multiple_pending, environment_model (encryption false), dangling_model, encryption_blocker and embedding_only. The script checks each primary link's text, local target, actual keyboard focus and zero automatic non-GET requests. Shared focus/header defects remain expected failures until a separately reviewed integration is present.


## Pre-integration affected navigation rerun (2026-11-11)
- navigation-extremes: 390/1440 × light/dark × 12 states, plus four result dialogs, two 200% computed-text captures and four keyboard journeys. 58 records; 13,840 audited HTTP requests; 8 explicitly confirmed synthetic writes.
- navigation-middle: 768/1024 × light/dark × saved_unregistered/multiple_pending. 8 records; 2,128 HTTP requests; zero writes.
- Combined: 66 records and 56 successful primary-navigation checks. Each checked the expected readable action, local target, actual Enter-key focus and zero automatic non-GET requests. No document-wide overflow, page errors, console errors, other-origin HTTP or nonlocal WebSocket events.
- Source files remained unchanged throughout both runs and still match all five hashes in the independent 171+15 post-fix snapshot. Both owned preview processes stopped; ports 18864/18865 have no listeners.
- navigation-extremes exits 1 solely for the five retained shared failures: one 390/200%-text header-control clipping finding and four dialog Escape focus-restoration failures. navigation-middle exits 0. The combined shell's exit 0 is not used to hide the first run's failures.
- Current guide behavior and its local navigation pass the scoped synthetic checks. Full J12 acceptance is still blocked by the independently owned shared fixes. No new provider/configuration mutations, source changes, commits, builds or deployments occurred during QA.

Actual views after the final freeze:
1. navigation-extremes/390-light-saved_unregistered-guide.png: named next step wraps without clipping.
2. navigation-extremes/390-light-saved_unregistered-primary-target.png: focus lands on the named saved configuration and Discover Models is visible.
3. navigation-extremes/390-light-multiple_pending-guide.png: two explicit candidates, no guessed provider.
4. navigation-extremes/390-dark-environment_model-guide.png: zero saved configurations does not prevent choosing the registered environment-backed chat model; encryption is false in this fixture.
5. navigation-extremes/390-light-embedding_only-primary-target.png: existing multipurpose credential exposes the discovery action while only embedding is registered.
6. navigation-extremes/1440-light-old_default-viewport.png: old global OpenAI default remains explicit while the new DeepSeek configuration is directed to registration.
7. navigation-middle/768-light-multiple_pending-guide.png and 1024-dark-saved_unregistered-guide.png: middle widths retain readable action/list hierarchy.
8. navigation-extremes/390-dark-saved_unregistered-viewport.png: exact final-after match for the 390 dark original baseline.
9. navigation-extremes/390-dark-rate_limit_receipt-guide.png: neutral receipt and “model response not confirmed” stay outside the closed disclosure; the test target is visibly distinct from the global default.
10. navigation-extremes/390-light-old_default-text-200-full.png: guide, long names, controls and text reflow without horizontal document overflow; shared clipped theme controls are visible at the top. No oversized-locator skip-link artifact appears.

### Exact final before/after pairs
- Before: baseline-1440-light-r2/1440-light-old_default-viewport.png; after: navigation-extremes/1440-light-old_default-viewport.png. Full-page siblings available.
- Before: baseline-390-dark/390-dark-saved_unregistered-viewport.png; after: navigation-extremes/390-dark-saved_unregistered-viewport.png. Full-page siblings available.
Both pairs retain identical synthetic content, language, font injection, theme and viewport.

### Reproduce affected cases
Use the browser Python path above, with:
- QA_RUN=navigation-extremes QA_PORT=18864 QA_WIDTHS=390,1440 QA_SCENARIOS=empty,saved_unregistered,registered_not_default,old_default,rate_limit_receipt,metadata_failure,unknown_write,multiple_pending,environment_model,dangling_model,encryption_blocker,embedding_only
- Then QA_RUN=navigation-middle QA_PORT=18865 QA_WIDTHS=768,1024 QA_SCENARIOS=saved_unregistered,multiple_pending

Each final run preserves its exact review-script.py and its hash in report.json, plus screenshot-manifest.json. Do not overwrite prior run directories when testing a later integration. For the shared header/focus correction, a new run with old_default at 390/1440 in both themes will repeat the two text-enlargement and four keyboard scenarios without provider calls.
