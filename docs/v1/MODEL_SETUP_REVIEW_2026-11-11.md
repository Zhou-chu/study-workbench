# Model setup and shared-control verification — 2026-11-11

This is a scoped evidence record, not the authoritative requirements ledger or a claim that all Notebook journeys are accepted. Specification: https://chatgpt.com/space/page_48a624e1d6908191887f55de4294d2d7 . Relevant mappings: CFG02–CFG08, J02–J04 and the settings portion of J12.

## Verified source and integration

Product source: `e59ab1efc3e0a4fcafd000282694ef6b216fe8bd`, based on `9ee810fe30fc3723ff18068d2514abf1212a3130`.

- `f1447de`: read-only setup progress, linked configuration names, conservative check receipts, compact explanatory disclosure and metadata-backed next navigation.
- Original return repair `0ee8d4b` maps to `769986d`; evidence `0c0e114` maps to `6ee0261`.
- Shared header/dialog repair `ba956a0` maps to `e48829c`; conditional-dismiss correction `80b5676` maps to `e59ab1e`.
- Integration conflicts were limited to CHANGELOG entries; both sides were retained. No backend, persistence, credential rebind or default-selection mutation was introduced.

## User-visible changes and retained boundaries

Saving a configuration, registering models, selecting the global chat default and receiving an explicit check result are separate facts. The interface shows the model’s linked configuration. Registering another credential does not silently replace an existing default or repair old associations.

The backend may return `success:true` for rate limits/quota conditions that demonstrate only connectivity. Such receipts now use a neutral title and explicitly state that an actual model response is not confirmed. Private provider response details are not rendered. The meaningless isolated Unknown/None result placeholder was removed.

The primary link uses current, consistent metadata: a specific pending language configuration, an explicit list when several require registration, an existing usable language model’s default selector, or the existing status/add region. Null-linked environment models are not confused with missing credential references. Optional embedding/voice configurations do not force unrelated chat setup. Missing encryption points to the existing blocker rather than a disabled Add action. Navigation sends no provider requests and does not change defaults.

Long general explanations are behind a native disclosure; the current check limitation remains visible. Tools → Models retains the originating route and in-memory question/source selection. Header controls wrap at enlarged text sizes. Escape and Close return focus after normal conditional dialog dismissal, but leaving the route does not steal focus back.

## Verification layers

### Automated source checks

On the integrated source, all workspace checks completed with exit 0 on 2026-11-11 UTC:
- 2,672 Vitest tests: BFF 1,050; web 1,258; contracts 71; domain 235; web transport 58.
- 35 Node tests: BFF 23 and web artifact/PDF gates 12.
- Workspace typecheck and lint.
- Exact commands, times and complete stdout are in `evidence/model-setup-2026-11-11/model-setup-integrated-checks/`.

The raw test logs retain React warning output from existing settings tests; exit 0 is not a claim that stderr is empty. Python/backend suites, CI and live provider tests were not run by this frontend change.

Independent guide review retained the original failures and reran the same probes: 171 focused tests and 15 independent probes passed. Earlier defects included non-language guidance, invalidated status, overclaimed 429 receipts, dangling credential references, disabled Add guidance and the embedding-only recovery path. Shared-dialog review independently passed 8 tests, including a still-connected opener when only the dialog is removed by route departure. The first transient /tmp shared-review log became unavailable; the persistent archive clearly identifies the subsequent independent rerun rather than presenting it as the original log.

### Actual isolated browser interaction with synthetic APIs

Firefox 157.0, disposable contexts, private Vite source preview only. Every API/config response was synthetic; other origins were blocked and audited. This did not access the user’s browser, live service, saved credentials or a provider endpoint.

- Final shared smoke: 11/11, zero failures, zero writes.
- Final matrix: 111/111, zero failures; 96 state-navigation checks across 390/768/1024/1440 and light/dark Chinese layouts.
- 693 visible header-control bounding-box records. The earlier 390/200% theme-button overflow is no longer reproduced.
- Four width/theme keyboard groups verified actual conditionally mounted ModelsPage confirmations: Escape and Close restore the exact Test Model trigger and send no POST.
- Zero page errors, console errors, external HTTP/WebSocket requests or automatic writes. Sixteen synthetic writes were caused only by explicit confirmation steps.
- Eight product-file hashes matched before/after the run. Private preview processes were stopped afterward.

The previous 70-case and 66-case reports retain five shared failures; those failures were not removed to produce the final green result. The source preview is not the production bundle or live backend. 200% checks enlarge computed text; they do not claim native browser zoom, physical mobile keyboard, assistive-technology certification or all J12 tasks passed.

## Visual comparison

The archived before/after pairs use the same fixtures, Chinese fonts, viewport and theme. Before: configuration maintenance and provider controls without a visible default/registration distinction. After: the current default, registration state and explicit next step precede maintenance controls. General explanations are collapsible, while an unconfirmed model response remains visible. Images were inspected, not accepted solely through overflow assertions.

See `evidence/model-setup-2026-11-11/screenshots/`: matched 1440-light and 390-dark pairs, 768 multiple candidates, 1024 neutral receipt, 390 enlarged text and restored keyboard focus. These are synthetic examples, not screenshots of the user’s actual configuration.

## Evidence and reproduction

`evidence/model-setup-2026-11-11/manifest.json` records compressed and original report hashes. JSON reports are gzip-compressed without changing their content. The independent-review tar archives retain original directory structure, source snapshots, probes and logs; unpack into a separate review checkout when reproducing, not over an active user workspace.

The final browser script is preserved as `final-review-e59ab1e.py`. Its original execution location was `.superpowers/sdd/2026-11-10-model-setup-journey/final-review-e59ab1e.py`; restore that path because it resolves the checkout root relatively. It uses the prepared Node, Python/Playwright, Firefox and local QA font assets, and does not install software. Exact parameters are in the final report: `QA_EXPECTED_HEAD=e59ab1efc3e0a4fcafd000282694ef6b216fe8bd`, `QA_WIDTHS=390,768,1024,1440`, port 18865, and the twelve named scenarios. Validate an unused port and source identity before a new run; do not point it at the user service. Fonts are not redistributed in this evidence package.

## Still not established

The user’s actual DeepSeek failure cause, real authentication/connectivity, model invocation, task use, live persistence and restart recovery remain unverified. This frontend does not automatically repair historical model-to-credential associations. It neither rotates nor persists the process-only encryption key.

The old test runtime became unreachable after a WSL reboot; service/data preservation is a separate operation. This evidence does not authorize or prove service restoration, deployment, GitHub publication or user visual approval. Build and deployment status must be reported separately using their own immutable identities. Other migration and red-team findings remain in the authoritative requirements ledger.
