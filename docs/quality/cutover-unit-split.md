# Cutover planner test-layer split

Base: `5a184d4`. No production behavior, source denominator, threshold, or
classification manifest changes.

All 65 original test-function ASTs (decorators, parameter values, assertions and
bodies) are identical. 47 pure planning functions move to
`tests/test_spa_cutover_plan_unit.py`; 18 filesystem/CLI/import-subprocess
functions remain in `tests/test_spa_cutover_plan.py`. Shared synthetic builders
move unchanged to `tests/spa_cutover_plan_fixtures.py`, which is not a test module
and imports neither test file. All moved helper-function ASTs are identical.

The only fixture data read is the checked-in static
`docs/v1/SPA_BROWSER_CASES.json`. Native receipt identifiers in `native_inputs`
are literal synthetic projection fields, not paths opened by the tests. The
planner never executes the suggested transitions. Real reader/CLI safety tests
remain tool integration even though they never deploy or access a real service.

## Local verification

Prepared interpreter:
`<prepared-python>`

Prepared cache:
`<existing-tokenizer-cache>`

Commands, from this isolated checkout (substitute those paths):

```sh
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_spa_cutover_plan.py --collect-only -q
# Above was captured before splitting; after splitting:
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_spa_cutover_plan.py tests/test_spa_cutover_plan_unit.py --collect-only -q
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_spa_cutover_plan_unit.py -q
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_spa_cutover_plan.py tests/test_spa_cutover_plan_unit.py -q
"$PYTHON" -m ruff check tests/test_spa_cutover_plan.py tests/test_spa_cutover_plan_unit.py tests/spa_cutover_plan_fixtures.py
"$PYTHON" -m ruff format --check tests/test_spa_cutover_plan.py tests/test_spa_cutover_plan_unit.py tests/spa_cutover_plan_fixtures.py
```

Before: 156 collected and 156 passed (8.46s). After: 156 collected,
128 unit + 28 tool cases. Independent unit run: 128 passed (6.68s).
Combined original/new files: 156 passed (7.24s). No skipped or failed cases.
`cutover-unit-split-map.json` records all original/new parameterized node IDs and
per-function AST hashes; only file-prefix relocation changes node IDs.
Raw logs: `<external-evidence>/python/cutover-unit-split/`.

This is a test-layer refactor and targeted local regression, not a full coverage
measurement, CI result, live cutover, browser or production acceptance.
