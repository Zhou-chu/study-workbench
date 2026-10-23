# Recovered local browser harness custody

This is the P0 custody contract, not browser acceptance or deployment approval.
Use only new synthetic fixtures. Never adopt an existing listener, browser profile,
user database, provider configuration, or another invocation's processes.

## Immutable artifact and writable runtime

`local_check.py --artifact …` verifies the authoritative artifact against
current source/generated inputs. Every frontend start gets an exclusive private
copy and a receipt in `frontend-runtime-receipts.json`, including original identity,
runtime location and owned process identity. Only that copy runs `server.js`.
Runtime route-cache writes are expected; its initial verification is not a claim
of continuous runtime integrity. The authoritative artifact is verified again on
exit, including failure.

Copies reject hard-linked source files, special files, overlapping roots and
symlink ancestors. The sole packaging-link exception is a relative link inside
`node_modules` resolving inside the same artifact's `node_modules`. Regular files
are independently copied, not hard-linked. Copy failure leaves registered partial
copies for drain-first cleanup. No original artifact is deleted or rewritten.

## Child and profile ownership

Linux `prctl` subreaper, pidfds and `waitid(P_PIDFD)` are required. Entry requires
one thread, default SIGCHLD, no preexisting children and no existing subreaper.
The invocation must remain the exclusive child creator/reaper. Registered session
leaders use the existing pinned process-group lifecycle; adopted detached children
are enumerated using `/proc/*/stat` PPid and independently validated as actual
children via pidfd waitid. No name-based discovery, global kill, or guessed PID
signalling is used. TERM grace precedes KILL; children are reaped before restoring
subreaper state. Unsupported syscalls or uncertain drain fail closed.

The parent owns a fresh `browser-temp` directory, with browser HOME/config/cache
and TMPDIR beneath it. The child cannot delete it. Parent checks its inode and
non-symlink identity before deletion, after process drain, free-port checks and
original-artifact verification succeed. Failure at any of those boundaries retains
the runtime copies/profile and raw fixture evidence rather than claiming cleanup.
Logs and synthetic screenshots remain in the run directory. Treat all run receipts
as private: they can include fixture authentication material.

All lifecycle checks must run within the same execution namespace as launch.
A new tool invocation may have a different PID/network namespace; absence there
cannot prove cleanup of an earlier invocation. Do not guess old PIDs or kill
unrelated processes. Record inconclusive cleanup explicitly and stop dependent
runtime work until a separately reviewed isolation plan permits it.

## Browser and environment limits

Firefox requires an explicit absolute regular executable via
`--firefox-executable`. No downloads or profile reuse are performed. Browser
service workers are blocked. Chromium's separate branch explicitly requests its
sandbox; that is not Firefox sandbox evidence. Inspect the installed Firefox
Playwright driver's default args, environment and preferences before live launch;
this harness does not establish that the installed browser sandbox is active.
Never bypass a launch/security denial with sandbox-disable or TLS flags.

Fixture API updates are disabled by `OPEN_NOTEBOOK_DISABLE_UPDATE_CHECK=1`; DB
updates by `SURREAL_ONLINE_VERSION_CHECK=false`. Child environments are allowlisted,
not inherited provider/proxy/certificate environments. Local browser routing and
these settings are not a global backend egress firewall or zero-egress proof.

## Scope remaining before fresh acceptance

The recovered baseline's P1 selector/readiness maintenance is described below;
its static review does not substitute for a fresh browser run. The recovered typed unsafe-upload consumer is mount-local; do not
attribute the lost-ACK/global recovery behavior of an unrecovered implementation
to it. Fresh source/artifact association, installed-driver inspection and explicit
runtime authorization are still required. Offline custody tests do not exercise a
real browser, application stack, native upload, provider, or user-data recovery.

## Recovered P1 workflow contract

The baseline now waits for the exact successful workspace GET, changes a
non-default PDF checkbox and verifies successful selection PATCH plus exact IDs
in a new loaded GET after reload. Notes/search use successful exact endpoints.
Source controls are scoped to source articles. Reader version identity is read
from its visible Document tools disclosure, not removed nested-main/title markup.
Portable controls are inside Notebook tools, and the current backup download
button is used. Preferences use the real separate Settings page and real menu
actions; workbench reloads reopen Reader. Current Chinese outer tab is 阅读与提问.
Physical raster and viewport measurements are retained, not substituted by these
static selector checks.

A separately labeled `mocked-typed-500-ordinary-workbench` stage intercepts exactly
one upload POST with typed `UPLOAD_COMMIT_UNKNOWN` / `retry_safe:false`. It sends
zero upload requests to the backend. The same mounted workbench must retain its
blocked file row and question/note drafts, omit retry/dismiss, suppress repeated
same-file selection, and remain blocked after one explicit successful readonly
workspace refresh. Unexpected writes fail the stage. Its JSON/PNG are separate
from native-flow evidence. The bounded post-action observation does not establish
indefinite suppression, generic transport behavior, cross-remount persistence,
real DB commit, worker processing, or the unrecovered native lost-ACK flow.
