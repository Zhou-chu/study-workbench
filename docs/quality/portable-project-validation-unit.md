# Portable project validation: direct pure units

Baseline b9606ffa2f19343c072104c44ca7f079469a6aaf. Production code is unchanged.
102 cases independently call real _validate_project, _identity, _clean,
_safe_member and normalize_note_revisions with synthetic in-memory records.
No PortableService instance, real ZIP, file lookup, store, directory, HTTP or
DB is used. PurePosixPath only parses a string; it does not inspect the filesystem.
The source module imports its ordinary dependencies, but tests invoke no I/O
methods. The fixtures do not import an existing integration test or its helpers.

The positive project retains a real block, independently SHA256-hashed quote,
matching locator and verified subquote citation. Negative cases change one
boundary at a time and assert the intended InvalidInputError message, not merely
any exception: duplicate/missing collections, cross-project and dangling edges,
secret/runtime keys, file directory ownership, MIME/provenance validation,
version/extraction agreement, quote digest, exact UTF character offsets/page
metadata, frozen/supplied citation scope, unique subquote and locator agreement.
Revision tests preserve absence->1, exact large positive integers, reject bool,
non-int/zero/negative values, and prove validation failure does not partially
normalize the input. Cleaner tests prove recursive exclusion without mutation.

No production bug was established and no artificial RED is claimed. The initial
86-case batch passed in 0.68s; expanded 102-case coverage batch passed in 8.25s.
Assertions exercise actual guards and outputs; no production method is mocked.
No mutation experiment was needed or claimed in this batch.

## Honest full-denominator diagnostic

Existing scripts/quality/coverage-python.ini was copied to an external run
location with only data_file changed. Its complete source/report inventory,
exclusions and 90.01 threshold remain unchanged. Native report retains all 180
production Python files:
- Target api/portable_service.py: 216/758 lines (28.50%), 118/382 branches
  (30.89%), no excluded target lines.
- Entire selected-run denominator: 618/23902 lines (2.59%), 134/6996 branches
  (1.92%), combined native 2.43%. The command correctly exits 1 for coverage
  below 90.01 despite all 102 tests passing. This is NOT whole-project success.
- Per-function native regions: _identity 5/5 lines, 4/4 branches; _clean 7/7,
  6/6; _safe_member 6/6, 4/4; normalize_note_revisions 10/10, 8/8;
  _validate_project 96/100, 74/80. Nested helpers have their own native regions;
  these figures are not a substitute denominator for the full module/project.

Remaining target boundaries include valid derived/web provenance and derived
citation workflows, staging/archive/repository operations and all real file/DB
paths. This batch deliberately does not execute them or reclassify integration
coverage. No source exclusions, threshold lowering or business behavior changes.

## Evidence and replay

Evidence under <external-evidence>/python/:
portable-validation-unit.log, portable-validation-full-denominator.log,
portable-validation.ini, portable-validation.coverage, portable-validation.json.

```
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-tokenizer-cache> -- tests/test_portable_project_validation_unit.py --cov --cov-config=<external-evidence>/python/portable-validation.ini --cov-report=json:<external-evidence>/python/portable-validation.json --cov-report=term -q
```

Ruff check and format pass. Classification candidate: strict unit, targets above;
manifest is reserved for coordinator review. No deployment/migration/push.

Original 102-case test file SHA256: `0e41d252e262b4aeed59e7cf16cdb08cb417014e55d5cea37acc96c61a1acfbd`.

Integrated extension adds one Chinese/non-BMP codepoint-locator case: the valid citation passes and a UTF-16-style shifted offset is rejected. Current portable file has 103 cases. Combined independent regression with device/note unit and retained tool files: 133 passed, 18 opt-in database cases skipped (not accepted), 1.00s; Ruff/format pass. Current test SHA256: `dc2a13507eb2992f37cd40eb37606d1d0f507ece5f76b22de2f74f14e16142ac`. This does not refresh the earlier 102-case coverage diagnostic.
