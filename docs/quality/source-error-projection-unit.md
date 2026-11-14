# Sources error projection: isolated unit batch

Direct function units, not ASGI/TestClient integration. Persistence/status I/O
use synthetic stubs; real route branches and response models execute.
No real DB, provider, credential, service or migration is used.

List/detail/status replace nonempty worker error prose with a fixed message.
No permission or retry classification is inferred from untrusted exception
strings. Lifecycle/owner projection, typed HTTP/domain exceptions, 404 and
unresolved-submission 409 remain unchanged. The progress dictionary is copied,
not persisted. Truncation is explicitly documented as not redaction.

Seven unexpected lookup boundaries log allowlisted operation/type only.
This is NOT comprehensive source logging sanitization: upload/form logs,
other helpers/domain logs and arbitrary progress metadata remain follow-ups.

Initial red: 21 failed. Initial green: 21 passed.
Expanded run had one bad fixture: failed command without owner correctly
projected unknown. Fixture corrected to supply a bound failed owner; no
production safety weakened. Final unit result is 30 passed.

Full sources module unit-only lines: 190/557 (34.11%).
Branches: 35/162 (21.60%).

No new exclusions. This measures this new unit file only, not the whole existing
test union, and does not establish whole-project pure-unit coverage >90%.

Separate regression: 152 passed, two dependency warnings. Its API/integration
cases are NOT called pure units. Files: test_sources_api.py,
test_source_submission_uncertainty.py, test_source_sync_uncertainty.py,
test_source_attempt_ownership.py, test_error_message_sanitization.py,
test_source_path_containment.py, test_boundary_logging.py.

Unit command: python scripts/offline_pytest.py --tiktoken-cache <prepared-cache>
-- tests/test_source_error_projection_unit.py -q --cov=api.routers.sources
--cov-branch. JSON evidence: source-unit-final.json. Red evidence:
source-projection-red.log; separate regression: source-regression.log.
