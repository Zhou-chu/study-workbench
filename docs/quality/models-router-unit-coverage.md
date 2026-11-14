# Models router: direct-function unit coverage

## Scope and isolation

The sole measured test input is tests/test_models_router_unit.py. It calls
production route functions and pure selection/configuration helpers directly,
not TestClient, ASGI routing, middleware or application lifespan. Request and
response DTO validation is real. Database reads/writes, credential lookup,
provider provisioning, discovery/sync/probe services and SDK provider discovery
are replaced at external boundaries. Environment configuration is a synthetic
mapping. No network, database, subprocess, browser or real key is used.

The unchanged models.py source matches the integration worktree exactly:
SHA256 a26707e8961414cf3d2a13f3ce9ab68997e56ded4a9e549ae496343d72951f51.
No production bug was identified or production behavior modified. The first
execution of the new characterization units passed; there is no invented red
bug-fix claim. Existing API/integration tests are retained separately.

## Verification

64 passed in 6.17 seconds. Ruff check, format and git diff --check passed.
Coverage.py module diagnostic, with no source exclusions:
- Lines: 339 / 339 = 100%.
- Branches: 77 / 78 = 98.71794871794872%.
- Combined: 416 / 417 = 99.76019184652279%.
- Missing lines: none.
- Missing branch: 841 -> 824, the false branch of if best_model in
  auto_assign_defaults after available_models was already proven nonempty.
  The real _get_preferred_model returns a nonempty model from such input.
  We do not mock this internal selector to return impossible None merely to
  raise branch coverage, nor exclude the branch.

This is NOT whole-project pure-unit coverage, a Quality Gate result or
end-to-end provider/authorization evidence.

Cases cover optional filtering and credential links; normalized duplicate
lookup and persistence; invalid model types; typed/HTTP/unexpected exceptions;
private error log/response behavior; provider probe success/refusal/failure;
default field presence and required-slot refusal; discovery/sync/count DTOs;
provider mode/SDK capability combinations and unavailable stores; required-only
auto assignment, preference ordering, missing and already-filled defaults.

## Reproduction

Use the prepared Python environment and offline runner, with a separate
COVERAGE_FILE, not the aggregate project report:

python scripts/offline_pytest.py --tiktoken-cache <prepared-cache> --
tests/test_models_router_unit.py -q --cov=api.routers.models --cov-branch
--cov-report=term-missing --cov-report=json:<report-directory>/models-unit.json

Local evidence: models-unit.log, models-unit.json, models-unit.coverage.
Only this independent file was run. Existing mixed test results were not
combined to produce the percentages above.
