# Evidence revalidation orchestration units

Frozen source base: `d26b3fe`. Fourteen new cases exercise the actual EvidenceService.revalidate, _version, list_evidence, evidence and _matches_fresh logic. Only storage get/put/project-lock and the extract boundary (which otherwise parses retained files) are doubled. Records are copied on reads and matching uses independently constructed text, offsets and SHA256 values. No real files, parser process, API, network, database or live notebook data are used.

Cases cover missing versions/history, wrong historical version, unavailable original, remote snapshot, identical old/fresh IDs, restored-archive fresh extraction, failed extraction response, ordinary exception and cancellation identity. Each rejection asserts no revalidation publication, and preflight rejection asserts extract was not called. Ready/partial success compares exact matching versus mismatched quotes, checked/verified/unverified counts, private matched-ID persistence, and the lock-protected latest record reread retaining an independently changed field. Empty history publishes zero counts; corrupted canonical evidence prevents publication even after extraction. The fake lock demonstrates scope and sequencing only, not actual mutual exclusion or transaction durability. Existing parser/confinement/roundtrip tests remain necessary.

Validation:
- New file: 14 passed in 0.31 seconds.
- New file plus extraction-state and metadata-read units: 38 passed in 10.53 seconds with full-source coverage.
- revalidate: 23/23 executable lines, 10/10 branch arcs. Relative to the frozen reviewed-unit report, this run actually exercises 22 formerly missing evidence-service lines and 10 missing arcs. This is raw-set comparison, not a newly executed full-suite aggregate.
- Exactly the same 181 production paths remain in coverage: 24,026 statements, 7,036 branches and 56 existing excluded lines. The narrow run covers 554 statements and 70 arcs, combined 2.0089%; native exit 1 preserves the 90.01 requirement. No whole-project passing coverage is claimed.
- Ruff check and format-check pass. No production behavior, test-layer manifest, ignore list or coverage scope changes.

Reproduction: prepared locked Python running `scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_evidence_revalidation_unit.py tests/test_evidence_extraction_state_unit.py tests/test_evidence_metadata_reads_unit.py -q --cov --cov-config=<external-full-source-config> --cov-report=json:<external-report>`. The configuration copies scripts/quality/coverage-python.ini with only data_file relocated. Raw logs and coverage are external under notebook-cloud-revalidation-results. Independent classification review is required before adding this file to strict selection.

## Fixture type follow-up

Independent mypy review found four fixture typing errors. A local reproduction retained the four diagnostics before correction. Rows now explicitly map identity pairs to heterogeneous JSON-like records (`dict[str, object]`); event tuples explicitly allow the real one- and three-field shapes. The extract boundary uses monkeypatch.setattr instead of assigning to a method. No Any, cast or ignore was introduced, and all assertions including the latest-record marker remain unchanged. Final exact-file mypy has zero errors; Ruff and formatting pass; the corrected fixture reruns pass 14/14 (0.20s) and 38/38 (1.00s). The earlier coverage report remains explicitly from before this fixture-only typing correction; it was not silently regenerated or relabeled.

Integrated checkpoint 2f4c6a2 (with the separate budget fixture type correction):
full locked Ruff/format pass; full mypy drops from 219 errors in 39 files to
213 in 38 files (466 checked). Complete classification has 552 entries and
only the same 158 unresolved mixed errors. Full isolated Python regression
reports 5521 passed, 128 skipped, two warnings and the same seven cloud
historical-runner temporary-parent custody failures. Those failures remain
visible, without changing host permissions or safety checks. This is not a
complete pass or a fresh all-unit coverage union; no production code changed.
