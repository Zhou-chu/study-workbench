# Foreground native SPA/BFF synthetic checks

This is an opt-in, **partial native runtime** operator command. Source review and
offline tests do not authorize executing it. A separate controller release must
name the reviewed commit, fresh gateway stage and new temporary run root.
There is no automatic integration test, background service, cross-process stop,
deployment, browser or image operation in this command.

## Exact invocation, only after runtime release

Use the prepared Linux interpreter, in the approved checkout. Replace the three
release placeholders with the controller's exact values; do not derive the
expected commit from whatever happens to be HEAD.

~~~sh
cd /home/zhouchu/study-workbench-worktrees-20261108/notebook-redesign
/home/zhouchu/study-workbench-deploy-20261107/source/.venv/bin/python \
  scripts/v1/spa_native_runtime.py run \
  --source-commit REVIEWED_40_CHARACTER_COMMIT \
  --run-root /tmp/spa-native-RELEASE_UNIQUE \
  --fixture contracts/v1/fixtures/workspace-view-v1.json \
  --gateway /ABSOLUTE/EXPLICIT/REVIEWED/GATEWAY_STAGE
~~~

There are no executable, source path, provider, environment, port, Web/BFF path,
auth-mode or worker-count overrides. The expected commit is an assertion of the
separately approved identity, not an authorization token. The explicit gateway
is an input file identity only. The runner neither serves that gateway nor
claims a Dockerfile, image or served SPA result.

The checkout must be clean on feat/notebook-spa-redesign-20261108, descend from
accepted C2 46ec5bf53f70ebf34b1d8ff332b63f0b0ce5f115, and contain its committed
runner and unchanged reviewed helpers. The existing pure C2 verifier checks the
current Web/BFF builds, public contract/fixture and gateway window. Rebuild both
artifacts from the clean reviewed runner commit and stage a fresh explicitly
named gateway. Keep every prior stage; **do not overwrite gateway/dist**.

## Fixed prepared tools and origin checks

Prepared tools live beneath
/home/zhouchu/study-workbench-deploy-20261107. The runner hashes every selected
file before executing any version/resolution probe:

- Surreal: source/.runtime/bin/surreal, runbook-pinned 2.3.10, SHA-256
  bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7.
  The separately retained tools/surreal/surreal matches but is not a fallback.
- Node: tools/node-v24.19.0-linux-x64/bin/node, SHA-256
  bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12.
  It matches the retained official archive whose vendor checksum is
  14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647.
- Python: source/.venv/bin/python is the one explicitly allowed symlink to
  tools/python/cpython-3.12.14-linux-x86_64-gnu/bin/python3.12, SHA-256
  8f9781a98200d9ecda7e00464e4c64b1327abae788ae8e6979d5c859311410c7.
  Prepared venv metadata and retained preparation logs identify CPython 3.12.14.
- The prepared worker script and its CLI module, and the prepared Git executable,
  have fixed paths and hashes in the runner. The worker CLI module has exactly
  2 prepared hardlinks; Git has exactly 150 installed command links. Those two
  hash-bound exceptions do not relax single-link checks for any run file,
  helper, upload fixture or ordinary prepared executable.

Dependency versions are pinned to the inspected prepared environment:
surreal-commands 1.3.1, surrealdb 1.0.8, uvicorn 0.40.0, FastAPI 0.136.3,
HTTPX 0.28.1, python-dotenv 1.2.2 and Esperanto 2.28.0. An unavailable or changed
tool blocks instead of installing, fetching, upgrading or selecting a fallback.

Before root creation, side-effect-free import resolution must point API,
commands and open_notebook to the approved checkout. This is resolution
evidence, **not application import/runtime compatibility evidence**. Application
imports create directories, so they are deferred to the future owned synthetic
API/worker bootstraps. Those use -I -B, prepend only the fixed checkout and
verify actual loaded module paths before entering the service loops. The worker
runs the same prepared CLI entry function with the fixed commands module and
two task slots. Nothing imports a user's .env or a real NotebookLM profile.

## Isolation and ownership

Only a fresh direct child of /tmp is admitted, using exclusive creation and
no-follow directory custody. Reused roots, aliases, protected source/deploy/user
paths and overlapping input roots are refused. Root/subdirectories use 0700;
runner evidence, tokenizer copy and logs use 0600. Child umask is 0077. All state
and logs are retained, including on success; the command never deletes them.

DB password, API bearer password and encryption key are independently random
per invocation. They exist only in parent/appropriate child environments, never
argv or receipts. DB receives no API/encryption secret. BFF receives no DB/API
password or encryption key. BFF passes the one-run bearer only on the new
loopback route. Private logs redact the three literal secrets **before writing
to disk**, suppress oversized lines and cap persisted log bytes. No ambient
provider credentials, proxies, Python options, .env, browser state or
production data are forwarded. There is no OS-level network sandbox claim.

