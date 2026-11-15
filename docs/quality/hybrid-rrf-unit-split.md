# Minimal hybrid RRF unit split

Base `2905da4`. Only the complete pure RRF function moves from
`test_workbench_hybrid_retrieval.py` to `test_workbench_hybrid_rrf_unit.py`.
The new test imports no other test module or Harness. Production is unchanged.
The other two early-rejection candidates remain mixed because safely extracting
their shared Harness would expand this batch; no real flock is relabelled unit.

All 45 original test-function ASTs are unchanged. Collection remains 103 cases:
1 independently runnable unit and 102 retained mixed cases. The JSON mapping
records every original/new node ID, preserving all parameter IDs.

Prepared Python `<prepared-python>`
and cache `<existing-tokenizer-cache>`.
From the isolated checkout, run:

```sh
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_workbench_hybrid_rrf_unit.py -q
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$CACHE" -- tests/test_workbench_hybrid_retrieval.py tests/test_workbench_hybrid_rrf_unit.py -q
"$PYTHON" -m ruff check tests/test_workbench_hybrid_retrieval.py tests/test_workbench_hybrid_rrf_unit.py
"$PYTHON" -m ruff format --check tests/test_workbench_hybrid_retrieval.py tests/test_workbench_hybrid_rrf_unit.py
```

Independent: 1 passed, 0.43s. Combined: 103 passed, 3.96s. Ruff check and format
check pass. Raw before/after collection and test logs are under
`<external-evidence>/python/hybrid-rrf-unit-split/`.
No live database/provider, deployment, full coverage or CI claim. Classification
manifest intentionally unchanged for independent parent review.
