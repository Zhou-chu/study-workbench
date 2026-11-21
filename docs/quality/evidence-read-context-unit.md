# Request-local evidence read context units

Base `68ae01c`. New tests exercise real `EvidenceReadContext` and `record_key`;
only scalar and bulk persistence methods are replaced. No filesystem, database,
network, ASGI routing or service startup is involved. No production changes.

The 21 cases cover first-read reuse and nested result detachment, cached missing
records, kind isolation, malformed identities rejected before cache hashing,
bulk de-duplication/order and cached-key skipping, valid-prefix consumption before
an invalid identity, and exception/cancellation identity with retry after failed
reads. Bulk fixtures follow the actual raw-row protocol (`payload` envelope or
None), unlike scalar reads which return decoded payloads.

Prefetch intentionally defers invalid IDs to later scalar consumption and stops
at the first invalid ID. A missing prefix row remains observable before that
invalid ID. The tests do not reinterpret this as eager validation of all input.
This cache is not an atomic database snapshot, a transaction, a persistent cache,
or a guarantee against concurrent writes. Caller-result detachment is verified;
no claim is made that arbitrary later mutation of a bulk producer-owned raw row
is isolated. External adapter batching and database correctness remain outside
these units.

## Verification

Run using the prepared locked environment and offline tokenizer:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_evidence_read_context_unit.py -q
python -m mypy tests/test_evidence_read_context_unit.py
ruff check tests/test_evidence_read_context_unit.py
ruff format --check tests/test_evidence_read_context_unit.py
```

Exact-file mypy and Ruff check/format pass. Plain unit run: 21 passed (0.58s).
Unit-only native coverage run: 21 passed (9.54s). Related regression including
`test_evidence_metadata_reads_unit.py` and `test_personal_store_bulk_unit.py`:
41 passed (1.03s). Module coverage is 25/25 lines and 8/8 branches. Intersection
with the saved core-security reviewed-unit baseline finds 19 newly touched
missing lines and 8 missing arcs, not a freshly measured combined-suite union.

The full 181-file production inventory remains: 24,026 statements, 7,036 branches,
56 unchanged default excluded lines. This narrow run covers 319 lines and 28
branches overall (combined 1.11712%); native exit 1 preserves the 90.01 gate.
No global strict-unit or full-project acceptance is claimed. Independent review approved the `unit` entry targeting `api/evidence_reads.py`;
the manifest records its exact hash. See evidence-read-checkpoint.md for the
subsequent combined reviewed subset. Raw evidence remains outside the repository.
