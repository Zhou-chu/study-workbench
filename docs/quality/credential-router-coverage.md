# Credential route boundary coverage

Focused offline run: 179 passed, 2 existing dependency deprecation warnings.
api/routers/credentials.py: 282/282 statements and 62/62 branches, no exclusions.
Baseline selected existing files: 109 passed, 105/282 statements and 29/62 branches.
No production behavior changed in this batch.

Tests exercise the real FastAPI app/router, request schemas, response metadata,
typed/unexpected error mapping, merged update validation, and synthetic model
cascade/reassignment including undecryptable/empty-linked records.
DB/provider/migration boundaries are replaced with synthetic implementations.
This is not real-provider, database, deployment, authorization E2E, or migration
acceptance. No keys, data or v2 writer activation were touched.

Final command (prepared offline environment):
python scripts/offline_pytest.py --tiktoken-cache <prepared-cache> -- tests/test_credentials_router_boundaries.py tests/test_credentials_api.py tests/test_credential_provider_validation.py tests/test_typed_exceptions_reach_handlers.py -q --cov=api.routers.credentials --cov-branch --cov-report=term-missing

Three test-authoring assumptions were corrected rather than changing application
contracts: discovery serializes model_type:null; modalities is a string list, not
an enum; the mandatory URL+key rule belongs to anthropic_compatible only.
The remaining empty-linked delete branch and non-NotFound domain failures are
reachable business cases, not artificially excluded coverage.
