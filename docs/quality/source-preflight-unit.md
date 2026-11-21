# Source preflight advisory error boundary

Five direct-function units replace `check_file_support` with synthetic async
results/errors. No parser, real file, provider, database, HTTP stack or subprocess
is invoked. Real metadata-only logger output is captured in memory.

Before the fix, both advisory-failure tests failed because DEBUG output included
the synthetic private path and exception text; the other three passed (2 failed,
3 passed in 2.07s). After the fix, 5 passed in 7.22s, with one pre-existing SDK
Pydantic deprecation warning. ImportError and FileNotFoundError still skip advisory
preflight; an actual unsupported verdict still raises UnsupportedTypeException,
and supported input still passes. Only fixed operation and exception type are
logged, not path, exception prose, or traceback. This does not sanitize every
source boundary or untrusted reason returned by content-core.

Removed `pragma: no cover` from the exception handler: all three lines are now in
the module denominator, which increases from 557 to 560. These five units exercise
the complete preflight helper, not the entire sources router: 75/560 module lines
are executed. No full-suite or whole-project coverage claim is made.

Evidence in `/home/USER/notebook-quality-20261113/python/`:
`source-preflight-red.log`, `source-preflight-green.log`,
`source-preflight.json`, `source-preflight.coverage`.

Reproduce with the prepared virtualenv Python and tokenizer cache:

```sh
python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared-tokenizer -- \
tests/test_source_preflight_unit.py -q --cov=api.routers.sources --cov-branch \
--cov-report=term-missing --cov-report=json:source-preflight.json
```

Production changes are limited to the advisory handler and a fixed logging
operation allowlist entry. No database migration, v2 encryption activation,
deployment, actual credential, or runtime configuration changed.
