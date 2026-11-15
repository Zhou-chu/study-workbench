# Source snapshot request decision units

Base `71c3c704`. 27 cases exercise real SourceSnapshotService.create/_replay
and _provenance, real Pydantic requests/models, text parsing and evidence-record
construction. Storage/repository, lock custody and thread/file publication are
external doubles. The to_thread boundary is intercepted: no thread executes and
no snapshot bytes touch disk. Paths are value objects only. No production or
manifest change is included; suggested unit target is api/source_snapshot_service.py.

Cases cover blank idempotency keys, stale note revision, empty/non-text content,
UTF-8 body and combined title/provenance budgets, absent/foreign/incomplete turns,
receipt hash/operation/notebook conflicts, missing/foreign scope versions,
successful note/turn record assembly, receipt reuse, concurrent commit winner
replay, missing/invalid replay files, and publication/commit failure/cancellation.
Assertions retain concrete error codes/statuses, exception identity, no publish
on rejection, immutable record links/checksums, exact publish arguments and
lock/publication/commit order. Existing receipt reuse does not reread the origin.

The lock double proves only call ordering, not concurrency exclusion. The commit
double does not prove SQL atomicity, CAS or durable receipts. Real file custody,
thread cancellation safety and citation authenticity are not established; this
batch has no direct local citations. Actual file integration tests remain in
`test_v1_source_snapshots.py` unchanged and are not classified as unit.

## Validation

Using the prepared locked Python environment and offline tokenizer:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_source_snapshot_decisions_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_source_snapshot_decisions_unit.py tests/test_v1_source_snapshots.py -q
python -m mypy tests/test_source_snapshot_decisions_unit.py
ruff check tests/test_source_snapshot_decisions_unit.py
ruff format --check tests/test_source_snapshot_decisions_unit.py
```

27 unit cases passed (0.83s); related combined regression 35 passed (0.83s).
Ruff check/format pass. Exact-file mypy has no new-test diagnostics, but native
exit 1 reports four existing imported SDK optional-handle errors at
sdk_adapter.py:540/543/544/545. No ignore/cast/scope reduction was added.

Separate unit-only native coverage: 27 passed (11.21s), module 98/114 lines and
30/42 branches. Comparison against the saved evidence-read-stage report touches
83 previously missing lines and 30 missing arcs. This is a measured intersection,
not a freshly run full-suite union. Whole 181-source denominator is preserved:
24,026 statements, 7,036 branches, 56 default excluded lines. Narrow run totals
623 lines and 56 branches, combined 2.18595%; native exit 1 retains 90.01.
Full-project strict acceptance is not claimed. Raw reports and source hash
comparison remain outside the checkout.

Independent review subsequently approved unit classification and the exact hash
was admitted. See snapshot-source-checkpoint.md for the measured integrated
subset; the narrow report above belongs to its original base, not the later
QA import-adjusted denominator.
