# Portable restore and queue pure units

Base 9477d8f. Test/document changes only; no deployment, real archives, DB, worker,
filesystem business operations, migration or credential access.

19 pure units execute real PortableService._remap (and all nested transforms) and
request_export. Constructor is bypassed only to avoid filesystem Path.resolve.
Copy-on-read/write memory store and synthetic async locks replace persistence.
Project read and command submission use AsyncMock; no target method is mocked.
This is not transaction, worker concurrency or archive roundtrip acceptance.

Restore assertions protect graph identities (including shared selection/snapshot
IDs), prose/remote IDs, file prefixing, citation downgrade, provenance removal,
historical job non-replay, completed/interrupted status, and both scope hash
algorithms. Expected hashes use independent standard JSON/SHA256 calls.
The synthetic graph is a transformation fixture, not validated archive evidence.
Queue assertions protect persistence-before-submit outside the lock, deterministic
idempotency including whitespace, invalid input/missing project, unknown ack and
cancellation, worker progress preservation, vanished jobs and sanitized definite
failure projection. Raw exception cause is retained; no full logging audit claimed.

Initial run 16 pass/3 fail: fixture passed a positional message to the real
zero-argument CommandSubmissionUnknownError. Corrected fixture, no production RED
or bug fix claimed. Final standalone 19 pass; Ruff check/format and diff pass.
Native complete-source focused coverage: 19 pass in 9.72s, exit 1 because unchanged
90.01% combined threshold is unmet (1.95%). All 180 source files, 23902 lines and
6996 branch arcs, 56 existing protocol exclusions: 513 covered lines (2.15%),
89 covered arcs (1.27%).
Portable module: 178/758 lines (23.48%), 73/382 arcs (19.11%), zero exclusions.
_remap including nested functions: 69/69 lines, 61/62 arcs; remaining branch has
a scope snapshot without enclosing scope_hash. request_export: 35/35 lines,
10/10 arcs. Function figures do not replace module/repository denominator.
Compared with reviewed-unit-subset-0dbdf1a, adds 106 previously unhit portable
lines and 71 arcs (set difference, not a rerun combined gate).
Archive I/O, importer atomic publication and worker execution remain untested.
No shared test-layer manifest edits.

Evidence prefix: <external-evidence>/python/portable-restore
(initial unit log, final green log, coverage log/config/native JSON/data).
Config copies scripts/quality/coverage-python.ini changing only data_file.

Replay from this tree:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-tokenizer-cache> -- tests/test_portable_restore_queue_unit.py -q
Add --cov --cov-config=<external-evidence>/python/portable-restore.ini --cov-report=json:<external-evidence>/python/portable-restore.json for full denominator diagnostic (expected threshold failure).

Test SHA256: 76485e80b703b0fc765ccd5e693229ca642d54e78ff233b430fcb1feefa75f74
