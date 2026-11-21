# Portable export worker and verified download units

Frozen source base: `f3e4edb`. The reviewed-unit report left run_export/download business decisions largely unexecuted; existing roundtrip tests use real archive/filesystem fixtures. This batch adds 19 isolated cases without changing production behavior.

Real targets: PortableService.run_export and download. Cases cover initial absent/wrong-operation/historical rejection; early success; locked reread disappearance/historical rejection/success/local cancellation; running attempt increment and acknowledgement recovery; deterministic export identity; export-row-before-success-job ordering; archive validation/internal errors, digest/stat/storage failures with stale-result removal and no successful publication; cancellation identity; download size/hash agreement and missing-export refusal.

Storage is an independent copy-on-read/event-recording double. Project/export locks record scope only, not real concurrent exclusion. Archive construction is a separate I/O boundary doubled at export_project; confinement, file hashing and stat are filesystem doubles. The thread executor invokes only the synthetic hash callback inline. No real file/archive, database, HTTP/API, thread, credential or live notebook is accessed. These tests prove orchestration decisions, not physical confinement, database atomicity, hashing algorithms, lock security or cancellation cleanup in real storage. They do not execute import_archive or replace its integration tests.

Actual validation:
- New test file alone: 19 passed, 0.84 seconds.
- New file plus existing restore/queue units: 38 passed, one dependency warning, 18.82 seconds with complete-source branch coverage.
- run_export: all 39 executable lines and 14 branch arcs exercised; download: all nine lines and four branch arcs exercised.
- Against the frozen reviewed-unit report, 46 previously missing portable-service lines and 18 missing arcs are newly exercised. This is a set comparison, not a newly run full-suite aggregate.
- Full production denominator remains exactly 181 files: 24,026 statements, 7,036 branches, existing 56 excluded lines unchanged. This narrow run covers 559 lines and 107 arcs; combined 2.1441%, native exit 1 because the unchanged 90.01 gate fails. No whole-project pass or >90 claim.
- Ruff check and format-check pass. Production files and the shared test-layer manifest are unmodified. Classify the new file as unit only after independent review.

Reproduce from the checkout with the prepared locked interpreter: `scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_portable_export_worker_unit.py tests/test_portable_restore_queue_unit.py -q --cov --cov-config=<external-full-source-config> --cov-report=json:<external-report>`. The external configuration copies scripts/quality/coverage-python.ini and changes only its data_file output location. Logs and raw native reports are retained outside the repository under notebook-cloud-portable-export-results. No tests were removed or weakened; no production defect fix is claimed.

Integration review retained unit classification. A direct method assignment in
the fixture initially produced one mypy error; the archive boundary now uses
pytest monkeypatch.setattr with automatic restoration, without a cast or ignore.
The integrated 38-case rerun and exact test-file mypy pass. The shared manifest
is updated at integration; the source-only agent did not modify it. No complete
unit-union rerun or whole-suite improvement is inferred from this local result.

## Frozen integrated reruns

At d26b3fe, full locked Ruff/format pass and full mypy remains 219 errors in
39 files (465 checked), with no new type failures. Full isolated mixed Python
regression: 5507 passed, 128 skipped, two warnings and the same seven historical
runner failures caused by this cloud host's temporary-parent custody. No safety
check or host permission was weakened; this is not called a full pass.

The separate reviewed Python-unit subset now has 116 files / 2527 passed with
one warning. Native coverage retains exactly 181 sources, 24026 statements,
7036 branches and 56 excluded lines: lines 12614/24026 = 52.50%, branches
2991/7036 = 42.51%, combined 50.24%. The 90.01 threshold exits 1. This fresh
union actually gains 46 lines and 18 arcs versus the preceding reviewed subset.
Execution evidence has 2527 collected cases, 7581 phases, no deselections or
collection failures; source hashes match before/after. It is still a diagnostic
reviewed subset, not complete strict acceptance: 158 mixed files remain.
