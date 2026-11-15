# Context policy unit evidence

Base `9477d8f`; 32 new cases in `tests/test_context_policy_unit.py`.

Targets: context_builder formatting, prefix normalization, fallback budget search
and source-context assembly. Source.get and Source.get_insights are persistence
boundaries. Real Source and SourceInsight data models and Source.get_context execute;
no target method/output is mocked. Tokenizer availability is forced to OSError,
exercising the documented word-estimate fallback without loading/download of token
files. No other test modules are imported. Import-time application configuration
can create runner-isolated directories; these are not test assertions or exercised
filesystem workflows. No real database, graph runtime, provider or HTTP service.

Existing test_utils covers installed-tokenizer and graph formatting collaboration.
New cases concentrate on fallback exact/maximal whole-word boundaries, unavailable
text, shared insight budget, prefix protocol, explicit source status, later small
insights after an oversized item, storage errors and cancellation propagation.
The fallback is only a word estimate, not an exact model token bound. BPE correctness
is not claimed. No existing test or production source was modified.

32 passed, one existing dependency deprecation warning, 4.55 seconds. Ruff check and
format pass. Full context_builder denominator is retained; raw module counts:
{
  "covered_lines": 145,
  "num_statements": 227,
  "percent_covered": 61.904761904761905,
  "percent_covered_display": "62",
  "missing_lines": 82,
  "excluded_lines": 0,
  "percent_statements_covered": 63.87665198237885,
  "percent_statements_covered_display": "64",
  "num_branches": 88,
  "num_partial_branches": 8,
  "covered_branches": 50,
  "missing_branches": 38,
  "percent_branches_covered": 56.81818181818182,
  "percent_branches_covered_display": "57"
}

The diagnostic covered the whole open_notebook package with `--cov=open_notebook`,
then extracted this complete module's native counts. It is not the full 180-source
strict unit gate and percentages cannot be added to an earlier report. Two initial
module-name --cov attempts failed during collection with NumPy double-import;
using the package source scope avoids coverage's eager submodule import. Those
failures remain in external logs; no production workaround or sys.modules hack.

Reproduce from this checkout with prepared interpreter/cache:
```text
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-cache> -- tests/test_context_policy_unit.py -q --cov=open_notebook --cov-branch --cov-report=json:<external-output>/coverage-final.json --cov-report= --cov-fail-under=0
<prepared-ruff> check tests/test_context_policy_unit.py
<prepared-ruff> format --check tests/test_context_policy_unit.py
```
The zero threshold is diagnostic-only, not a changed gate. Manifest and production
inventory are unchanged. Cancellation test proves propagation from the storage
await, not cleanup of a real provider or durable job.
