# Document-owned Ask / Outline Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task. The user delegated plan review and execution to the parent agent; no additional human design-review gate is required.

**Goal:** Keep one immutable, recoverable Ask/Outline identity per notebook through uncertainty and route remounts, without accidental resubmission or overwriting newer drafts.

**Architecture:** A small root-provider-owned in-memory registry, one pure reconciliation function, and a feature hook replace StudyWorkbench's component-local turn mutation/status ownership. A narrowly scoped, non-secret turn-context signal connects explicit logout/target boundaries to that registry and an exact-target precondition in the existing API transport. No general operation framework or new backend API.

**Tech stack:** Existing React 19 / Next 16 App Router, TypeScript, TanStack Query, Axios fetch adapter, Vitest/Testing Library. No dependencies.

**Spec:** `docs/v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md` F1, `docs/v1/DISPATCH_RECEIPT_2026-10-26.md`, ADR-022. Read root/frontend AGENTS and the installed Next layout documentation before implementation.

**Audit baseline:** Product code inspected at `9eeb160` (backend receipt already present). Parent reports candidate-local baseline: 1,434 unit tests / 94 files and 25 artifact tests passed. This document has not implemented or tested the proposed changes.

## Scope, alternatives and decisions

- A component ref latch alone fixes same-tick clicks but loses identity on remount and cannot safely recover uncertain writes: insufficient.
- A persisted/general task manager or backend resume API is substantially larger and changes privacy/replay boundaries: out of scope.
- **Choose the root-owned bounded turn registry plus narrow transport/context changes.** Core, transport and UI can be reviewed independently, but none alone is a completed F1 feature.
- Preserve all note-save base-revision/conflict/unknown-write behavior, citations, scope selection and explicit selection PATCH behavior. Do not change backend replay, worker restart or default-model selection semantics.
- No install, services, network/provider/DB work, shared-cache edits, browser or netlink retry. Runtime/browser acceptance remains **BLOCKED**, not replaced by unit tests/builds.
- No credentials, raw Axios/error/response objects, DOM nodes, UI callbacks, answer bodies or unrelated drafts in registry entries. No storage, cross-tab ownership, TTL eviction or exactly-once claims.

### Fixed local decisions

`MAX_PENDING_NOTEBOOKS = 8`; `MAX_CAPTURE_BYTES = 1_048_576` measured as UTF-8 bytes of the exact emitted request JSON, summed over retained captures (not a JavaScript heap-size guarantee). Reject the ninth slot or a request exceeding remaining budget before any dispatch. No eviction of unresolved entries. Existing request limits remain message 1–50,000 Unicode code points, each ID array at most 20, idempotency key 1–200 characters. Do not invent backend ID-length restrictions.

Admission synchronously validates current supported scope/engine, non-empty selected IDs, existing model/Google availability checks, available browser target and auth dispatch phase, and size. It copies only the turn DTO fields, creates the key once, claims the notebook slot, and starts attempt 1 **before any await or mutation scheduling**. Ask/Ask, Outline/Outline and mixed clicks share this latch. Current selection edits remain allowed but cannot replace this capture.

The DTO retains current field/omission semantics: task, notebook_id, engine, selection_origin, ordered source_version_ids/remote_source_ids, remote_notebook_id, message and idempotency_key; no reading position. `model_id` stays omitted by this UI. A retry sends the same captured DTO, not a reconstruction from current language, link, selection or editor. Defaults are applied only to a separate comparison projection: notably omitted model_id -> null. Do not copy backend hash algorithms.

## Actual code hazards the change must replace

