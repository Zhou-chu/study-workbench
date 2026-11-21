# Notebook redesign interface pre-flight review

Date: 2026-11-08 UTC. Scope: approved design plus foundation/web/delivery/umbrella plans, checked against the supplied read-only 91a92fa source reference. No implementation, installation, services, tests, production changes, or credential reads were performed. Only this new review document was written.

Plan abbreviations: F = foundation, W = web, D = delivery, U = umbrella. Source paths are repository-relative under /home/zhouchu/study-workbench-deploy-20261107/source.

## Verdict and gates

The approved architecture and visual design do not need reopening. Concrete producer/consumer and ownership conflicts need the small rulings below.

Before A1 begins, record F1 recovery projection/receipt semantics and F2 contracts export ownership. The parent has separately confirmed a recoverable isolated baseline and real Cookie regression RED/GREEN. This reviewer did not run that validation.

All other findings are gates for the affected later task, not reasons to delay nonconflicting A1 work. The parent has already indicated: delay B1 until A4; explicitly list/stage RuntimeConfig contracts changes in A2; solve old-tab compatibility with a real compatibility window or bridge, not documentation alone.

## Task-by-task consistency table

| Task | Step/interface consistency | Actual conflict or missing handoff | Smallest ruling / gate |
| --- | --- | --- | --- |
| A1 | RED/GREEN/commit structure, pure projector signatures, and authenticated capabilities agree. | F1: minimal OperationReceipt is not full turn POST/recovery evidence; JobView/TurnView field lists do not freeze existing reconciliation inputs. F2: consumers require A1 write DTO exports not explicitly in its output list. | Freeze F1/F2 before A1. Preserve snake_case, null/absence and old workspace behavior; history/unknown branches remain non-actionable. |
| A2 | Handler/server signatures agree; no auto-listen; HTTP parity tests are appropriate. | F3: RuntimeConfig belongs in contracts, but Files and Step 5 stage only apps/bff. F9: new workspace registration changes root lock. | List/stage RuntimeConfig type/export/tests and any reviewed root lock change in A2. Gate: A2. |
| A3 | Streaming, multipart, abort, two-hop refresh, redirect and Cookie tests agree. | F5: BFF classifier cannot see Cloudflare challenges intercepted before BFF; browser cannot import apps/bff. | A4 owns browser-visible classification/error surface; A3 tests its actual BFF hop. Gate: A4/B2. |
| A4 | DispatchContext exactly matches current TurnContext/TurnTarget; generation check remains necessary. | Consumes F1/F3; browser ingress classification needs ownership (F5); root lock (F9). | Migrate existing reducer/reconciliation invariants, branded local not-sent evidence and final pre-fetch check. Freeze reducer/event/export shapes before UI consumers. |
| B1 | Theme/layout/locale interfaces and tests agree internally. | F4: U schedules B1 after A1, but renderApp consumes WebTransport produced by A4, so advertised standalone typecheck/build cannot pass earlier. | Parent intended ruling: B1 after A4, no temporary fake transport. Apply F9. |
| B2 | Reauth overlay, File retention, navigation and BFF+API handshake agree. | F6: Step 1 storage-only-appearance test conflicts with preserving current legacy auth-storage lifecycle. Also consumes F5. | Ban new credential storage/copies; retain scoped existing legacy adapter only. Device mode persists no credential. Gate: B2. |
| B3 | Notebook API, route inventory and pending/implemented/verified states agree. | No intrinsic conflict. Router/locales/coverage are shared files. NotebookSummary must be exported or feature-local, not an undefined import. | Preserve current IDs/times. Inventory is not completed coverage. |
| B4 | Upload response matches existing API; explicit context, unknown same-key handling and read/select separation agree. | F7b: SourceReadIntent is not B6 ReaderIntent; adapter ownership is absent. | B6 owns an explicit source-read adapter capturing notebook/context/generation and resolving authoritative version/extraction. Gate: B4/B6 integration. |
| B5 | Turn/list/events/job/cancel endpoints and single observer semantics match existing API. | F1 minimal receipt drops typed dispatch/HTTP evidence. F7a onCitation(reference) drops turnId/focusKey required by B6. | Operation-specific turn outcome; citation event includes origin {turnId,focusKey}. Gate: B5. |
| B6 | ReaderPane, physical page indexing, late-locator retirement and protected PDF resources agree. | Consumes F7a/F7b; no further intrinsic conflict. | B6 owns ReaderIntent constructors/adapters; manual page change wins; read never writes selection. |
| B7 | Conditional note DTOs correctly use expected_revision in payload. | F8: all-writes-idempotency-key requirement conflicts with actual note create/update DTO/server; create has no key. F2 contracts exports required. | Preserve wire; distinguish local operation identity from server idempotency. Unknown create/save-answer stays check-only, no invented key guarantees. Gate: B7. |
| B8 | Library/search/source-chat/podcast coverage and classic-source handling agree. | No intrinsic conflict. Shared router/locales/coverage with B3/B9/C2. | One integrator; do not blanket downgrade supported classic operations. |
| B9 | Settings DTO reuse, credential exclusion and denied models GET agree. | No intrinsic conflict. Shared router/locales/coverage. | Preserve real manual connection state, no device activation here. |
| C1 | Artifact verification/compatibility signatures and separate Docker gates agree. | F10: new SPA handshake does not retrofit old Next bundles/already-loaded pages; runtime refresh/revalidation owner absent. | Explicit backward-compatible first-cutover window, tested old loaded clients, fresh compatibility before incompatible writes. Gate: C1 acceptance. |
| C2 | Fixture-only isolation, process ownership, browser matrix and not_run/blocked reporting agree. | No separate signature conflict. Must exercise corrected F1/F5/F6/F7/F8/F10. | Keep real browser/Docker/provider outcomes distinct; this review ran no tests. |
| C3 | Dry-run-only CLI, authorization and rollback boundaries agree. | F10: old-tabs-freeze-after-handshake promise has no producer for current legacy bundle. | Real compatible window or actual bridge/update/drain. Otherwise cutover blocked, not A1. |

