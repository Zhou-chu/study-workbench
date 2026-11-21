# Legacy frontend interaction and Promise ownership review

Base e10f7d8; isolated candidate, no deployment or runtime theme change.

## NotebookRow: concrete behavior change

Previously only the title/open text were real links. Clicking description,
counts or time bubbled to a div router.push handler. Those content hit areas did
not expose link target/context-menu semantics; modifier-click also followed the
imperative path. The existing title was already keyboard accessible, so this is
not a claim that the whole old row lacked any keyboard route.

The primary content is now one real Next Link (accessible name: notebook name),
including description, counts, time and the visible Open cue. Archive/delete menu
is a sibling, not a nested interactive control. No artificial role or tabindex
was added. Outer decorative padding is no longer an imperative navigation target.
The visible content layout/classes and translated strings remain; no new locale
keys are introduced. Actual browser new-tab/context-menu execution still requires
browser verification, which was not performed in this batch.

RED: 1 failed / 2 passed, missing anchor around description. GREEN: same three
component tests passed. Tests verify anchor href and content, native focusability,
no nested controls, application does not prevent modifier click, and keyboard-
opened menu archive/delete remain independent. Next navigation and mutation I/O
are replaced; real React, UI/menu components and DOM run. These are component
integration tests, not strict business unit coverage.

Initial setup tried unavailable user-event and failed collection; it was replaced
with installed Testing Library fireEvent/focus, without installing packages.
An intermediate green run emitted jsdom's unsupported-navigation warning. The
final test observes application defaultPrevented at document bubbling and only
then prevents jsdom navigation. It does not assert a real browser opened a tab.

## AppShell: delegated native activation, no production change

The div listener closes navigation only for a descendant anchor; it is not a new
interactive control. Native keyboard link activation emits a click, so adding a
button role or keyboard handler to the wrapper would be misleading. Added a
component regression focused on detail=0 activation of the real descendant link;
the dialog closes. Existing mobile and close-button cases also remain green.
This supports contextual review, not an automatic Sonar status change or full
screen-reader audit.

## use-notebook-chat: owned asynchronous rejection, no production change

updateContextCounts already awaits buildContext inside try/catch; active guards
both state updates and logging after cleanup. Added rejected-context and rejection-
after-unmount hook tests. Both pass without changing production or adding bare
void. Existing logging includes error prose; this batch does not claim global
log sanitization. Hook tests use real React/TanStack and API stubs, not pure-unit
coverage of a single business function.

## StudyWorkbench: deferred executable validation

openCitation has a try/catch around evidenceApi.evidence and intent ownership before
its failure toast. The reported map callback discards its promise, but static
inspection alone does not establish an unhandled I/O rejection. No production
change or new test for this path in this batch; leave its final disposition open.

## Validation

Final three-file run: 30 passed, 9.27 seconds. Targeted ESLint for all four changed
TS/TSX files and git diff --check passed. No full build, typecheck, full suite,
coverage run, browser screenshot or Sonar reanalysis performed. Manifest untouched.
Evidence directory `/home/USER/notebook-quality-20261113/`:
`legacy-row-setup-error.log`, `legacy-row-red.log`, `legacy-row-green.log`,
`legacy-boundaries-targeted.log` (final clean run).
