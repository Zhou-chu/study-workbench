# Historical device database test credential wiring

Baseline 8ea6c5a. The historical runner intentionally provisions a random
SURREAL_PASSWORD for its disposable database. Two opt-in native device-session
tests previously signed in with a hardcoded password instead.

Both actual test entry functions now require a nonempty, non-whitespace-only
SURREAL_PASSWORD before constructing any AsyncSurreal connection. Validation uses
strip only for emptiness; the original value is passed verbatim to signin,
including meaningful surrounding whitespace. Username remains synthetic. There is
no fallback literal and the error does not include the password. Random password
provisioning, runner security, production code and real databases are unchanged.

New `tests/test_historical_device_credentials_wiring.py` directly calls both actual
native test functions. A fake AsyncSurreal captures constructor/signin and raises
a BaseException sentinel at signin, before use/query/schema/transaction work. For
missing/empty/ASCII-whitespace/Unicode-whitespace values a constructor trap proves
failure occurs before construction. Four verbatim cases and eight rejection cases:
RED 12 failed in 1.48s, GREEN 12 passed in 1.36s. Ruff/format/diff checks pass.

This is **test-infrastructure wiring validation**, not production unit coverage or
a real database transaction test. No actual PersonalStore, SDK connection, database,
HTTP request or subprocess runs. The real test module is loaded from a static file;
its imports and initial function setup execute, but the fake boundary prevents any
network/database activity. Conservatively classify as tool-integration/test-infra
for the project denominator; do not claim additional production coverage.
The opt-in native transaction/schema tests themselves were not run against a DB.

Evidence directory `/home/USER/notebook-quality-20261113/python/`:
`device-credentials-wiring-red.log`, `device-credentials-wiring-green.log`.
Reproduce using the prepared offline runner with only
`tests/test_historical_device_credentials_wiring.py -q`.

No deployment, real migration, v2 encryption activation or manifest changes.