## Shared producer-to-consumer and file table

| Producer -> consumer | Interface/files | Finding / minimal ruling |
| --- | --- | --- |
| A1 -> A4/B5 | JobView, TurnView, parseJobView/parseTurnView, operation.ts | F1, A1 gate. Preserve typed recovery evidence below; generic OperationReceipt is only a local handle. |
| A1 -> B5/B7 | TurnRequest, CreateWorkbenchNoteInput, UpdateWorkbenchNoteInput, WorkbenchNote; scope/citation/provenance/source-snapshot dependencies | F2, A1 scope gate. Explicitly migrate/export existing DTOs with consumer compile tests. Read NoteView is not a write receipt. No invented fields. |
| A1 -> B2/B4/B7/C1 | ClientCapabilitiesV1 / PortableLimitsPublic | No conflict. Exact public portable keys come from get_portable_limits().public(). Authenticated API capability cannot be replaced by BFF self-report. |
| A2 -> A4/B2/C1 | RuntimeConfig in packages/contracts | F3. Add exact files/export/tests to A2 Files and Step 5. No separate camelCase wire DTO in consumers. |
| A4 -> B1 | WebTransport in renderApp | F4. B1 dependency becomes A4. |
| A3 -> A4 -> B2 | classifyIngressResponse / ingress-auth outcome | F5. Browser adapter classifies visible HTML/unexpected responses. redirect:error rejection does not expose external Location or prove ingress auth. Conservative unavailable/reauth guidance; no app logout or mutation replay. |
| A4 -> B2 | auth-storage / appearance preference | F6. Existing legacy key is a scoped exception. No additional credential locations/copies; device still purges legacy storage. |
| B5 -> B6 | onCitation vs openCitation(citation, origin) | F7a. Pass onCitation(reference, {turnId,focusKey}); citation_id may repeat and cannot identify its message. |
| B4 -> B6 | SourceReadIntent -> ReaderIntent | F7b. B6 declares/exports conversion and captures target/generation; source read is not a citation or selection mutation. |
| A1/A4 -> B7 | note DTO / OperationModel | F8. Local UUID coordinates UI only. Server create lacks idempotency; update uses revision; unknown remains check-only. |
| A1 -> A2/A4/B1 -> C1 | root package-lock.json | F9. Package additions require root lock registration/dependency updates. One integrator; explicitly stage reviewed root lock in each introducing commit. Later Step 5 commands currently omit it. Do not silently change frontend lock. |
| B1/B2/B3/B8/B9/C1 -> C2 | providers/router/locales/route-coverage.ts/SPA_ROUTE_COVERAGE.md/CHANGELOG | Coordination gate, not new design conflict. One integrator/reservations for shared edits. Only C2 marks verified after real evidence. |
| C1 -> C3 / existing clients | compatibility + old config cache | F10. Current Next config ignores new protocol/contract metadata and caches successful config until explicit reset. A new handshake cannot change already-loaded code. |

