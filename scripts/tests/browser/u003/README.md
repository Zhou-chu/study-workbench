# U003 split browser preflight

This is the file/runtime preflight for a distinct real-stack U003 browser
scenario. It does not start any listeners, perform mutations, or claim
Chromium acceptance. Keep the independent synthetic PDF browser gate.

Run canonical Web and BFF builds in the same-repository trusted hosted job,
through its pinned dependencies and `scripts/ci/prepare_tools.py`. Build from
the exact clean commit. Before starting an isolated gateway:

```sh
node scripts/tests/browser/u003/release-preflight.mjs \
  "$PR_SHA" apps/web/dist apps/bff/dist "$RUNNER_TEMP/u003-gateway" \
  > "$RUNNER_TEMP/u003-staged-target.json"
```

This verifies both release artifacts against the source tree, stages through
the repository's gateway packager, then verifies the staged inventory.
The selected gateway directory must not already exist.

The owner fixture launcher must wire the verified Web staging and BFF behind
one dedicated IPv4 loopback gateway. Start a disposable SurrealDB, API and
worker with a fresh namespace and credentials, not any user database or
discovered browser profile. The launcher verifies each listener's process
ownership. It can then call
`inspectOrigin({origin, target, password})` with the emitted target and its
fresh fixture password. This compares index, hashed app script, manifest and
PDF worker bytes and media types received on the wire, requires an
unauthenticated settings rejection, and checks encryption and an empty
default using the authorized disposable BFF route. Never put the password
on a command line or in a receipt. `inspectRuntime` is available for a
dev-only BFF diagnostic without a static artifact or browser claim.

A browser runner must separately keep Chromium sandboxing enabled and
the fixture browser isolated. It must never intercept or replace
application API responses. Only the Ollama provider protocol is stand-in
data. Exercise a genuine notebook and two public PDFs, A-only settings
navigation retaining draft/scope, model discover/register/default, one
scoped chat and the real PDF canvas at page 3, then a browser reload that
opens the saved answer with a resolvable citation.

The separate `.github/workflows/pr-u003-split-browser.yml` candidate runs
the **setup and return** rung only. A successful receipt explicitly has
`browserTurnRequests: 0` and `citationStatus: "not-run"`. Do not read that
as completion of the whole browser scenario. The count concerns Web POSTs
to the app turns route, not any provider request count; the fixture has no
generation implementation. The Node gateway is a
disposable transport for this job: it serves only inventory-verified
static bytes and passes the original request to the verified BFF adapter.
It does not prove nginx, desktop, deployed-runtime or external-model parity.
Only stage labels and bounded true/false evidence are exported, after
the launcher verifies its processes have stopped and ports are free.
