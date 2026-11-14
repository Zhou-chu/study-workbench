# Credential router direct-unit coverage

The only measured test input is `tests/test_credentials_router_unit.py`.
71 tests passed in 6.03 seconds on the first run. No production change or fabricated
red/green claim is associated with this coverage batch.

`api/routers/credentials.py`: 282/282 executable lines (100%), 62/62 branches
(100%), no excluded lines and no remaining uncovered branches. This is a module
diagnostic, **not whole-project unit coverage**. Existing HTTP/API integration
tests remain unchanged and were not counted in this run.

Tests directly await route functions. Persistence, provider discovery/probing,
URL validation (which can perform DNS), key configuration and migration services
are replaced at external boundaries. Synthetic domain/request DTOs and record-ID
conversion are real. The response projection service is replaced with a narrow
metadata stub; its implementation is not claimed as verified here. No ASGI,
TestClient, real database, network, subprocess, encryption migration or file
mutation runs inside the tests. Production auth middleware is not exercised:
typed HTTP refusal preservation is not an authentication end-to-end assertion.

Coverage includes partial-update field presence, explicit clearing vs omission,
URL preflight refusal before writes, linked-model cascade/reassignment with bound
repository parameters, undecryptable-record fallback, discovered-model DTOs,
registration, migration delegation and typed/unexpected error contracts.
Existing credential logs still interpolate exception prose; this coverage batch
does **not** claim those logs are sanitized. Responses use the existing mapping.

Reproduction from the repository root with the prepared virtualenv:

```sh
COVERAGE_FILE=/home/USER/notebook-quality-20261113/python/credentials-unit.coverage \
/home/USER/study-workbench-deploy-20261107/source/.venv/bin/python \
scripts/offline_pytest.py \
--tiktoken-cache /home/USER/study-workbench-deploy-20261107/prepared-tokenizer -- \
tests/test_credentials_router_unit.py -q --cov=api.routers.credentials --cov-branch \
--cov-report=term-missing \
--cov-report=json:/home/USER/notebook-quality-20261113/python/credentials-unit.json
```

Evidence log: `credentials-unit.log` beside the JSON and coverage data above.