## A1 hard ruling F1: required recovery evidence

### Authoritative current sources

- frontend/src/lib/workbench/turn-reconciliation.ts:13-40: exact POST receipt validation and HTTP outcome.
- Same file:51-60: request allowlist/defaults; 62-90: identity/success/scope/citation validation; 96-170: read-only reconciliation.
- frontend/src/lib/workbench/turn-operations.ts:7-43: frozen capture, bounded registry, separate stable receipt and SafePostOutcome.
- api/personal_service.py:96-156: parent identity, request snapshot, dispatch-unknown receipt.
- api/personal_contracts.py:121-153: turn submission, generated receipt, HTTP 400 WORKER_UNAVAILABLE; 162-219: live/historical job branches.
- frontend/src/lib/workbench/turn-context.ts: RETRIEVAL_FIELDS and validRetrievalOptions.
- Regression sources: frontend/src/lib/workbench/turn-reconciliation.test.ts and turn-operations.test.ts.

Display-only TurnRecord in frontend/src/lib/types/personal.ts:174-188 does NOT declare all identity/proof fields read by reconciliation. Merely migrating that interface would lose them.

### Minimum explicitly allowlisted read projection

This list is not permission to publish raw request_snapshot/result/error/extensions.

1. Workspace identity: notebook.id; jobs; separately obtained canonical /personal/chats/{id}/turns history. Current reconciliation never substitutes workspace.turns for canonical history.

2. Parent job: operation, job_id, turn_id, notebook_id, chat_session_id, idempotency_key; state, optional status, submission_state, restored_history, replay_allowed, dispatch_receipt validity. Preserve collisions/unidentifiable rows as non-actionable evidence rather than silently dropping them. Restored history remains distinct/non-replayable.

3. request_snapshot known fields: notebook_id, engine, message, selection_origin, source_version_ids, remote_notebook_id, remote_source_ids, idempotency_key, model_id, task, retrieval_mode, embedding_profile_id, acknowledge_query_processing, disclosed_profile_fingerprint, destination_descriptor_version.

4. Both canonical turn and parent's CHAT result: turn_id, notebook_id, chat_session_id, engine, message, optional idempotency_key; status, optional state/generation_status; answer, scope_snapshot, citations, optional retrieval_request/retrieval. A Google result.job_id may be child ID and must never replace top-level parent binding.

5. Scope proof fields: engine, selection_origin, source_version_ids, remote_source_ids, remote_notebook_id, optional scope_hash. Preserve array order and null/absence distinctions. Global wire projection must not normalize documented request defaults.

6. Citation proof: citation_id, kind, quote, reference_validity, source_version_id, evidence_id, source_title; optional independent_support, remote_reference, locator and valid provenance/derived lineage. Known locator members: page_index, page_label, block_id, start_offset, end_offset, bbox. Nullable independent_support is metadata, never independent corroboration proof. Nested remote_reference/provenance get their own reviewed allowlists/non-actionable unknown branches, not arbitrary spreading.

7. Retrieval proof: exact five request fields named above. Known current TurnRetrieval response fields: requested_method, retrieval_method, fallback_reason, profile_id, indexed_version_count, selected_version_count, warnings. Preserve omission/null. Result/history retrieval equality must not hide disagreements by stripping fields before validation.

8. Other operations get separately reviewed result variants (upload/source/artifact etc.), not a generic chat result. Internal paths, raw provider errors, credentials and arbitrary unknown extensions are excluded.

### Receipt and non-actionability semantics

