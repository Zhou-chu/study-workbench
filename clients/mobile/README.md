# Native mobile public-fixture source slice (Android / iPad preparation)

Genuine React Native components over the reviewed in-memory TypeScript domain.
**Source + JavaScript tests, not an installable application or connected client.**
No WebView/HTML wrapper, native platform scaffold, signing keys or SDK installation.

## What is implemented

- Notebook list → faithful workspace → separately labeled selectable public text.
- Native multi-line revision-aware note editor. Back/dismiss and width changes
  preserve drafts; pending saves retain exact attempt identity. Unknown saves do
  not retry; clean/completed unchanged saves do not write again.
- Outline modal → queued receipt → read-only same-job status. Dismiss/reopen does
  not resubmit. Historical/unknown outputs cannot replay; queued is not generated.
- Native-stack phone navigation and >=840 logical-unit,280-unit sidebar. At large
  text sizes width/fontScale<600 uses full-width layout. The same session survives
  resizing. System back, gestures and focus are supplied by native-stack but still
  need real-device acceptance.
- Calm reading/writing, separate settings, confirmed destructive demo reset.
  Font scaling is not capped; buttons are at least48 logical units, inputs/status
  are labeled, content scrolls, keyboard avoidance uses native header height.

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
  must not recreate them. The native UI session now binds these interfaces; device runtime remains untested.
- `openDraft/editDraft/beginSave/finishSave` preserve unknown/missing content rather
  than turning it into saved empty text. A save attempt captures text and revision;
  duplicate/late completions cannot overwrite newer edits. Completion ownership
  requires the **exact pending attempt object**, not matching note ID/serial.
  Callbacks must retain the object returned by `beginSave`; do not clone,
  serialize or reconstruct it. Reopening/resetting creates different attempts,
  so old success/error callbacks cannot settle a new editor's save. Conflicts retain the
  draft/revision; unknown saves cannot be blindly retried. The editor explains conflict/unknown outcomes and retains text; no automatic merge
  or unknown-result reconciliation is implemented.
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

## Run the supported source checks

From `clients/mobile/`, Node matching `package.json` (verified24.19.0 here):

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/study-mobile-npm-cache
npm test                 # domain/session + mocked-native JS component suite
npm run typecheck        # unchanged strict domain + strict application source
npm run test:domain      # only Node built-in/type-stripped tests; no RN runtime
npm run test:ui          # Jest/RNTL, native modules mocked (NOT device acceptance)
```

No `run-android`, `run-ios` or platform build command is provided: this worktree has
no platform host. Future authorized platform integration should import the default
component from `src/App.tsx` into its independently reviewed RN registration entry.
Do not run a template generator here: it can create platform/signing artifacts.
The source checks do not launch Metro, emulators, ADB, simulators or network clients.

[Dependency research](docs/DEPENDENCIES.md) records exact verified pins and official
sources. `package-lock.json` freezes integrity/resolution. Lifecycle scripts are
also disabled in `.npmrc`. UI strict source types use the installed RN types;
`skipLibCheck:true` follows RN0.87's documented generated API migration. The initial
full vendor-declaration check failed and is **not claimed passing**. Domain-only
checking is unchanged; no fake ambient native declarations are used.

## Evidence and remaining gates

Verified here:11 original domain tests,8 session tests,12 JS component tests;
strict domain and strict UI application-source typechecks. Component coverage
includes route return, sheet dismissal, width390/768/1024,200% font-scale state
retention (not visual fit), unknown/conflict, missing text, empty/error/loading,
queue receipt/resume, reset confirmation, and a nonzero sidebar top-inset
ownership check that leaves the native-header root unpadded. Native screen hosts and safe areas
are mocked; geometry and actual accessibility cannot be inferred from these tests.

**NOT RUN:** Android/iPad native builds, device/simulator execution, install/signing,
TalkBack/VoiceOver, real keyboard/pointer/focus/safe areas/gestures/system back,
PDF rendering, process-death persistence, connected auth/transport/models, Docker,
whole-backend/Web regression suites. No CI activation or publication.
Cloud SDKs are unverified. User-laptop tools are **UNKNOWN** after an environment
error before inspection commands launched; this task did not operate that laptop.

The slice is intentionally public synthetic and ephemeral. The approved online MVP
still requires protected draft persistence, private native ingress, credentials,
real source/PDF/citation workflows and platform acceptance; none is waived here.