- `StudyWorkbench.tsx:147–188` creates a new key inside mutationFn, uses component-local pending IDs, unlocks on `!activeJob`, and polls generic `workbenchApi.job`. That GET may dispatch work.
- `JobsPanel` is mounted even when Studio is CSS-hidden. Its generic GET can dispatch a same-key NotebookLM child; mocking the panel in all workbench tests would miss this.
- Backend live parent is `operation: 'chat'`, carrying notebook/session/key/request_snapshot/turn_id. Google child is `operation: 'ask'` with the same key. Workspace/history expose enough evidence without changing their permissive serializers.
- `sessionCoordinator.begin()/confirmed()` change on ordinary bootstrap/refresh. They are not a stable privacy/context identity.
- `revoke()` currently awaits mode before retiring own state; registry invalidation must happen synchronously at entry for own/all revoke. React effects or waiting for auth phase changes are too late.
- Config can be reset while an old fetch is pending. `apiClient` resolves target asynchronously, and Axios may yield before native fetch. A hook-level check is not an exact-target guarantee.
- Installed Axios caches `env.fetch` factories in a strong Map. **Never create a per-operation env.fetch closure**; that would retain captures indefinitely.

## Boundaries and exact interfaces

### 1. Narrow turn context and dispatch guard

Create `frontend/src/lib/workbench/turn-context.ts` (only non-secret scalar metadata and lifecycle subscribers):

```ts
type TurnTarget = Readonly<{ mode: WebSessionMode; apiBase: string; protocol: string | null }>
type TurnContext = Readonly<{ epoch: number; target: TurnTarget; ready: boolean }>
readTurnContext(): TurnContext | null
publishTurnTarget(target: TurnTarget, ready: boolean): void
suspendTurnTarget(): void
invalidateTurnContext(): void
subscribeTurnContext(listener: () => void): () => void
```

`apiBase` is the browser's canonical absolute API prefix, derived with the same URL validation/normalization as browser transport (same-origin `/api` in device mode). `publishTurnTarget` increments epoch and synchronously notifies on an actual mode/base/protocol change; same-target readiness refresh does not. `invalidateTurnContext` always increments epoch and notifies. This is not an account-principal abstraction; no auth metadata/credentials enter it.

Modify `config.ts`: add a config-flight generation incremented by resetConfig; stale fetches cannot publish or return usable config. Reset suspends turn dispatch but preserves captures. Once validated `/config` metadata identifies a changed target, publish/invalidate **before** awaiting that target's `/api/config`; publish ready only after successful completion of the current flight. Same-target failure/recovery preserves capture; stale A cannot overwrite new B. Merely calling resetConfig is not identity invalidation.

Modify `auth-store.ts`: call `invalidateTurnContext()` synchronously before the first await in signoutLocal/logout and own/all revoke. If own identity cannot be established, do not assume a target is another session. Known-other-session revoke does not clear captures. Refresh/bootstrap/ordinary in-place reauthentication do not invalidate or POST turns. Do not replace sessionCoordinator's separate race protocol.

Add optional non-secret `turnContext` request metadata to the existing apiClient call contract. During Task 1 use `workbenchApi.turn(sessionId, dto, context?: TurnContext)` so the unchanged StudyWorkbench still compiles; workspace/turns also accept optional context. Task 3's new hook always supplies the context and exposes no unguarded turn path. Do not claim the optional boundary alone fixes existing UI. No auth/baseURL overrides, no second client.

**Final-dispatch implementation:** retain the installed fetch adapter and install **one stable transport-owned guarded fetch function** for constrained requests. Carry `{epoch, target, expectedAbsoluteUrl}` in one internal `fetchOptions` field; overwrite it from the validated interceptor, never trust a caller's option. The gate checks current ready epoch/target, actual request URL and current resource-auth phase immediately before calling native `globalThis.fetch`, with no await between check and call. It strips the internal field before that call. Do not transmit a header/query parameter or serialize this metadata into the body. Reject constrained per-call custom adapters or env.fetch substitutions; test using the real adapter and a stubbed native fetch instead. Preserve timeout/signal/redirect/credentials/CSRF/FormData behavior for ordinary requests.

The interceptor also checks captured context against the actual policy returned after `prepareBrowserRequest` (not only before its await). A final locally thrown RequestNotDispatchedError may be wrapped by Axios: unwrap only the locally branded error/cause in the client before auth-failure classification, never remote flags or text. Preserve all unrelated Axios errors. The turn adapter immediately reduces errors to safe enums and optional validated original receipt IDs; registry never receives the raw error.

