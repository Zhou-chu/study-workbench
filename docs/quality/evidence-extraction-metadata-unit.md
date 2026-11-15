# Evidence extraction state and metadata pure units

Base a6c4017, private isolated tree only. C free space checked before work:
55,117,213,696 bytes (~51.3 GiB). No production change, real user data, service,
migration, deployment, push, shared manifest or public frozen tree modification.

## Two related logical units
12 extraction state cases execute the real _extract, _version, Extraction DTO,
build_evidence_records, paragraph offsets and hashing.
Memory store uses copy-on-read/write, synthetic project lock and invalidation;
resolve_file is the explicit file-I/O boundary stub, parser output is synthetic,
to_thread invokes only the fake parser inline, resource slot is a context stub,
and PDF package metadata lookup is replaced. No filesystem, flock, parser process,
thread executor or actual persistence is entered. Constructor is bypassed.

Tests assert running/extracting before parsing, lock release before parse,
records before ready metadata, codepoint offsets/hash, create_only records,
terminal replay avoidance, cross-version rejection, derived-index invalidation
before reparse writes, old readable extraction preserved on failed reparse,
sanitized durable failure with original exception propagated, no false terminal
state on cancellation, partial/PDF metadata, identical immutable-record reuse and
conflict rejection. The cancellation test deliberately documents running state
rather than inventing rollback. It does not validate actual semaphore cleanup.
Actual resolve_file integrity, process/resource isolation, DB atomicity and
invalidation implementation remain outside this unit boundary.

12 metadata read cases execute versions/version/_version/evidence/list_evidence
with synthetic get/list/prefetch only. They assert stable chronological projection,
empty extraction defaults, typed absence, precise read order, no unintended
prefetch, declared evidence membership identity/version/extraction rejection and
explicit read-view batching across READ_BATCH_SIZE without store fallback.

## Verification
Initial lint caught a test-authoring multiline string escaping typo before test
collection; corrected test only. First extraction run 12 pass/0.16s; combined
24 pass/0.45s. No production RED/bug fix claimed.
Native full-source focused diagnostic: 24 pass/8.61s. 180 production sources,
23902 lines / 6996 arcs, 56 existing protocol exclusions retained:
528 covered lines (2.21%), 59 covered arcs (0.84%), combined 1.90%.
Unchanged 90.01% requirement exits 1; not a passing repository gate.
EvidenceService module: 150/424 lines (35.38%), 43/168 arcs (25.60%), zero exclusions.
Target _extract 49/49 lines and 16/16 arcs. Read methods including membership
helper total 35/35 lines, 18/18 arcs. Native arcs do not prove every compound
boolean condition, nor are function figures a substitute for source denominator.
Compared with reviewed-unit-subset-913c480, adds 85 previously unhit target lines
and 34 arcs (set difference, not a rerun combined gate).

Ruff check/format and git diff checks pass.
Evidence prefix <private-evidence>/python/extraction-metadata:
-unit.log, -coverage.log, .ini, .json, .coverage; first extraction-only run in
extraction-state-unit.log. Config changes only external data_file.

Replay:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_evidence_extraction_state_unit.py tests/test_evidence_metadata_reads_unit.py -q
Add --cov --cov-config=<private-evidence>/python/extraction-metadata.ini --cov-report=json:<private-evidence>/python/extraction-metadata.json for native complete-source focused diagnosis.

SHA256:
test_evidence_extraction_state_unit.py: 8d2f0c754e549281f7294177497a5c22ca9c01c7785ebba3951055379947c21e
test_evidence_metadata_reads_unit.py: 63aae2aff571ed788371782af06db5e2fbe172110fc0b567d8bce318399486bb
