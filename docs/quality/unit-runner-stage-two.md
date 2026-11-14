# Explicit unit runner: bounded stage two

This stage adds an opt-in Node coverage input mode:
node scripts/coverage-workspaces.mjs --unit-selection=/absolute/selection.json

The artifact must come from the same checkout's selector and pass fresh
independent current-input validation. Missing/unknown/mixed/stale classifications
remain blocking. A malformed unit option cannot silently become a mixed run.
Combining unit mode with --only is rejected: all eleven production partitions
remain present. This is not the final unit acceptance gate or a CI workflow.

## Selection and measurement

The pure planner accepts explicit supported test-file paths, not directories,
glob expressions or CLI substring filters. It separates Python unit paths from
Node paths; this runner does NOT execute Python. Unsupported runner paths fail
closed. In particular root-level scripts/*.test.mjs need a future same-partition
Node/Vitest raw-coverage union for quality-tooling; they are not silently routed
to the unrelated node-tools production denominator or omitted.

Vitest receives a generated config replacing test.include with exact files and
retaining original source include/exclude settings. Node suites receive explicit
per-workspace files with original cwd; an empty list spawns no discovered tests.
The instrumenter still runs. Empty Vitest selections use passWithNoTests while
retaining full source coverage. Quality-configs empty selection instruments an
empty Node command. No summary counters are synthesized by production code.

Each partition retains source inventory audit, source/input hashes, exit status,
report freshness/hash checks and before/after selection validation. Unit rows
also record artifact digest, revision, classification digest, selectedTestFiles,
and emptyUnitPartition. selectedTestFiles is the requested explicit input, NOT
an independently observed executed-file list.

## Evidence separation and remaining work

Unit reports, diagnostics, configs and manifests live under coverage/unit/.
Existing mixed artifacts under coverage/ remain unchanged. Existing gate
consumption is intentionally not repointed: it does not yet accept these unit
reports. A later stage must verify actual executed-test identities, support
remaining runner families, join the separate Python result, bind the policy and
report versions, and enforce strict raw per-language coverage thresholds.
Successful orchestration does not imply coverage >90, complete unit
classification, full-project tests, or Sonar Quality Gate success.

Two new test files have different layers:
- coverage-unit-plan.test.mjs: pure planner/config value units.
- coverage-unit-runner.test.mjs: real subprocess/filesystem/Git integration.

Real small Vitest and c8 fixtures prove untouched source entries exist with zero
covered counters and exact selection excludes a neighbouring failing suite.
The eleven-route fixture uses reporter doubles only for dispatch/provenance and
mixed-report preservation; its generated counters are NOT coverage evidence.
The first nested Node test attempt inherited NODE_TEST_CONTEXT and skipped
children. That faulty harness was corrected, then genuine red failures were
recorded before implementing explicit Node selection. Evidence retains both
attempts rather than treating the skipped-child run as a valid green.
