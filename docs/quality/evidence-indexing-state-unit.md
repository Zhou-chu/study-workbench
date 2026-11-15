# Evidence indexing: direct state-machine units

Frozen baseline 2f68bbf. Production code is unchanged; no artificial RED or
functional fix is claimed. Existing test_evidence_indexing_jobs.py uses a real
repository/ACK implementation and real shared filesystem lock paths with a
synthetic database, so it is not imported or relabeled as strict unit here.

The new 32-case file executes real EvidenceIndexingService methods, including
_job, _commit, _update, run's admission/failure paths, reconcile, cancel,
_stop_group and _cancel_child. No service method is mocked. External boundaries:
- store.get returns copied synthetic dictionary rows;
- project_lock and try_project_lock are in-memory async context managers,
  recording admission/release and chosen live/dead ownership, never flock;
- module _transaction is replaced at its DB I/O boundary with a recorder which
  persists submitted values or raises a chosen failure; it is NOT an SQL/CAS
  or database guard emulator and this batch does not prove those guarantees;
- repository cancel/status and provider/queue APIs are explicit stand-ins.
  Provider resolution/embedding/queue stubs fail if unexpectedly called.
- time and feature configuration are deterministic injected boundaries.

Meaningful regressions guarded: no replay of terminal/history jobs; missing or
mismatched identity rejection; metadata-only read errors; task cancellation
propagation and lock release; interrupted attempt becomes unknown rather than
requeued; disabled/malformed consent fails before provider; cancellation stops
the group before child state and confirms only a local attempt fence; failed
fence never becomes confirmed on repeat; live enqueue/run ownership leaves the
durable queued record unchanged while projecting uncertainty; dead ownership
becomes unknown; only this attempt's manifest can confirm success; cancellation
prevents a status read from relabeling the attempt successful.

No actual provider call, filesystem lock, network, DB, browser, or subprocess
participates in a test body. Real schema construction, RecordID construction,
local hashing and internal service helpers remain enabled.

## Verification and complete denominator

- Independent new file: 32 passed in 0.56s.
- Complete-production-denominator diagnostic: 32 passed in 9.05s, but command
  correctly exits 1 because unchanged 90.01 coverage threshold is not reached.
- All 180 production Python sources retained. api/evidence_indexing.py:
  186/454 lines (40.97%), 55/194 branches (28.35%), zero excluded module lines.
- Entire denominator: 763/23902 lines (3.19%), 78/6996 branches (1.11%), combined
  native 2.72%. This is not full-project success or the complete unit selection.
- Ruff check/format and git diff --check pass. Classification manifest untouched.

Still untested here: full preview/content projection and admission, successful
provider batch/publication pipeline, concurrent DB guard behavior and real lock
ownership. Existing integration cases remain necessary; they are not counted as
strict-unit evidence by this batch. No source exclusions or business changes.

Evidence prefix <external-evidence>/python/index-state:
-unit.log, -full-denominator.log, .ini, .coverage and .json. The external config
copy changes only data_file, preserving the checked-in full coverage inventory.

```
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-tokenizer-cache> -- tests/test_evidence_indexing_state_unit.py --cov --cov-config=<external-evidence>/python/index-state.ini --cov-report=json:<external-evidence>/python/index-state.json --cov-report=term -q
```

Test SHA256: `7a2792550e4788c82d91ce625cd586821df85dea2406885c7a96f5955f836d53`.

Integrated review additionally asserts the queried snapshot/profile match the retained job. Initial assertion incorrectly compared native tuple serialization with stored JSON arrays (2 failed/109 passed); corrected to model_dump(mode="json"), not a production change. Combined indexing and native-runtime original/unit regression: 111 passed, no skips. Initial and corrected logs retained privately. Current test hash: `63e896996b9d3202d5e98bf9f8c132bd3b0c31be240a8811a99d9a1a6a2c723c`.
