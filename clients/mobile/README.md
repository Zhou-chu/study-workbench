# Mobile offline domain slice (Android / iPad preparation)

Dependency-free TypeScript domain source intended for a later genuine React Native UI.
**Not an application, native build, generated SDK, WebView or connected client.**

Visible copy is fixed:
- 演示数据 · 未连接服务
- 已保存在本次演示中（重启后重置）
- 演示任务排队中

## Interfaces and ownership

- `FixtureRepository`: `listNotebooks`, `getWorkspace`, `getPublicText`,
  `saveNote(noteId, content, expectedRevision)`, `submitOutline(request, idempotencyKey)`,
  `getJob`. All state is in memory; create a new repository to reset.
- Notebook index and public synthetic text are **local assets**, not server endpoint
  fields or source-version content. The baseline workspace exactly matches
  `contracts/v1/fixtures/workspace.json`. Its sources are intentionally empty.
- Contracts are a handwritten subset/view of `api/personal_contracts.py` and
  `TurnRequest` in `api/routers/evidence.py`. Extra/opaque records, missing
  fields, explicit null and raw state strings are retained. `Job` intentionally
  projects only shared identity/state, not a claimed complete SDK/decoder.
- Navigation tickets reject stale/mismatched responses. Keep drafts keyed by note
  ID and operations keyed by user action **outside navigation state**; back/dismiss
  must not recreate them. UI binding has not been implemented or runtime-tested.
- `openDraft/editDraft/beginSave/finishSave` preserve unknown/missing content rather
  than turning it into saved empty text. A save attempt captures text and revision;
  duplicate/late completions cannot overwrite newer edits. Completion ownership
  requires the **exact pending attempt object**, not matching note ID/serial.
  Callbacks must retain the object returned by `beginSave`; do not clone,
  serialize or reconstruct it. Reopening/resetting creates different attempts,
  so old success/error callbacks cannot settle a new editor's save. Conflicts retain the
  draft/revision; unknown saves cannot be blindly retried. No conflict resolution
  or unknown-result reconciliation UI exists yet.
- `beginOutline` returns the existing operation on repeated action; do not call
  submit again when an operation already exists. `receiveSubmission` and
  `resumeOperation` retain its key and receipt identity. Resume only reads a known
  job. Unknown submission retains its key and is not a new generation action.
  Historical replay and unknown-state replay are refused. New job/turn IDs reserve
  every retained workspace string (including opaque nested history references)
  and every newly allocated identity; queued jobs cannot shadow retained history.
- Constructor `saveMode` and `submitMode` provide manual deterministic
  conflict/unknown/error scenarios. There is no timer or transition to fake success.
  A queued receipt is **not generated output**. Fixed dates/IDs are synthetic only.

No network transport, endpoint/login settings, credentials, persistent storage,
models, background execution, cancellation, PDF rendering or remote success.

## Exact local verification

From `clients/mobile/`, using the already available Node **24.19.0** type stripping:

```sh
node --test test/*.test.mjs
# Equivalent package test command (no install required):
npm test
# This execution workspace's preinstalled frontend compiler:
node ../../../audit-followup-integration/frontend/node_modules/typescript/bin/tsc -p tsconfig.domain.json
```

Elsewhere use the project's already installed TypeScript compiler with the same
`-p tsconfig.domain.json`; do not acquire dependencies implicitly.
The strict domain-only configuration has ES2022 types, no DOM/Node ambient types
and no fake React Native declarations. Tests guard import/execution network
access and source imports, compare the shared public fixture, and check
conditional saves, draft races, stale navigation, unknown outcomes and identity.
This does not constitute a security sandbox for future arbitrary code.

**NOT RUN:** React Native dependency installation/compilation, Android or iOS
builds, simulator/device/UI/accessibility execution, signing, PDF rendering,
connected auth/transport, models, Docker, whole-backend/Web regression suites.
Those remain separate integration/platform gates; this slice cannot waive them.
No SDK scaffolds, version guesses, signing keys, CI activation or publication.