**Honest limit:** exact-target means the browser-visible mode/API endpoint. Device BFF keeps its own same-process config fingerprint fail-closed; browser code cannot attest to a different backend behind the same URL after a server restart, or to a stable human principal. Independent model defaults can change on the server because model_id remains omitted. Do not claim those stronger identities or silently add model pinning.

### 2. Pure registry and conservative read matching

Create `frontend/src/lib/workbench/turn-operations.ts` and `turn-reconciliation.ts`.

```ts
type TurnOwner = Readonly<{
  mountId: string; questionRevision?: number;
  editor?: Readonly<{ session: number; revision: number }>;
}>
type AttemptToken = Readonly<{ notebookId: string; operationId: string; epoch: number; attempt: number }>
type ValidatedTurnCapture = Readonly<{
  sessionId: string; context: TurnContext; owner: TurnOwner;
  request: Omit<TurnRequest, 'idempotency_key'>; googleConnectionId?: string;
}>
type AdmissionResult = { ok: true; token: AttemptToken } |
  { ok: false; reason: 'busy' | 'unavailable' | 'invalid' | 'capacity' | 'size' }
type ObservedTurnState = KnownJobState | 'unknown'
type UnknownTurnReason = 'not-found' | 'ambiguous' | 'malformed' |
  'mismatch' | 'unconfirmed' | 'answer-unavailable'
type SafePostOutcome =
  { kind: 'not-dispatched' } |
  { kind: 'unknown'; reason: 'transport' | 'receipt' | 'conflict' | 'unavailable' } |
  { kind: 'bound'; jobId: string; turnId: string; state: ObservedTurnState; dispatchUnknown: boolean }
type TurnMatch = { kind: 'unknown'; reason: UnknownTurnReason } |
  { kind: 'bound'; jobId: string; turnId: string; state: ObservedTurnState; reason?: UnknownTurnReason } |
  { kind: 'complete'; jobId: string; turnId: string; turn: TurnRecord }
createTurnRegistry(): TurnRegistry
// Registry methods:
admit(input: ValidatedTurnCapture): AdmissionResult
beginRetry(operationId: string): AttemptToken | null
beginCheck(operationId: string): AttemptToken | null
settlePost(token: AttemptToken, result: SafePostOutcome): void
settleCheck(token: AttemptToken, result: TurnMatch): void
abandonNotSent(operationId: string): boolean
releaseCompleted(operationId: string): void
invalidate(): void
getSnapshot(notebookId: string): TurnOperation | null
subscribe(listener: () => void): () => void
type TurnReceipt = Readonly<{jobId: string; turnId: string}>
reconcileTurn(capture: TurnCapture, workspace: unknown, history: unknown, receipt?: TurnReceipt): TurnMatch
readTurnPostOutcome(status: number, body: unknown, receipt?: TurnReceipt): SafePostOutcome
```

`admit` revalidates its structurally typed input, creates one UUID for operationId/idempotency_key, and returns a token only after storing the copied capture. Define/export `TurnCapture` as `{operationId, sessionId, context, owner, dto: Readonly<TurnRequest>, bytes, googleConnectionId?}`. Define/export `TurnOperation` as `{capture: TurnCapture, token: AttemptToken, phase: 'posting'|'not-sent'|'unknown'|'bound'|'complete', busy: 'post'|'check'|null, postAttempts: number, everPossiblyDispatched: boolean, receipt?: {jobId:string;turnId:string}, observedState:ObservedTurnState, reason?:UnknownTurnReason}`. `TurnRegistry` is the interface of the listed methods; mutable Maps stay private. A complete match's turn stays in the hook's read/query data, not the registry. The pure registry compares passed tokens to captures; the provider/hook facade compares them to the current context signal before admission/read/settlement, in addition to its synchronous invalidation subscription.

Use readonly/deep-frozen allowlisted DTO/arrays, opaque operation ID, context epoch/target, session, owner numbers, monotonic action/attempt number, separate `postAttempts`, shared busy latch (`post | check | null`), monotonic `everPossiblyDispatched`, safe status and optional receipt IDs. Context/operation/attempt equality gates **every** completion. Busy is acquired synchronously for initial POST, retry and check; no double-click scheduling gap. A new notebook operation cannot revive an old token.

