# Strict unit aggregate candidate

This is an unaccepted gate implementation candidate, not evidence that the repository meets its coverage target. No full project unit run was performed for this change. Existing mixed reports remain unchanged. Unknown, mixed, stale or incomplete classification still prevents selection and execution.

## Invocation

From a clean reviewed checkout with the existing registered Git and prepared dependencies:

```sh
node scripts/coverage-unit-all.mjs --python=/absolute/prepared/venv/bin/python --tiktoken-cache=/absolute/existing/tokenizer-cache
```

The interpreter is explicitly chosen by the operator, not authenticated by a new interpreter registry. No automatic installation, network download, registration or deployment occurs. Do not run overlapping measurements in the checkout.

## Binding and failure behavior

The entry owns `coverage/unit/run-total.json`. It generates a UUID and writes pending/failed-not-passed state before parsing options, loading selection policy, or reading an artifact. Existing per-partition reports are invalidated too. Output directories must be canonical, without symlink escape. Aggregate writes exclusively create random temporary files and rename over destination links without following them. A module-load failure before this entry executes, inability to write the owned directory, or a same-UID attacker concurrently replacing ancestors cannot be solved by the receipt: consumers must retain the actual invocation exit and expected run identity.

Selection is generated and revalidated against complete tracked inventory, producer identity, classification, test and source hashes. The children run serially. JavaScript receives the parent UUID; Python records its own UUID plus parent UUID. Real spawn status/signal/error is retained. Failure cannot be rescued by a previous report, matching mtime, or self-reported success. Input and complete selection are rechecked between and after children.

The verifier requires exactly eleven JavaScript partitions and one Python partition, with matching combined and individual receipts, same-run IDs and selection bindings. It rereads native execution evidence, rejects extra/missing tests, rereads raw coverage, checks source bytes and full source paths, and reconstructs counters. JavaScript statements/functions/branches come from valid counters/maps; line counts use the native Istanbul per-line union. This is cross-checked against installed Istanbul 3.2.2 and a real Vitest zero-coverage fixture. It rejects map/counter mismatches, negative/fractional counters and positions beyond the source. Summary percentages are never trusted. Python counts are rebuilt from unique disjoint native line and arc sets and compared with per-file and total summaries; source bounds, raw session exit and the receipt are independently checked.

Strict ratios use exact integer arithmetic: each JavaScript metric >90%; Python lines and branches >90%, combined >=90.01%, in addition to native child exit 0. Zero/N/A totals do not pass. Unmeasured JavaScript roots/configuration and tracked shell/PowerShell/batch files are listed and block overall success. This change does not fabricate shell coverage or establish an overall completed CI gate.

## Trust limits

This is a serialized trusted-workspace measurement protocol, not a signature scheme or sandbox for malicious test code. Hashes and native reports detect stale/mismatched/partially modified evidence. They do not authenticate a coordinated forgery of the producer, native maps, summaries and receipts by an actor able to rewrite the whole workspace. Native ESM union remains limited to the already proven pinned mapper and loader boundary; unsupported mappings remain fail-closed. The coordinator does not broaden that boundary.

## Verification and classification

- `coverage-unit-policy.test.mjs`: pure unit counter/identity policy, including native library counter-semantic parity; no test subprocess or filesystem fixture.
- `coverage-unit-output.test.mjs`: tool integration using actual filesystem ownership/symlinks.
- `coverage-unit-all.test.mjs`: tool integration, real CLI startup/invalid-option failure and stale-result invalidation.
- `coverage-unit-verify.test.mjs`: tool integration with real report files and production auditors, explicitly substituted inventory/Git adapters. It is not a complete repository measurement or evidence that all real partitions execute successfully.
- Existing `coverage-unit-runner.test.mjs` and `coverage-python-unit.test.mjs` remain tool integration and exercise real Vitest/c8/pytest plus clearly labeled dispatch fixtures.

Reproduce the short test group with the already prepared interpreter and tokenizer cache in `NOTEBOOK_TEST_PYTHON` and `NOTEBOOK_TEST_TOKEN_CACHE`, then `node --test scripts/coverage-unit-policy.test.mjs scripts/coverage-unit-output.test.mjs scripts/coverage-unit-all.test.mjs scripts/coverage-unit-verify.test.mjs scripts/coverage-unit-runner.test.mjs scripts/coverage-python-unit.test.mjs scripts/coverage-manifest-custody.test.mjs`. No classification manifest is self-approved by this change; independent review must bind new tests before a formal selection can be generated.

Candidate verification: the bounded seven-file regression group passed 82/82, with stable source hashes across the run and ESLint exit 0. This does not exercise twelve real complete repository partitions end-to-end: startup is a real CLI test, raw mapping includes a real Vitest fixture, child runners have their existing native microfixtures, and aggregate report validation uses explicitly substituted inventory/Git adapters. Formal acceptance still needs an independently classified clean checkout and authorized full run; current missing classifications and unsupported language/mapping boundaries must remain blockers.

## Integrated verification at e59e103

Independent seven-file regression: 82/82 passed, no skips/failures, 19.97 seconds. Native manifest custody, pytest, Vitest and c8 microfixtures ran; the aggregate validator still uses documented adapter fixtures. On the real checkout, the new aggregate entry returned exit 1 with phase `failed`, `passed: false` and an empty child list because mixed/unclassified test entries remain. Previous receipt files were preserved privately before invalidation. This confirms the current honest refusal path, not a twelve-partition coverage pass. The checkout stayed clean. Private evidence: `unit-total-integrated-e59e103/`.
