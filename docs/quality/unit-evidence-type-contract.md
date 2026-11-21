# Native execution evidence: typed records and missing exit status

The pytest evidence plugin now describes collected items, reports and the complete record with TypedDict. sessionExitCode is absent before session finish and added there; existing JSON keys, values and serialization remain unchanged. No Any, cast, ignore, rule exclusion or denominator change is introduced. The session-finish update uses a typed dictionary literal rather than keyword arguments unsupported by TypedDict.update's static signature.

Coverage.py's command entry point can return int or None. The empty-partition path retains those exact native values in coverageJsonExitCode/coverageXmlExitCode. Its final process status now uses a pure policy function: None is failure 1, while native 0/2 retain their values and the maximum failure prevails (including None with 2 yielding 2). None is never converted to success. This does not certify complete coverage merely from an exit status; downstream source, execution and report checks remain required.

Ten pure unit cases cover all 0/2/None pairs and the actual ExecutionEvidence callbacks, including collection failures, deselection, ordinary/xfail report flags and the serialized session record. File mkdir/write boundaries are doubles; callbacks and serialization are real. No empty_partition invocation, environment mutation, real coverage process, API or service is launched. The tests do not claim empty-partition end-to-end coverage.

Evidence: initial test run 9 failed / 1 passed (new policy function absent), final 10 passed. An intermediate mypy run exposed TypedDict.update keyword typing, corrected with an equivalent dictionary update; final mypy checks both changed Python files with zero errors. Ruff check and format-check also pass. External red/green/mypy logs are retained under notebook-cloud-evidence-type-results. Existing whole-project type and strict-coverage failures remain independent; no all-project pass is claimed.

## Integrated verification against public df1c7a6

The accompanying validator/selection tests retain all 64 existing cases and
invalid-input assertions. Loader/spec availability is explicit, heterogeneous
malformed values are typed as objects, and a shared entries-list reference
preserves the original mutation of the manifest fixture. Both files typecheck.

At frozen integration c8e47d3, full locked Ruff lint and format pass. Full mypy
reports 219 errors in 39 files (464 sources), versus df1c7a6's 232 in 42 files.
Complete classification has 550 entries and only the existing 158 unresolved
mixed errors; no production source or test is removed from the denominator.

Full isolated Python regression: 5488 passed, 128 skipped, seven failures, two
warnings. The failures are the same seven historical database-runner cases
recorded in the prior cloud run: this host's temporary-parent custody is not
the required root-owned sticky directory. Its permissions and checks were not
changed. Native Python coverage bridge/protocol regression: 20 passed, one
failed because this cloud account has no authenticated Git registration for
the same-checkout artifact boundary. No arbitrary ambient Git was trusted.
Actual native collection, explicit empty coverage, failure/skip records and
collection-error evidence tests passed. Neither result is called a full pass.

Independent source review found no blocking issue in either small change.
The public candidate still needs exact hosted CI; strict coverage and Sonar
acceptance remain unmet. No deployment, database or encryption migration ran.

## Reviewed Python-unit subset measurement

A separate diagnostic run at d32d73e selected the 115 manifest-reviewed Python
unit files, not the unresolved mixed tests: 2508 cases passed with one warning.
Native coverage retained exactly all 181 production Python files, including
application entrypoints and tools, with the existing 56 excluded lines unchanged.
Lines: 12568/24026 = 52.31%; branches: 2973/7036 = 42.25%; combined native
coverage: 50.03%. The unchanged 90.01 threshold exited 1, as required.
Execution evidence recorded 2508 collected cases, 7524 phase reports, zero
deselections and zero collection failures. Sampled and post-run production
hashes matched the frozen commit's blobs. This reviewed-subset diagnostic is
not the complete strict gate or an authenticated selection-runner receipt;
158 unresolved mixed files still block complete acceptance.
