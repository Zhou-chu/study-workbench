# Strict Python unit execution (candidate)

This is a Python partition runner, not the final whole-project unit gate. It does
not resolve unreviewed classifications, run the mixed suite as unit, or claim the
project has reached 90 percent. The frozen starting inventory has 179 production
Python files; this adapter adds one production Python module, bringing this
candidate to 180. Counts are derived from tracked inventory, never hardcoded.

## Boundary

`coverage-python-unit.mjs` accepts only an existing, fully validated selection
artifact. The existing same-checkout selector rechecks complete tracked inventory,
revision, all input hashes and all classifications before and after execution.
Unknown/mixed/stale classification blocks the run, including unresolved tests in
other languages. Only explicit selected Python files are passed to pytest. There
is no tests-directory fallback or caller-provided pytest argument passthrough.

All tracked Python in api, open_notebook, commands, scripts, deploy, apps and
run_api.py stays in the production denominator. Tests and historical docs are
separate; any new Python root fails closed. Native coverage JSON is checked for
missing/extra paths and internally consistent integer counts. Namespace and
unimported sources are retained by the existing coverage configuration. No report
exclusion or threshold is reduced.

Nonempty execution uses the existing offline_pytest environment and tokenizer
verification. The added pytest adapter records actual collection, deselection,
collection failures and setup/call/teardown events. A selected file must contain
at least one genuinely passing call; skip-only files, missing/extra files,
uncollected reports and failed/incomplete phases fail the execution audit.
Native failures and skips remain in the raw evidence. Failed collection may
legitimately produce no coverage report; that is a failed measurement, never a
synthetic zero or a reused report.

An empty Python partition does not invoke pytest discovery. It starts/stops a
real coverage.py measurement and invokes coverage.py's JSON/XML CLI reporters.
The complete unexecuted source denominator is reported at zero. pytest exit is
null (no pytest run), and the native coverage threshold exits are retained.
Expected no-data warnings for this explicit mode remain visible in the log.

The CLI interpreter path is explicitly chosen by the operator from an already
prepared environment. Its realpath, bytes, version, pytest/coverage versions and
available pyvenv.cfg hash are recorded. The executable realpath/bytes and available
pyvenv.cfg hash are rechecked after execution; library versions are observations,
not authenticated package-content measurements. This is provenance, not a
new trusted-Python registration or authentication of arbitrary executables. No
PATH/system setting, dependency installation, credentials or network permission
is changed. Offline Python auditing is not an OS sandbox or firewall.

The raw pytest/coverage exit is kept separately from the runner's validation
result. The existing combined coverage fail-under remains 90.01; independent raw
line and nonempty branch ratios must also be strictly above 90. Function coverage is N/A
for coverage.py. A passing execution audit alone does not mean coverage passed.
Every invocation reaching the runner entrypoint first allocates a run ID and invalidates the report at the
producer-owned checkout path, before parsing options or reading/validating the
selection artifact. Missing/invalid selections, malformed options, startup and
post-run failures replace that attempt with a failed report while
preserving any actual child exit and run-directory evidence already available.

## Reproduction

From a clean checkout with every classification independently reviewed:

```sh
mkdir -p coverage/unit
node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {createUnitSelection} from "./scripts/coverage-unit-selection.mjs"; writeFileSync("coverage/unit/selection.json", JSON.stringify(createUnitSelection(process.cwd()), null, 2));'
node scripts/coverage-python-unit.mjs \
  --unit-selection="$PWD/coverage/unit/selection.json" \
  --python="$PREPARED_PYTHON" \
  --tiktoken-cache="$TOKEN_CACHE"
```

`PREPARED_PYTHON` and `TOKEN_CACHE` must be explicit absolute paths to existing,
authorized inputs. The Git receipt remains the existing registered tool; there
is no fallback to arbitrary PATH Git. The final manifest is
`coverage/unit/run-python.json`; each run's raw data, JSON/XML, native execution
records and log remain under a fresh `coverage/unit/python/run-*` directory.
Mixed coverage reports are not overwritten. The final aggregate unit gate is
not wired to these reports in this stage.

Focused tests (pure protocol plus tool integration):

```sh
NOTEBOOK_TEST_PYTHON="$PREPARED_PYTHON" \
NOTEBOOK_TEST_TOKEN_CACHE="$TOKEN_CACHE" \
node --test --test-concurrency=1 \
  scripts/coverage-python-protocol.test.mjs \
  scripts/coverage-python-unit.test.mjs
```

The protocol tests are pure unit tests. The runner tests use real Git,
subprocesses, pytest, coverage.py and isolated filesystem fixtures and must be
classified as tool integration. Micro-fixtures demonstrate behavior and complete
fixture denominators, not whole-project coverage. No full project measurement,
CI success or Sonar change is claimed here.


## Entry rejection and report consumption

The report destination comes from this module's own checkout identity, never a
root or output path supplied by the selection artifact. A foreign root argument
is rejected without writing beneath that root. Every successfully written state
for an invocation carries the same fresh `runId` and `startedAt`; consumers must
bind to that invocation's ID and successful process result, not treat an old
`complete` file as current evidence. The final aggregate consumer is still a
separate stage.

If the owned output location cannot be written safely (for example a symlink or
filesystem permission failure), the command fails and emits the failed attempt
and write error on stderr. It does not follow the unsafe path to invalidate a
file elsewhere, and it cannot promise to replace an inaccessible old file. A
failed command or absent matching run ID must therefore never be accepted as a
new measurement.

Failures before the entrypoint can execute (for example a module-load or syntax
failure) likewise cannot produce a new run ID/report. External consumers must
check the command result and expected invocation identity rather than trusting
an earlier manifest's existence. This stage does not claim to authenticate a
report consumed independently of the runner invocation.

## Integrated regression evidence

At integrated revision 842a923, all 21 focused tests passed independently (16 protocol units plus five tool integration tests), including the nested prior-complete invalid-selection/argument and foreign-root cases. The P1 entrypoint stale-report issue was reproduced red and separately reviewed after the fix. The final aggregate consumer still must require the current subprocess result and matching runId; an old file's existence is not a valid pass. This is a tool regression result, not project coverage.
