# Quality-tooling cross-runner coverage: measured feasibility

This is an isolated research result, not production runner support. Root-level
node:test files remain fail-closed until the bounded conversion/merge contract
is implemented and integrated. No coverage percentages were added or averaged.

## Installed tools and primary design sources

Measured versions: Node 24.19.0, Vitest and @vitest/coverage-v8 4.1.12,
c8 10.1.3, v8-to-istanbul 9.3.0, ast-v8-to-istanbul 1.0.8, and
@bcoe/v8-coverage 1.0.2.

Vitest has used AST-aware V8 remapping since 3.2, while the installed c8 converter
uses v8-to-istanbul. Their statement and branch maps are not interchangeable.
Primary sources:
- https://v4.vitest.dev/guide/coverage
- https://github.com/AriPerkkio/ast-v8-to-istanbul
- https://github.com/istanbuljs/v8-to-istanbul

Installed provider.js was also inspected: Vitest parses executed/transformed
code, passes its source map and wrapper offset into the AST mapper, and filters
specific generated SSR nodes. Native V8 ranges cannot simply be combined with
Vitest SSR ranges based on a matching file URL.

## Actual fixture result

One ESM module has choose(flag), positive(), and negative(). Vitest calls the
positive branch; native node:test calls the negative branch. A second complete
source file remains untouched. Both test processes exit zero and the complete
two-file source hashes match before/after each run.

For the branch module alone:

| Measurement | Statements | Functions | Branches | Lines |
| --- | --- | --- | --- | --- |
| Vitest positive | 3/5 | 2/3 | 1/2 | 3/5 |
| c8 negative, original mapping | 7/12 | 2/3 | 3/4 | 7/12 |
| Node negative V8, AST-remapped | 3/5 | 2/3 | 1/2 | 3/5 |
| Compatible-map union | 5/5 | 3/3 | 2/2 | 5/5 |

Thus both single runs are genuinely partial, while the shared function/branch
union reaches 100% without duplicating its denominator.

The untouched source remains 0/1 statements, 0/1 functions, 0/2 branches and
0/1 lines. The full two-file union is therefore NOT 100%: statements/lines 5/6,
functions 3/4 and branches 2/4. Both source files appear exactly once.

The original c8 map is rejected as incompatible. Node raw V8 was remapped with
the same installed ast-v8-to-istanbul version and Vitest parseAstAsync. After
persisting its output to JSON, its statementMap/fnMap/branchMap exactly equal
the Vitest persisted map. Counters were merged using istanbul-lib-coverage only
after that comparison. No location, function name, branch slot or denominator
was rewritten to force a match.

An initial comparison of an in-memory AST result to persisted Vitest JSON
reported unequal because JSON serializes Infinity as null and drops undefined
members. The actual persistent JSON protocol was compared on both sides;
the in-memory mismatch is not concealed or treated as substantive map repair.

The experiment also rejects a deliberately shifted function location and an
otherwise-identical report with mismatched source hashes.

## Reproducibility evidence

The external coverage-union evidence directory retains:
- source fixture and the positive Vitest / negative node:test entrypoints;
- vitest.config.mjs and exact command JSON for both real runs;
- before/after SHA-256 provenance and exit codes;
- original Vitest/c8 maps, native V8 files and selected native record;
- AST-remapped Node map, guarded comparison script, merged map and summary;
- stdout/stderr logs and a machine-readable comparison.json.

The comparison script uses assert.deepStrictEqual on persisted mapping tables
and matching complete source inventories/hashes before invoking the standard
coverage-map merger. This script is a research probe, not an installed
production gate or a self-declared unit test. No project-wide tests or scans
were started.

## Proposed bounded implementation

1. Preserve the complete quality-tooling source inventory from the existing
   Vitest coverage include. Keep untouched TS/config sources at zero.
2. Collect root node:test raw V8 in a fresh isolated directory, with the same
   already-validated explicit test selection and native execution-file audit.
3. For native untransformed ESM sources only, bind source bytes before/after,
   validate URL/range identity, and remap through the pinned AST mapper/parser.
   Do not infer native code bytes for TS stripping, CJS wrappers, loader
   transforms, generated/eval modules, or source-map-cache entries.
4. Require the same complete original-source identity and exact persisted
   statement/function/branch mapping tables for every overlapping file.
   Reject unknown sources or mismatches; never union incompatible map keys.
5. Merge compatible hit counters, regenerate full reports once, and audit the
   complete unique production denominator. Bind converter/parser versions,
   raw input hashes, source hashes and final reports to the run manifest.

Before broad activation, more representative imports/default exports, source
maps and all touched production modules need validation. The prototype does
not prove that every transformed quality-tooling file will match. Unsupported
or mismatching inputs must remain blocking, not be removed from coverage.
The mapper is currently transitive; production use should explicitly pin the
required dependency/toolchain rather than rely on incidental installation.

Python execution and final unit Gate remain separate unfinished stages.


## Implementation checkpoint: pure merge guard (not runner enablement)