The DB, API, worker and exactly one BFF start in that order. Three fresh ports
exclude known default and old live ports, including 13001, 5056 and 18001.
Selection does not reserve a listener: every listener port is rechecked before
launch, and every readiness/transaction request checks current owned socket
inodes and still-live original process ownership. Earlier services and the
worker are guarded once present. No old service is contacted, adopted or stopped.

All processes stay registered to the same foreground parent. The existing
runtime_lifecycle primitives retain the original waitable handles, validate
identity, terminate only registered groups in reverse order and reap after
signalling. No numeric PID from a file grants future signal authority. Success,
failure, timeout, SIGINT and SIGTERM all unwind through that same owner.
Repeated signals are ignored only during this cleanup window. Listener release,
root custody and source/artifact identity are checked afterward. Unknown
ownership is never resolved with global or process-name kills.

## Named checks and request limits

All transaction requests use HTTPX with trust_env=False, no redirects, explicit
timeouts, no Origin/Sec-Fetch header and the one-run bearer. Requests are counted
at admission and completion; mutations are counted separately. Readiness probes
have separate admission/completion counts. Those are runner-originated counts,
not an assertion about internal API/BFF/DB traffic.

The public tests/fixtures/v1/fixture_course.md is the actual upload. The
allowlisted JSON workspace fixture is identity input, **not a DB seed**.
The provider-free ordered transaction is:

1. BFF config/auth status and an anonymous denied workspace request.
2. One synthetic notebook, public multipart upload and bounded worker extraction
   observation through workspace reads. Exactly one same-key/same-bytes replay
   verifies the same IDs and no additional personal job.
3. Ready extraction/evidence and original-byte hash; explicit local selection,
   lexical-only search, authored note persistence and workspace/workspace-view
   readback. No model/embedding fields are supplied. Citation validation is
   separately labelled not_run; saving this authored note is not citation proof.
4. Mandatory provider-free export submission, bounded original-job observation,
   ZIP download/hash, single-file portable import, remapped notebook/selected
   version and original-byte hash verification.

Unknown submissions are never retried with a new key. Export polling is
workspace-only, not a dispatch-capable job endpoint. The original returned job
identity remains in a partial receipt if later observation times out. Import is
submitted at most once. No user archive is uploaded.

Limits: readiness 90 seconds per endpoint, job observation 90 seconds, transaction
300 seconds, individual transaction I/O timeout at most 10 seconds, at most 800
transaction admissions, and at most 16 MiB per response. Stream chunks recheck
the transaction deadline. A blocking I/O call can overrun the wall-clock budget
by at most its current I/O timeout. Cleanup adds its bounded owned grace period,
log drain and pure verifier timeouts.

## Private receipts and honest status

started.json is an incomplete native receipt written before launch.
receipt.json uses the distinct spa-native-runtime-receipt-v1 schema and
contains frozen source/API/worker, contract/fixture, Web/BFF slots/metadata and
gateway identities; prepared-tool/version/resolution records; run-root custody;
startup/readiness lists; completed checks and known synthetic IDs/hashes;
request counts/outcomes; timeouts; cleanup outcome; and relative private log
names with hashes. No raw responses, credentials, arbitrary exception strings,
full logs, process argv or environments are copied into it.

- partial_pass: the named native checks completed and owned cleanup, listener
  release and source/artifact rechecks succeeded. CLI exits 0.
- failed: a check, startup or interruption failed, with successful cleanup.
  Known completed steps and unknown request outcomes remain visible. CLI exits 1.
- cleanup_uncertain: custody, cleanup, drain, listener release, input recheck
  or receipt persistence is uncertain. Root remains; CLI exits 1. Do not use a
  retained PID to signal later.
- A crash or failed final receipt may leave only started.json. It is incomplete,
  not evidence of cleanup or success. Do not reuse that root.

Receipts are local evidence from this cooperative same-parent producer, not
cryptographic authentication against a hostile same-UID actor. They are not the
inert C2 helper's manifest and must never be passed to its stop, recast as a
source-only preparation, fed as fabricated observations to summarize_cases,
or used to mark the 615-case catalog passed.

## Validation and remaining gates

tests/test_spa_native_runtime.py uses fake process/port/HTTP boundaries and
temporary public fixtures. It never launches the real stack. Run with the
repository's prepared offline test workflow; focused direct pytest is also
used for the pure runner tests. No automatic test invokes the real command.

Independent source review and a separate native-runtime release remain required.
Even a future partial native pass does not satisfy official Linux nginx/image
or served gateway checks, browser/device/pixel/IME/zoom acceptance, protected
HTTPS/cookies/ingress, provider/account/model/Google/cost/quality, the full C2
catalog/user-experience decision, user-data backup/restore/cutover/rollback or
owner-observed live-tab SAVE/RECONCILE/EXIT in both directions. The observed
Windows Docker engine and unavailable Linux endpoint are not replacements for
those gates. Production and the old live deployment remain unchanged.
