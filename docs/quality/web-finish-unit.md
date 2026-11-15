# Web import finish/cache logical units

Base `a6c4017`; 24 cases in `tests/test_web_finish_unit.py`, targeting real
`WebDiscoveryService._finish` and `_cached_response`. Only persistence, native
source availability/ensure, evidence ingest/file resolution and queue submission
are substituted. No target methods or checkpoint methods are patched. No provider,
HTTP, file checkpoint, real lock, database, extraction worker or migration runs.
Constructor receives an inert provider and explicit data-root string. Application
imports may initialize runner-isolated configuration directories; this is not a
filesystem workflow assertion or guarantee of zero import-time side effects.

Finish tests assert exact synthetic snapshot body/provenance and queue arguments,
ensure/ingest/durable-job/dispatch ordering, existing-version recovery, prior worker
ACK reuse, running/succeeded/cancelled-local no-replay, worker result preservation
across ACK success or loss, prequeue failure boundaries and cancellation identity.
Cache tests reject missing/foreign/unavailable sources, check short-circuit order,
and return validated response without provider/extraction/queue replay. Repeated
finish reuses both retained version and worker ACK. The in-memory store deep-copies
rows so late worker mutation is observable rather than object-aliasing camouflage.

Known limits: a queue exception while still queued is classified saved/failed by
current code, not proof that the remote queue rejected submission. This suite does
not claim exactly-once remote delivery. Cancellation preserves queued state without
claiming completion; import_source crash/checkpoint recovery remains integration.
No production, manifest, test-layer threshold or source denominator changed.

24 passed in 4.76 seconds; Ruff format/check and git diff --check passed. Target
module native coverage (whole api package measured; full target module retained):
{
  "covered_lines": 87,
  "num_statements": 224,
  "percent_covered": 35.472972972972975,
  "percent_covered_display": "35",
  "missing_lines": 137,
  "excluded_lines": 0,
  "percent_statements_covered": 38.839285714285715,
  "percent_statements_covered_display": "39",
  "num_branches": 72,
  "num_partial_branches": 0,
  "covered_branches": 18,
  "missing_branches": 54,
  "percent_branches_covered": 25.0,
  "percent_branches_covered_display": "25"
}

This is local directed coverage, not a full 180-source run, a strict >90 gate or
Sonar acceptance. Import lines count in native coverage. Existing file-backed web
service tests remain unchanged and are not relabelled unit. No bugfix RED/GREEN
claim: both measured runs passed (initial 23, final 24).

Reproduce from the candidate with the prepared tools:
```text
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-cache> -- tests/test_web_finish_unit.py -q --cov=api --cov-branch --cov-report=json:<external-evidence>/coverage-final.json --cov-report= --cov-fail-under=0
<prepared-ruff> check tests/test_web_finish_unit.py
<prepared-ruff> format --check tests/test_web_finish_unit.py
```
Zero fail-under applies only to this diagnostic, not repository gate settings.
