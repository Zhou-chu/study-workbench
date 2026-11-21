# B9b Advanced source acceptance

Source-only implementation from accepted BASE 2a5d8c1311e9adeb06b84658e17b2c40ebc988d6. Independent review is a separate gate. These 12 operations retain aggregate ownerTask B9; B9a33 + B9b12 = 45/129 source implemented, 84 pending in B9c-e. No browser-verified status is assigned.

| Operation | Mounted control / local action | Producer | Synthetic evidence |
|---|---|---|---|
| `advanced.choose_rebuild_existing_all` | Memory existing/all choice | Local memory | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.include_sources` | Memory sources checkbox | Local memory | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.include_notes` | Memory notes checkbox | Local memory | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.include_insights` | Memory insights checkbox and no-category guard | Local memory | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.start_rebuild` | Explicit frozen global scope/cost confirmation and synchronous latch | POST /api/embeddings/rebuild | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.view_progress` | Exact original acknowledged command; finite explicit observation | GET /api/embeddings/rebuild/{command_id}/status | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.reset_rebuild_form` | Local guarded reset retaining receipt/history and uncertainty | Local memory | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.view_current_version` | API config current version projection | GET /api/config | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.view_latest_version` | Nullable latest version projection | GET /api/config | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.view_update_state` | Latest evidence plus literal hasUpdate | GET /api/config | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `advanced.open_repository_docs` | Static safe repository/documentation link | Explicit external link | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |
| `route.advanced` | Real AdvancedPage at /advanced | Router /advanced | settings.test.tsx B9b cases; advanced.test.ts; route-coverage.test.ts |

Implementation: features/settings/AdvancedPage.tsx, advanced-store.ts and advanced-observer.ts; data/advanced-contracts.ts and the single settings-api.ts; existing registry/navigation resource integration. All paths under apps/web/src unless stated otherwise.

Global rebuild is separate from selected-evidence indexing and original-version reader maintenance. Confirmation discloses possible external processing/cost, worker-time model selection and unpinned destination/price/count. Receipts retain actual total_items (estimate), not estimated_items; status counts submitted child jobs and never proves vector completion.

Typed HTTP409 COMMAND_SUBMISSION_UNKNOWN with retry_safe:false is projected without raw message/detail/error, with optional validated command_id. No-ID uncertainty has no lookup and cannot reset/replay. Valid typed acknowledgement supports only original command reads while retaining its separate unknown warning even after terminal scheduling status. Unsupported/malformed/mismatched/error status stops reads and preserves guards.

One explicit Start acknowledgement or explicit Refresh progress session admits at most12 requests, at least5 seconds apart, over at most60 seconds. Local stop/abort, unmount/readiness loss/retirement/generation replacement stop observation, not remote work. No mount/focus/reconnect resume. No arbitrary jobs, cancellation, idempotency or embedding-provider proof from NotebookLM.

The existing DraftRegistry constructs/subscribes/retires/enumerates Advanced records; the existing navigation owner recognizes their dirty/pending/acknowledged/unknown status. Original retired records remain visible/selectable; explicit blank successor never copies old form or settles uncertainty. Reset is local and retains safe history. Existing notebook settings/source transaction/provider lifetimes are unchanged.

Version information comes from API /api/config through transport path /config, not BFF bootstrap /config. Null/missing latest evidence or missing hasUpdate is unknown; no direct GitHub fetch, install/update/deploy. Repository link is static, activated only by the user.

New copy is explicit in all14 locale registries through typed advancedMessages; inherited legacy labels remain localized. Monochrome primitives, 44px controls and focus/close behavior are retained. Grayscale danger/unknown has border and text, not color alone.

Synthetic source/jsdom evidence does not establish actual390px/desktop/mobile/zoom/pixel/IME/browser acceptance. C2 remains NOT_RUN, as do live provider/rebuild/API/database/worker/security/deployment actions. Existing F29 legacy wire-path limitation remains unchanged.
