# Portable budget and in-memory archive verification units

Base 2dadeee. Initial free disk 50.39 GiB. Tests/docs only; classification manifest,
production sources, runtime, data, thresholds and deployments are unchanged.

The 257-line uncovered target was scripts/v1/portable_limits_check.py, not the
24-line api/portable_limits.py. Most of that acceptance script launches native
services/browser or performs large-file I/O and is deliberately NOT called here.

29 unit cases execute real budget parsing/public projection and verify_archive.
Budget cases cover all three configured knobs with invalid/nonpositive/unsafe
integer inputs, exact minimum and JSON-safe maximum including multipart overhead,
complete default projection, detached public dictionaries, frozen values and fresh
configuration reads. Environment changes are scoped test substitutions, not host
configuration changes. Existing mixed HTTP tests are unchanged, not relabelled.

Archive cases independently construct small synthetic ZIP bytes with standard
zipfile, not the production fixture generator. The payload is abc with its fixed
known SHA256. Actual ZipFile parsing, member streaming/hash, declared sizes,
manifest membership, format version and artifact metadata checks all execute.
The BytesIO carrier supplies memory-only stat size; only the physical file_hash
boundary is replaced. Stored and deflated archives produce exact summary values.
Corrupt member hash/size, absent/extra members, bad format, artifact identity/size,
artifact count and dangling artifact path reject before the success-report outer
hash call. Expected errors characterize this developer verification helper,
including AssertionError/KeyError; they are not public API error contracts.

No real archive path, user file, HTTP, socket, browser, SDK, DB or process is used.
Loading the script imports existing local_check definitions and resolves its source
root, but does not run main or fixture/environment launch functions. This is a
module unit with in-memory standard-library codecs, not runtime acceptance.
No outer-file hashing, physical custody, compression-bomb budget, browser playback
or actual >100 MiB transport guarantee is proved. Those unexecuted paths remain
in the production denominator.

Verification: 29 passed in 4.89 seconds. Native full-source coverage retains all
180 tracked Python production files with no missing/extra entries and identical
base source bytes. Totals: 249/23902 lines, 13/6998 arcs, combined 0.8479%; native
exit 1 preserves the 90.01 threshold. Existing 56 excluded lines unchanged.
api/portable_limits.py: 24/24 lines and 2/2 arcs. verify_archive: 19/19 lines and
4/4 arcs. Complete portable_limits_check.py: 46/257 lines, 5/40 arcs; 211 lines
remain uncovered. Relative to frozen-d36ebf4 missing sets, API adds 2 lines/1 arc,
script adds 46 lines/5 arcs (including module imports/definitions and main guard,
not 46 newly exercised business statements). No full-suite percentage is inferred.

Ruff initially flagged compressed test fixture statements; format expanded them
and all checks passed before execution. No production bug or fabricated RED is
claimed. Evidence remains private under python/portable-budget-unit: command.json,
coverage.ini/raw.coverage/coverage.json, unit.log, exit.txt, increment.json and
source-audit.json. Config differs only in external data_file.

Replay with the existing prepared interpreter/cache:

    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_portable_budget_unit.py -q --cov --cov-config=<private-evidence>/coverage.ini --cov-report=json:<private-evidence>/coverage.json --cov-report=

Suggested unit targets: api/portable_limits.py and scripts/v1/portable_limits_check.py.
Test SHA256: 6fdb3fe8f19cb2486eaa5593bb735378f1f7bb55111d01301b2a7adb3285a7c4.
All-project strict gate and Sonar acceptance remain unmet and separate.