Only a locally proven first-and-only POST attempt not dispatched (`postAttempts === 1`, no earlier uncertainty/receipt) exposes explicit **Abandon unsent request**. Read checks do not increment postAttempts. Any HTTP error, timeout/cancel, missing/malformed receipt, future state or later local-not-dispatched outcome leaves the original fence. No remote retry_safe flag, attempts=0, not_submitted, failed, needs_reauth or cancelled_local proves safe release.

Valid 2xx IDs with absent optional dispatch_receipt, or a valid 400 WORKER_UNAVAILABLE sibling dispatch_receipt, bind original parent job_id/turn_id without claiming completion. Present null, malformed/future receipt values, retry_safe:true or conflicting IDs remain inconclusive; absence of the optional receipt on otherwise valid 2xx IDs is distinct from explicit null. Unknown top-level state binds only safe IDs with observedState unknown. Do not overwrite previously known IDs on conflict. Keep fixed safe reason enums, not arbitrary server text.

**Matching algorithm (no serializer tightening):**
1. Require captured workspace notebook. Examine raw jobs without collapsing duplicates. Identify parent candidates by key/known receipt IDs; only live `operation:chat` is eligible. Exclude known child `ask`, restored_history:true and replay_allowed:false. A candidate with malformed identity/flags, duplicate parent, conflicting known IDs or normalized request mismatch yields unknown, not a filtered-away success.
2. Require unique parent notebook_id, chat_session_id, key and complete normalized request_snapshot equality. Normalize only documented request defaults; preserve array order; extra/invalid request fields are not ignored. Missing/malformed/unknown parent state never releases.
3. Once unique live parent identity/request/known-ID checks pass, bind those IDs even before canonical history exists: a discovered parent is check-only, not another POST candidate. For succeeded parents, require a unique canonical-history record with notebook/session/engine/message agreement. Google turns need not carry their own idempotency_key; if present it must agree. Missing, malformed or contradictory answer evidence returns bound IDs with state unknown and a safe reason, never completion. Do not merge/dedupe raw records before this check; conflicting raw rows with newly discovered parent IDs also remain inconclusive.
4. Completion requires parent state=succeeded, submission_state=confirmed, a succeeded result bound to the same turn, and canonical succeeded turn with a nonempty answer and consistent identity/content/scope/citations with the parent's result. Required completion fields must be well-typed; contradictory state/status never succeeds. A succeeded label with missing answer is **read recovery only**, never reason to POST.

Parent result.job_id can legitimately be the Google child ID; do not treat it as the parent receipt job_id. Parent identity comes from the validated top-level job and its turn_id. For live markers, only absent/false restored_history and absent/true replay_allowed qualify; malformed values are inconclusive.

Do not compare canonical scope directly to DTO array order: independent execution sorts/deduplicates scope IDs and Google resolves local-to-remote scope. Exact input match belongs to parent request_snapshot; final turn/result scope agreement verifies the answer binding without inventing source mappings.

Unknown/no parent stays fenced. Known receipt -> check only (minimal policy: do not offer another POST as a worker restart). No-receipt uncertainty -> explicit **Retry original request (POST)**, showing original engine/target/scope and warning it may submit work if no record exists. Send once per explicit action with same session/key/body. If a Google link/known connection target no longer matches the captured target, disable retry and allow same-backend reads/explanation; never swap target/engine. Selection/locale edits alone do not rewrite capture.

**Task 2 interface rulings (2026-10-26):** Root approved the separate optional receipt argument because immutable TurnCapture cannot contain later receipt IDs, and approved separating proven parent identity from answer completion so missing history cannot accidentally preserve POST eligibility. Registry settlement independently rejects conflicting IDs. The pure POST projector consumes only status/body; locally branded not-dispatched recognition remains in Task 3's adapter. `googleConnectionId` is observed link metadata only, not a stable Google account identity.

