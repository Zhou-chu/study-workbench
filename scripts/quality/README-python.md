# Full first-party Python coverage

Use the prepared Python environment and tokenizer with `scripts/offline_pytest.py`.
Never use a live API, database, worker, provider credential or opt-in variable for
this baseline. The runner isolates application paths and disables dotenv and
network access through a Python audit tripwire, not an OS firewall. Native or
subprocess network operations require additional isolation if introduced.

`coverage-python.ini` includes api, open_notebook, commands, scripts, deploy,
apps Python tools and run_api.py. Namespace directories are included even when
unimported. Tests, historical docs/evidence, third-party dependencies, caches and
generated builds are excluded. Audit every tracked `.py` against the report:
unknown first-party directories must be explicitly added, not silently dropped.
The 90.01 threshold (two-decimal precision) conservatively enforces >90, not >=90, and is a target, not a claimed result; branch measurement is enabled.
Coverage's combined percentage is not interchangeable with separate line/branch
percentages. Report all three, skips, test failures and unreported files.

Create an external output directory and a copy of this configuration with
`data_file` set to its absolute `.coverage` path, then from repository root run:

```sh
"$PREPARED_PYTHON" scripts/offline_pytest.py --tiktoken-cache "$TOKEN_CACHE" -- \
  tests/ --cov --cov-config="$OUT/coverage-python.ini" \
  --cov-report=term-missing --cov-report="json:$OUT/coverage.json" \
  --cov-report="xml:$OUT/coverage.xml" --junitxml="$OUT/junit.xml" -ra
```

Preserve the complete stdout/stderr and exit code. No automatic installation,
provider invocation, database opt-in or fail-under relaxation is permitted.
This is Python-only: old `frontend/`, new `apps/` and `packages/` TS/JS need
separate coverage and cannot be omitted from a whole-project claim. Code-smell
scoring also needs a named tool and denominator, not conversion from test counts.

Coverage.py reports executable statements as lines and branches. Function coverage is N/A (not measured), not a fabricated conversion. The baseline instruments the current Python process; independent native/runtime/browser or uninstrumented child processes are not merged.

Cross-language artifact tests require prepared Node on PATH. Publication tests require a Git supporting `--no-lazy-fetch` (the tested prepared tool is Git 2.56.0; system 2.43.0 fails). Use only existing tools, for example PATH="$PREPARED_NODE_BIN:$PREPARED_GIT_BIN:/usr/bin:/bin". These are fixture/file tests, not permission to start services or publish anything.
