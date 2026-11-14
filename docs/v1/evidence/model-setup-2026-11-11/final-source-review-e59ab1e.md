# Integrated model setup source-preview verification

## Disposition
PASS for the scoped synthetic source-preview checks at product HEAD e59ab1efc3e0a4fcafd000282694ef6b216fe8bd. The five previously reproduced shared UI failures are resolved in this run. This is not built-artifact, deployed-service, real-provider, quota or task-execution acceptance.

Product files were not edited during this verification. All eight recorded product file hashes matched before/after the browser run, the current files, and their git blobs at the exact HEAD. Both private preview processes are stopped. The owner performs the later evidence commit, release build and any live-service checks separately.

## Runs
- Shared smoke: 11 records, exit 0; 2026-11-11T06:38:16.370765+00:00 to 2026-11-11T06:38:45.619303+00:00.
- Full matrix: 111 records, exit 0; 2026-11-11T06:39:23.916958+00:00 to 2026-11-11T06:44:47.630957+00:00.
- Full matrix includes 96 state pages, 8 neutral result dialogs, 3 computed-text enlargements and 4 keyboard journeys.
- Four widths: 390, 768, 1024 and 1440 CSS px. Both light/dark, zh-CN, disposable Firefox 157.0.
- Twelve states: empty; saved/unregistered; registered/no default; existing default and older credential binding; rate-limit-style positive receipt; metadata failure; unknown default write; multiple pending configurations; null-bound environment model with encryption absent; dangling credential reference; encryption blocker; embedding-only model linked to a language-capable saved configuration.
- All 96 primary actions matched the expected readable label and local target; Enter moved actual focus to that target without any automatic non-GET request.
- 693 full-matrix header-control bounding boxes were recorded, with no clipping/outliers. Body/main controls and guide bounds are also recorded. At 390px/200% text, the seven rendered header links/buttons span x=16 through right=374 in both themes.
- In all four real ModelsPage conditionally mounted confirmation dialogs, Escape returned to the original DeepSeek Test Model trigger. Reopening and using the Close button through keyboard activation also returned to that exact trigger. Each cancel journey sent zero POST/PUT/DELETE requests; no isolated dialog wrapper substituted for the actual page.
- The rate-limit-style check remains a synthetic HTTP 200 response with success:true and a rate-limit message, reproducing the backend's lossy success semantics. The UI shows a neutral receipt and keeps model-response uncertainty visible; it does not claim actual invocation success.

## Network and execution boundary
Full matrix: 26,616 audited HTTP requests; 16 explicitly confirmed synthetic writes (8 model tests, 8 unknown default writes). Smoke: 2,128 HTTP requests; zero writes. Both runs: zero automatic writes, other-origin HTTP, nonlocal WebSockets, page errors or console errors.

Every API/config/manifest response is synthetic. Only private Vite ports 18864/18865 were used, and all source/API routing decisions are in report.json. No live port 18770, real backend, provider, credentials or user browser profile was accessed. Private read-only QA fonts were used solely for screenshots and are not part of the product.

## Evidence and reproduction
Runner: final-review-e59ab1e.py.
Runner SHA256: 5affbecbad8e3c3db0f399bcf4bf7cf44a9f9aaa9d408c6adbb442d3587f8f9d.
The tracked original QA script is unchanged. The runner preserves original assertions and adds Close-button focus, full control-bound logs, shared-file hashes, an expected-HEAD guard and parameter logging.

Run with the existing browser Python, from this worktree:
- QA_EXPECTED_HEAD=e59ab1efc3e0a4fcafd000282694ef6b216fe8bd QA_RUN=final-e59ab1e-shared-smoke QA_PORT=18864 QA_WIDTHS=390,1440 QA_SCENARIOS=old_default
- QA_EXPECTED_HEAD=e59ab1efc3e0a4fcafd000282694ef6b216fe8bd QA_RUN=final-e59ab1e-matrix QA_PORT=18865 QA_WIDTHS=390,768,1024,1440 QA_SCENARIOS=empty,saved_unregistered,registered_not_default,old_default,rate_limit_receipt,metadata_failure,unknown_write,multiple_pending,environment_model,dangling_model,encryption_blocker,embedding_only
- Interpreter: /home/USER/study-workbench-deploy-20261107/tools/browser-venv/bin/python
- Script: .superpowers/sdd/2026-11-10-model-setup-journey/final-review-e59ab1e.py

Do not overlap browser QA with full-suite/build activity. Use a new QA_RUN directory for future evidence. Each run includes report.json, exact review-script.py, screenshot-manifest.json and screenshots. The full matrix has 439 screenshots; smoke has 51. final-e59ab1e-evidence-manifest.json binds the reports, script and inspected images to this product HEAD.

## Actual screenshot inspection
The following images were opened and inspected, not just generated:
- visual-qa/final-e59ab1e-shared-smoke/390-light-old_default-text-200-viewport.png
- visual-qa/final-e59ab1e-shared-smoke/390-dark-keyboard-close-restored.png
- visual-qa/final-e59ab1e-shared-smoke/390-light-keyboard-close-button-focus.png
- visual-qa/final-e59ab1e-matrix/390-dark-rate_limit_receipt-modal.png
- visual-qa/final-e59ab1e-matrix/768-dark-multiple_pending-guide.png
- visual-qa/final-e59ab1e-matrix/1024-light-metadata_failure-guide.png
- visual-qa/final-e59ab1e-matrix/1440-light-old_default-viewport.png
- visual-qa/final-e59ab1e-matrix/390-dark-saved_unregistered-viewport.png
Observations: 390/200% header controls now wrap without clipping; the Close focus ring is visible and return focus is on the original model trigger; the neutral result dialog contains no meaningless Unknown/None placeholder; multiple candidates remain explicit; failed metadata remains unknown rather than zero; existing default facts are distinct from new registration guidance. No additional product change was needed.

## Matched original before/after
- 1440 light old-default fixture: original baseline-1440-light-r2/1440-light-old_default-viewport.png versus final-e59ab1e-matrix/1440-light-old_default-viewport.png.
- 390 dark saved/unregistered fixture: original baseline-390-dark/390-dark-saved_unregistered-viewport.png versus final-e59ab1e-matrix/390-dark-saved_unregistered-viewport.png.
Paths are under visual-qa. Full-page siblings are available. Data fixtures, language, injected font, theme and viewport match; the original baseline uses verified original 9ee810 ModelsPage source. The historical smoke/matrix failures are preserved, not replaced or reclassified as passes.

## Not run
Built artifact/runtime identity; live-service availability or persistence; real provider connectivity/generation/quota; actual mobile hardware/soft keyboard; native browser zoom. The 200% check doubles each element's pre-enlargement computed font size and is text enlargement, not browser zoom.
