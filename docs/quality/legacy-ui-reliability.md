# Legacy frontend reliability: small isolated batch

Base: c74bc179. Scope: two components selected from Sonar5bfa S6848/S9383. No issue state was closed or suppressed. No live backend, deployment, model calls, new dependencies or main-worktree source edits.

## Implemented and reproduced

- SourceDetailContent clipboard: writeText returned a promise, but copied state and success toast appeared before it completed; a rejection was unhandled. The regression first failed on the premature success toast. Await completion, catch rejected/unavailable clipboard with the existing translated generic error, block concurrent copies, and suppress late effects after unmount. A ref protects the same-frame duplicate case, not just React's eventual disabled state. The copied-indicator timer is cleared on another copy and unmount. The formerly unnamed icon button now uses the existing common.copyToClipboard key, with no locale additions.
- Wizard step navigation: the clickable div could not be tabbed to or activated through native keyboard behavior. The regression first failed because no step button existed. Available steps are now native type=button controls, future/read-only steps are disabled, current step is marked aria-current=step, and a visible focus ring uses existing semantic tokens. Child layout is phrasing spans, not nested controls or div/p inside a button. No custom role or duplicate keyboard handler is added; browser native Enter/Space behavior applies.

## Contextual review, not blanket bug classification

| Finding location | Assessment |
| --- | --- |
| NotebookRow S6848 | Existing real notebook-title Link supplies the keyboard action; the parent row is mouse convenience. Turning the parent into a button would nest controls. Contextual false-positive candidate, unchanged and not closed. |
| AppShell S6848 | Parent click delegation closes the drawer after a native descendant link activates. It is not a separate missing button. Contextual candidate, unchanged and not closed. |
| NotesColumn outer note row | Opening a note lacks an equivalent native keyboard target in the inspected markup. Real candidate for a subsequent scoped refactor, not fixed here. |
| NotesColumn/SessionManager propagation wrappers | stopPropagation wrappers are not themselves controls; do not attach roles merely for the warning. Session selection needs a separate keyboard/interactions review; no blanket disposition. |
| InlineEdit S9383 (three calls) | handleSave already catches onSave rejection. This is not evidence of a leaked rejection. Enter/onBlur/Escape batching and save races require their own characterization before a change; deliberately untouched here. |
| SystemInfo S9383 | loadConfig catches getConfig failure internally; no established leaked rejection at this call. Unchanged. |
| use-notebook-chat S9383 | updateContextCounts catches errors and checks active state before updates. No established leaked rejection at this call. Unchanged. |
| StudyWorkbench S9383 | search.submit's downstream promise lifecycle has not been fully traced in this batch; deferred, not declared safe or fixed. |

## Verification boundaries

SourceDetail baseline:9 tests passed before changes (existing React act warnings were already present). Initial regressions then failed on the actual missing step button and premature clipboard toast, not import/selector errors. Final targeted SourceDetail13 + wizard3 + locale parity27 =43 passing. Clipboard tests cover completion, rejection, unavailable API, same-frame repeats and unmount. Wizard tests cover focusability, activation, non-submitting form behavior, disabled future steps, current-step semantics and absence of nested controls.

These are jsdom component regressions, not a browser/screen-reader acceptance claim. The dependency set does not contain testing-library/user-event; no package was installed. Native button markup/focus/activation are verified, but actual browser Tab/Enter/Space and visual focus rendering should be checked in the later UI acceptance window. No InlineEdit behavior, high-frequency source operations or real data flow was changed. Full legacy suite/build and broad Sonar scan were intentionally not run during the concurrent c74bc179 baseline.

Targeted ESLint, full legacy `tsc --noEmit --incremental false`, and git diff-check also passed.

Persistent logs: /home/USER/notebook-quality-20261113/node/ui-reliability/.


## Follow-up: InlineEdit and promise classification

On the independent 9e939aad tree, real batched-event tests reproduced three InlineEdit defects: Enter followed by blur submitted twice before React committed saving state; Escape followed by blur submitted a cancelled draft; IME confirmation Enter submitted prematurely. Synchronous ref fences now separate an active edit from an in-flight save. Composition keys are ignored. Existing internal rejection handling is preserved, not replaced by blind void operators.

A fourth regression failed with `Original` instead of `Fresh server value`: a rejected older save reset the input using its captured prop. A layout-effect ref tracks the latest committed parent value so rollback cannot restore a stale prop. This does not introduce automatic retries or change the caller-owned error-toast contract. Keyboard completion/cancellation restores focus only if focus has not moved to another control; blur saves never reclaim it. A separate late-focus regression was run red before this guard. Unmounted responses cannot alter a replacement editor.

SystemInfo remains production-unchanged. Its two new tests verify normal and post-unmount configuration rejection is caught internally. console.error is observed with a forwarding spy, not suppressed; the fixture diagnostic output is expected. Its getConfig dependency already shares an in-flight promise and validates configuration generation, so different fabricated concurrent mock results would not prove a real race. use-notebook-chat likewise already has an active-instance guard and internal catch. Neither finding is declared a real leaked rejection or silently closed.

Follow-up verification uses InlineEdit regressions, SystemInfo rejection tests and existing NoteEditorDialog inline-title/recovery integration tests, plus targeted ESLint and legacy TypeScript checking. No browser/E2E/full-suite acceptance or Sonar closure is implied.