### 3. Root ownership and UI

Create `components/providers/TurnOperationProvider.tsx`: instantiate registry per provider, put it inside I18nProvider and **outside ConnectionGuard** in root `app/layout.tsx`. Subscribe synchronously to context invalidation and clear registry-owned payload references on epoch change/root unmount, not ordinary ready/unready changes. Its registry facade checks current epoch/target on every operation, closing any subscription-setup gap. Admission/retry/check additionally require ready context and authenticated dispatch phase; same-target readiness/auth recovery may still settle safe metadata without discarding the capture. No process/global registry, Query-cache identity or persisted Zustand. Use stable external-store snapshots. Test StrictMode cleanup/re-setup; no construction/effect dispatch.

Create `lib/hooks/use-workbench-turn.ts`: expose `{operation, completion, submit, checkOriginal, retryOriginal, abandonUnsent, releaseCompleted}`. `submit(input)` performs admission synchronously; async continuations carry tokens, not component/editor callbacks. POST uses the existing API client once with retry:false. Reads use only captured workspace and canonical history, through TanStack Query with explicit context/operation-tagged results, retry:false and focus refetch disabled. Poll only acknowledged known-active work at existing 2,000 ms cadence while mounted; unknown states need explicit Check. Auth recovery/remount may resume reads but never writes. Do not accept untagged/stale ordinary workspace cache as completion evidence.

`completion` contains the fresh matched turn/token held by the read hook, not the registry. A component effect consumes it in one synchronous current-token/mount check, applies only eligible local ownership effects, then calls releaseCompleted. Until consumed, the completed capture still counts against both registry bounds. If original mount is gone, the next mounted consumer releases confirmed completion without auto-applying; answer remains history. A response arriving while no view is mounted may update safe operation metadata but cannot touch an editor. Clearing registry references does not erase already-dispatched transport bytes or cancel remote work.

Modify StudyWorkbench to remove ask mutation/pendingJob/pendingStatus/pendingTurn/outlineTurn as independent authorities. Keep the existing question/editor revisions and all note handlers. Each mount has a unique mountId (not a resetting counter). Clear Ask only on a valid acceptance binding for the original mount and exact question revision; changing text away and back still increments revision. Outline never clears question. Apply Outline only after confirmed matched completion and original mount + editor session + editor revision all match. Preserve the existing editor-session increment, baseRevision=null, note-review reset, citations/scope attachment and history Save Answer behavior.

**JobsPanel narrow suppression:** add optional `turnFence: {key, parentJobId?, turnId?}` prop. Only the current capture's parent/same-key child (plus malformed chat/ask rows whose identity cannot exclude association) use workspace-only status; known different-key and unrelated audio/import/sync jobs retain existing generic polling. In suppressed cards, use current workspace props, not stale cached job data; disable generic query and interval. After an explicit cancel, refresh workspace rather than generic GET, and never release the turn fence from cancellation. Parent `run_turn` already invokes its ask child; intentionally withholding GET-based restart of an unresolved child is not a stall to hide. Test this with the real JobsPanel, not only its workbench mock.

Recovery panel uses semantic tokens and localized copy. Add keys to both `workbenchEn` and typed `workbenchZh` in `lib/locales/workbench.ts`; all 14 locales already import these complete objects. Required meanings: original request/target/scope, checking/read failure, uncertain outcome, retry POST warning, known-receipt check-only, target unavailable, capacity/size rejection, abandon proven-unsent, document-only recovery limit. Never offer ordinary dismiss, new-key retry or imply Check submits/restarts work.

## Sequenced implementation and red/green evidence

### Task 1 — Prove context and exact-target dispatch boundary
**Files:** new turn-context.ts + test; config.ts/config.test.ts; auth-store.ts/auth-store.test.ts; browser-transport.ts; client.ts/client.test.ts; API workbench.ts/workbench-contract.test.ts; types/personal.ts (TurnRequest excludes reading; optional opaque dispatch_receipt on receipt; read fields remain unknown where appropriate).

