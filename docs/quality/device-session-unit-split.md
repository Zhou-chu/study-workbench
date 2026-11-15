# Device session core unit split

Base b9606ff. All 23 test functions plus shared helper functions/classes retain identical AST, decorators, parameters and assertions. The mapping file binds all original/new parameterized node IDs and AST hashes.

19 functions/21 cases now independently test authentication core with in-memory storage doubles, deterministic clocks/random data and in-memory asynchronous event gates. Password-provider memory reads remain real pure validation; file reads and thread dispatch occur only in the four retained tool functions (seven cases). Shared fixture module imports no test module. This does not prove real database transactions or thread/filesystem safety by unit coverage.

Prepared offline interpreter/cache, no package installation or service startup:
- Original baseline: 28 passed (0.11s).
- Independent unit: 21 passed (0.13s).
- Original/new combined: 28 passed (0.14s).
- Collection 28 to 28 with only test-file prefix changes.
- Ruff check and format pass after import-only cleanup.

Raw argv/logs are retained privately under `python/device-unit-split/`. No production code, runtime mode, secrets, data, coverage threshold or production denominator changed. These targeted checks are not full-project CI/Sonar or aggregate coverage acceptance.