- Keep OperationReceipt = {job_id, turn_id?, state?} as a MINIMAL generic handle only. A4/B5 must use a separate operation-specific safe turn POST outcome preserving the established semantics.
- Retain actual HTTP status until reduction. 2xx binds nonempty job_id/turn_id but does not prove a completed answer. HTTP 400 binds only with exact detail WORKER_UNAVAILABLE and a valid sibling dispatch_receipt.
- Known generated dispatch_receipt has EXACTLY four keys: dispatch_ack: "unknown"; job_id: nonempty string; turn_id: nonempty string; retry_safe: false. IDs must agree with sibling/top-level receipt where present.
- Absence differs from present null/malformed/future receipt. NEVER strip an extra field and turn an unrecognized receipt into a valid four-key receipt. Preserve safe non-actionable validity/unknown branch without publishing arbitrary keys.
- Likewise, unknown request_snapshot keys must not disappear before strict validation and manufacture a known exact request match. Unknown/invalid remains non-actionable after projection.
- Projected canonical/result equality must not erase an identity/status/retrieval/scope/citation disagreement that currently blocks completion. Validate relevant original shape/content first or retain an explicit safe invalid/unknown branch.
- Stable binding is check-only, never replay authority. Completion requires parent submission_state == confirmed, exactly one matching canonical history turn, matching identity/status/retrieval, and equal answer/scope/citations between canonical history and parent result.
- Reconcile through workspace + canonical history reads. The existing reconciliation deliberately never calls generic GET job, which can dispatch/recover work. Only the single authorized observer uses that endpoint under the existing protocol.

### Required A1/A4 regression checks

A1 tests raw -> Python projector -> wire -> TS parser against the recovery contract. A4 ports existing reducer/reconciliation corpus.

- Lost 2xx receipt and exact HTTP 400 WORKER_UNAVAILABLE receipt retain original identity and remain check-only.
- Malformed/null/extra-field/mismatching dispatch receipts remain inconclusive after projection; retry_safe never becomes true; unknown state does not become actionable.
- Unknown request fields cannot become a valid request when projected; documented defaults normalize only inside validator; array order remains significant.
- Same-key Google child alone is inconclusive; child result ID is not parent binding; same-ID collisions and malformed adjacent history rows stay blocking.
- Restored/replay markers survive and never revive archived work.
- Canonical history is required; submission/identity/state/status/generation_status/scope/citation/answer/retrieval mismatches remain blocking.
- Modern independent disclosure matches exact captured request and parent result; actual NotebookLM lexical omission compatibility remains.
- Internal paths/secrets/raw errors absent; valid derived provenance retained; read-only check invokes no generic GET job and no POST.
- A4: A->B->A, late responses, synchronous duplicate latch, generation/epoch retirement and bounded-registry tests still pass.

## Exact later safety rulings

F5: keep the classifier's hop explicit. BFF cannot observe a browser request that never reaches it. Browser redirect:error can produce an undifferentiated network rejection; do not claim its status/Location is known. This gap is fixed by browser-side safe classification, not by following redirects or replaying requests.

F6 source: frontend/src/lib/auth-token.ts reads/writes localStorage['auth-storage'] only in established legacy custody; frontend/src/lib/stores/auth-store.ts does not hydrate device mode. The approved rule is no NEW credential storage, not retroactively pretending existing legacy storage is appearance.

F8 source: frontend/src/lib/types/personal.ts:222-225, api/personal_contracts.py:72-90, api/personal_service.py:335-400. Create takes title/content/citations/scope_snapshot and allocates a note, without enforced idempotency_key. Update uses expected_revision. Keep unknown-create/save-answer protection and read-only reconciliation; do not introduce an unapproved backend protocol to satisfy a generic UI sentence.

Cookie/auth verdict: same-origin browser Cookie retention and BFF-to-API Cookie stripping are complementary. Legacy app Bearer in the explicit parity test is the narrowly allowed header, not arbitrary client-auth passthrough. Device uses BFF-held native credentials and rejects mixed authority. Keep fixed upstream, redirect:error, exact Origin/CSRF, and header allowlists.

F10 source: frontend/src/lib/config.ts caches successful config until explicit reset; runtimeMetadata reads auth fields, not new client_contracts/ui_transport_protocol. Already-loaded legacy code cannot acquire new handshake logic. Maintain/test compatible old wire, or ship/observe a real bridge/tab-update window before incompatible cutover.

## Outcome

No change needed to independent SPA+BFF, monochrome light/dark/system, full features/data retention, initial legacy mode, or no-new-credential-storage rule. Record F1/F2, begin A1 on the separately verified isolated baseline, and resolve later findings at their task gates. This is review evidence, not test/deployment approval.