- [x] Write RED tests: logout and own/all revoke clear a subscribed registry before unresolved mode/auth promises; known-other revoke and ordinary refresh preserve it; same-target config refresh preserves it; A→B→A increments identity; stale config A cannot publish after B.
- [x] Write RED real-fetch-adapter tests: target changes during awaited config; after interceptor but before native fetch; invalidation during adapter body preparation; old epoch even when target returns to same URL; no native fetch in each case. Accepted path sends exact body once, original credentials/CSRF/redirect policy, and no internal metadata in native init/headers/body. Custom adapter/base/auth/env-fetch escape attempts fail closed.
- [x] Run focused tests and record intended RED, implement narrow APIs above, rerun GREEN including existing session-races/browser-transport tests. Review/commit this boundary without claiming F1 UI complete.

Task 1 独立审查与两轮 scoped 复审已通过；最终源码/验证及受约束 Axios callback/env 限制见 [进度记录](../../v1/FRONTEND_TURN_PROGRESS_2026-10-26.md)。该基础批次不表示 UI 已接入。

### Task 2 — Prove bounded ownership and read-only reconciliation
**Files:** new turn-operations.ts/.test.ts and turn-reconciliation.ts/.test.ts; provider + provider test; root layout.

- [x] RED: same-tick permutations, 8 slots and exact UTF-8 byte boundary, input mutation after capture, limits/defaults/order, no reading/credentials retention; retry/check double clicks; unknown followed by local not-sent; only first unsent abandonment; invalidation and stale attempt completion.
- [x] RED matcher table: child with same key; valid parent plus duplicate/wrong body/receipt ID; archive/replay prohibition; null/missing/future/contradictory fields; historical retry_safe:true; failed/needs_reauth/cancelled_local/unknown never release; confirmed exact parent/result/canonical turn succeeds; missing answer never authorizes POST. Include real-shaped independent sorted scope and Google resolved scope fixtures.
- [x] RED provider tests: route unmount/remount retains capture, root replacement loses it, root invalidation releases payload references, old promise cannot recreate it, StrictMode causes zero dispatch.
- [x] Run focused tests, implement, run GREEN and typecheck, review/commit. Core-only acceptance is explicitly not the finished feature.

Task 2 core/provider implementation and local gates are recorded in the scoped change; independent root review/publication remains pending. StudyWorkbench, the feature hook, JobsPanel suppression and runtime acceptance are not delivered by this foundation.

### Task 3 — Integrate explicit recovery and editor ownership
**Files:** new use-workbench-turn.ts/.test.tsx; StudyWorkbench.tsx/.test.tsx; JobsPanel.tsx/.test.tsx; locales/workbench.ts; existing locale parity tests.

- [x] RED integrated tests: Ask/Outline same act tick -> one POST; lost ACK then edit scope/link/question/locale -> no automatic POST and manual retry retains exact original session/key/body; route remount preserves fence but does not clear a new question or apply an old outline; auth success/focus/online/refetch never POST.
- [x] RED: original mount + revision permits Ask clear; away-and-back text does not; Outline never clears question; editor New/Edit/title/content and pending note save retain existing semantics through ACK and history delay.
- [x] Replace unsafe tests rather than preserving the bug: `unblocks composer when durable job is %s before a turn exists` becomes **keeps composer fenced** for all listed states; failed-submission test no longer expects Ask enabled. Update successful outline fixtures to supply actual trusted parent/result/history evidence rather than answer text alone.
- [x] RED real-JobsPanel integration: checking/remount/auth refresh of parent/same-key child performs no generic job GET or mutation; unrelated remote job continues existing polling; explicit cancellation does not unlock.
- [x] Implement, run targeted GREEN and the complete StudyWorkbench note/citation/source-scope regression suite, locale parity/types, review/commit with Unreleased CHANGELOG entry and ADR recording the 8-slot/1-MiB and conservative-release decisions.

