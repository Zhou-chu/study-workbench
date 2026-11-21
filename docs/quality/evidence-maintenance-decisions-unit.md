# Evidence maintenance run and recovery decisions

Base `b396fd53`. 25 strict unit cases execute the real run/dispatch methods,
_can_process and next-dispatch time policy. Only persistence, lock custody,
enqueue and EvidenceService extraction/revalidation are doubled. Store reads
and writes use detached copies so tests cannot accidentally persist changes by
mutating a returned object. No filesystem, DB, model, worker or thread runs.

Cases cover missing/terminal jobs, restored history and replay prohibition,
unknown operations, future leases, queued/running recovery with the original
job/extraction identity, enqueue races preserving worker terminal results,
sanitized enqueue errors, locked terminal/cancellation rechecks, foreign source
scope, successful reparse/revalidate, unavailable originals, remote snapshots,
failed parsing, revalidation errors and retained web Markdown reparsing.
Cancellation identity is preserved at run/dispatch boundaries; locks release and
recoverable running/queued state is not falsely converted into success/failure.

The real lease calculation is checked against before/after UTC observations,
with the timeout environment fixed to 30 seconds. Lock doubles prove ordering
and release only, not real contention or DB isolation. Enqueue races are explicit
synthetic callbacks, not actual workers. These tests do not prove parser or file
custody behavior. The original archive integration suite remains unchanged and
is not counted as unit. Submit/idempotency workflow coverage is outside this batch.

## Verification

Using the prepared locked Python environment and offline tokenizer:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_evidence_maintenance_decisions_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_evidence_maintenance_decisions_unit.py tests/test_v1_evidence_maintenance.py -q
python -m mypy tests/test_evidence_maintenance_decisions_unit.py
ruff check tests/test_evidence_maintenance_decisions_unit.py
ruff format --check tests/test_evidence_maintenance_decisions_unit.py
```

Unit 25 passed (0.69s); related combined regression 31 passed (3.74s).
Ruff check and format pass. Exact-file mypy has no new-test diagnostics but native
exit 1 reports four existing imported SDK optional-handle errors at
sdk_adapter.py:540/543/544/545. No ignores/casts/exclusions were introduced.

Unit-only coverage run: 25 passed (9.75s), module 83/116 lines and 28/42 branches.
Relative to the saved source-snapshot-stage baseline, 71 previously missing lines
and 28 missing arcs were touched. This intersection is not a measured full-suite
union. All 181 production files remain, 24,027 statements and 7,036 branches,
56 unchanged default excluded lines. Narrow run totals 551 lines and 44 branches,
combined 1.91546%; native exit 1 keeps the 90.01 gate. No full-project acceptance
is claimed. Production and manifest are unchanged. Suggested unit target:
`api/evidence_maintenance.py`. Raw evidence and source hashes remain external.

Independent review approved this unit boundary; the manifest now records its
exact test hash. The later integrated measurement is documented in
maintenance-history-checkpoint.md, separately from this narrow report.