`coverage-native-union.mjs` now performs exact complete-source and persisted-map
checks before adding hit counters. It rejects mismatched before/after hashes,
nonzero runner exits, duplicate/missing/extra executed-file lists, incompatible
maps, malformed counts, branch arity differences and unsafe-integer overflow.
It preserves untouched source entries and does not mutate the input reports.
Its 17 tests are pure unit tests of the arithmetic protocol, not tool integration.
The initial test run failed because the implementation did not yet exist; all
17 passed after implementation. A separate experiment also applied the guard to
the actual persisted maps from the feasibility fixture, preserving the untouched
source denominator.

**This API does not authenticate caller-supplied receipts.** The experiment's
selected/executed labels were supplied explicitly and do not prove collector
execution-audit integration. The real collector must still obtain native reports,
verify the execution files using the existing audit, measure actual source bytes,
pin and verify the mapper/parser versions, reject transformations/loaders/CJS/TS,
and independently reconstruct receipts. That collector and runner connection are
not implemented in this checkpoint. The existing root node:test partition remains
fail-closed, so no unverified source or percent-based merge can enter formal
coverage through this helper. No whole-project unit gate is claimed.


## Native collector and runner integration

The next implementation adds `coverage-native-collector.mjs` and connects it to
unit-mode quality-tooling. Root `scripts/*.test.mjs` stay in that partition;
Vitest receives only its explicit files. The workspace captures the complete
production inventory and source byte hashes before Vitest, invokes the collector
only after successful Vitest execution, and revalidates the selection afterward.
The collector independently reconstructs `qualityToolingFiles`, checks all base
report paths and hashes, invokes Node itself with a fresh raw-data directory, and
uses actual native per-file summaries rather than the requested test list.
Only raw records containing a selected test entrypoint contribute counts: the
Node coordinator/reporter process cannot add incidental coverage.

Supported scope is original, untransformed `.mjs` production code on Node
24.19.0. Custom loader registration is blocked in the child process; inherited
NODE_OPTIONS and NODE_TEST_CONTEXT are not forwarded, and implicit TypeScript
stripping is disabled. CJS, TS/JS production reached by native execution,
source-map annotations/cache, generated/eval scripts, unknown project imports,
incomplete worker raw records and incompatible persisted maps fail closed.
This is validation for reviewed repository tests, not a sandbox against malicious
same-user code deliberately tampering with its own measurement.

Direct exact dependency pins now include ast-v8-to-istanbul 1.0.8,
@bcoe/v8-coverage 1.0.2, istanbul-lib-coverage 3.2.2,
istanbul-lib-report 3.0.1 and istanbul-reports 3.2.0; Vitest and its V8 provider
remain 4.1.12. Installed package versions are checked before collection. No
c8/Istanbul map is merged with the AST maps. Exact common maps are required,
then hit counters are added and all output reports regenerated from one map.

Evidence retains the original Vitest map, execution report, source snapshot,
Node log and raw records, remapped native map, exact runtime/converter versions,
source/test hashes, actual executed files and input/output report hashes. The
collector's positive integration fixture uses its actual CLI, both native runners
and real mapping libraries: each single run leaves an opposite branch/function
uncovered, their shared module becomes fully covered, and a second untouched
source remains zero. Whole-fixture coverage is therefore NOT 100 percent.
Existing eleven-partition orchestration regression still uses reporter doubles
for routing only; it is not a full-project coverage run. Python and the final
strict unit gate remain separate work. Classification of new tests must be
reviewed independently before the full selector will accept this checkout.


Final verification: the stable 83-test bounded regression passed in 29.63 seconds
with identical before/after source hashes, ESLint success and clean diff checks.
After the pause, those bytes and reports were verified unchanged rather than
rerunning that batch. Three additional collector integration cases cover actual
empty Vitest selection with a complete zero denominator, mutation of production
source by a real Node test, and mutation of the selected test itself. The updated
15-test collector suite passed in 12.43 seconds with stable source hashes and
ESLint success. These fifteen tests are tool integration (real subprocesses and
filesystem), not unit tests. The arithmetic guard's seventeen tests and partition
planner's ten tests remain pure unit tests. No full-project coverage percentage
or final strict unit gate is inferred from these bounded results.


External-import review correction: file-URL imports outside the production/test
inventory are no longer silently ignored. Only the exact owned reporter runtime
(with a recorded byte hash), or packages anchored to the collector's actual
node_modules realpath and enumerated by its package-lock.json, are permitted.
Package names/versions must match the lock and nested package boundaries are
checked; a path merely containing the string node_modules grants no exemption.
Observed dependency bytes and the lock are hashed and rechecked before writing
results. This is installed-dependency provenance, not third-party code authenticity.

The collector CLI is not an authentication service for caller-supplied Vitest
JSON. The trusted boundary is coverage-workspaces' serial execution: it validates
the bound selection, snapshots source before running Vitest, checks its successful
exit, then invokes this collector and revalidates afterward. Supplying fabricated
CLI input does not produce a trusted gate artifact. The final coverage/unit gate
has not yet been connected; this implementation does not claim that end-to-end
acceptance is complete.


This external-file check is post-execution provenance validation, not an import
sandbox: an unknown module may execute before the result is rejected. It cannot
contribute an accepted coverage report. The external-import regression first
failed with `Missing expected rejection` under the old implementation. The final
18 collector integration tests pass (32.93 seconds), with identical source
hashes before/after, ESLint success and clean diff checks. No full-suite rerun or
final gate acceptance is claimed for this follow-up.