Task 3 implementation uses the exported Task 1/2 interfaces without changing backend semantics. Initial component RED caught same-tick duplicate writes, unsafe release and real JobsPanel GET leakage; integration tests now exercise immutable replay, remount/editor ownership, actual nullable independent/Google citations and scoped cancellation. Read-error state is operation-tagged so an abandoned proven-unsent request cannot contaminate the next request. The nominal matcher fixture now has an actual nonempty producer `locator.block_id`. Final counts and exact commands are in the task report; root-owned independent review/publication and the Task 4 build/artifact gate remain pending. No build or runtime acceptance was performed by Task 3.

Task 3 ruling: current observed Google target equality controls explicit replay, not a new sticky link-revision identity. A→B→missing→A never auto-submits; a missing previously known label blocks, while a genuinely absent legacy label can remain compatible. The label is not Google-account identity. Root approved this interpretation on 2026-10-26.

### Task 4 — Integrated release gate (not runtime acceptance)
- [x] Fresh parent review of cross-boundary races, payload ownership, exact-target guard, contradictory reads, and note/citation/scope preservation; resolve findings before claiming source completion.
- [x] From candidate frontend, prepared dependencies only: `npm run lint`; `./node_modules/.bin/tsc --noEmit`; `npm test`; `npm run build`; verify the newly emitted artifact with `node scripts/build-artifact.mjs --verify <artifact>` per ARTIFACT_IDENTITY. Use the repository's clean offline environment, no install/network or serving-checkout mutation. Build and verification serialize with other frontend workers; record actual counts/status/source/tree separately.
- [x] Update F1/ADR/CHANGELOG evidence with exactly what shipped, and remaining unknown terminal/operator-recovery limitations. Do not upgrade existing backend/browser/DB/provider/CI acceptance claims.

Task 4 completed 2026-10-26 UTC at source `152250609b142b12aa86dc0e7f1f2cc2436ef0f5`: whole-feature review and one final scoped fix/re-review closed the UUID mount availability P2 and EOF whitespace P3. Fresh frontend 1,739 unit + 25 artifact tests, 407 focused, types/lint passed (7 inherited warnings); integrated backend 2,778 / 128 skipped, static/OpenAPI passed. Official production build and separate artifact verification passed with build ID `4876fd5d-8638-424f-87f8-12428a4fa267`. See [final evidence and explicit limits](../../v1/FRONTEND_TURN_PROGRESS_2026-10-26.md). Actual browser/runtime/CI/deployment acceptance remains unestablished; no main merge or blocked runtime retry.

## Review focus / release stop conditions

1. Same-tick latch is before every await, including target discovery; Task 2/3 tests own it.
2. Every stale-result path checks context, operation and attempt; auth/config delayed-finalization tests in Task 1 and remount tests in Task 3 own it.
3. Read recovery must not indirectly dispatch a Google child through hidden JobsPanel; Task 3 real-panel test owns it.
4. Foreign/ambiguous/history-only records cannot unlock; Task 2 matcher table owns it.
5. An exact-target check must run at native fetch without retaining per-request fetch closures; Task 1 real-adapter tests own it.

Stop implementation and report a blocker if the installed transport cannot preserve a local-not-dispatched proof at its final send boundary, if actual wire fixtures cannot prove parent+turn completion, or if work requires changing backend replay/proxy identity semantics. Keep the fence; do not weaken evidence to make a test pass. Browser/netlink/runtime remains blocked and must not be retried.

**Remaining implementation discretion:** exact localized wording and small internal type layout may vary. Do not vary limits, state-release evidence, privacy lifetime, original-body replay, fetch-boundary checks or test obligations. Server-behind-same-URL and human-principal continuity are explicit unsupported guarantees, not hidden implementation TODOs.

**Self-review (2026-10-26):** F1 coverage maps to Tasks 1–3 and each Review Focus has an owning RED test. Corrected independent staging by keeping the API context argument optional until hook integration; made cross-task types explicit; separated POST count from read/action sequence for first-unsent abandonment; retained completion payload only in read data; scoped JobsPanel suppression rather than stalling unrelated remote jobs. Parent has independently read the draft. No product code, tests, services or external actions were run by this design worker; only this out-of-repo artifact was written.
