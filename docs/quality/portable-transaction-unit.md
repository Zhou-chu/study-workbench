# Portable restore transaction construction units

Base 1393ae1ca76d739486a6fa38fcdcfa39e126580d. Initial C free
54,754,037,760 bytes (~51 GiB). Initial 0772528 baseline changed tests/docs only; the follow-up below fixes ACK validation.

11 strict units execute real SurrealProjectRepository.commit, nested create/relate,
ensure_record_id/RecordID parsing and personal record_key. Only db_connection and
connection.query_raw are synthetic. No real database, files, network, migration,
deployment or public/main tree changes. No transaction engine is emulated.

The main success case asserts exact ordered SQL statements and complete bound
parameter dictionary: notebook/source/note field whitelist, null omission while
false/empty values survive, source-reference and note-artifact relation directions,
source-owned versus default notebook chat parents, insight defaults and cleared
embeddings, and app_id/payload wrapper for personal records. A malicious-looking
title stays only in parameters, never SQL. Original input is unchanged.
Minimal project emits no extra relations. Missing/non-dict/empty acknowledgment
is unknown, ERR among OK responses is typed rejection, enter/query/exit exceptions
are unknown, and cancellation after dispatch becomes CommitOutcomeUnknown with
original cause retained rather than a false rollback/retry guarantee.

These are SQL construction and response classification tests, NOT proof of
database atomicity/rollback or retained-file behavior. Actual SDK/DB acknowledgement
contract is not exercised. At the original 11-case checkpoint, malformed nonempty result entries and unknown
status values were outside the tested contract. The follow-up below closes that gap.
No production fix or fabricated RED. Initial lint caught a test-authoring multiline
string escaping typo before collection; corrected the fixture only.

Verification: 11 pass in 0.53s standalone, 11 pass in 7.83s with native coverage.
180 production files, 23900 lines / 6996 arcs, 56 existing protocol exclusions.
422 covered lines (1.77%), 33 covered arcs (0.47%), combined 1.47%. Unchanged
90.01% gate exits 1; not full repository success. This baseline has 23900 source
lines, not the earlier 23902; no local exclusions/source edits were made.
Portable module: 104/758 lines (13.72%), 14/382 arcs (3.66%), zero exclusions.
commit including nested helpers: 37/37 lines, 14/14 arcs. Native function coverage
does not replace the full module denominator or enumerate every malformed input.
Ruff check/format and git diff checks pass. Shared classification manifest untouched.

Evidence prefix <private-evidence>/python/portable-transaction:
-unit.log, -coverage.log, .json, .coverage, .ini.
Configuration copied scripts/quality/coverage-python.ini changing only data_file.

Replay:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_portable_transaction_unit.py -q
Add --cov --cov-config=<private-evidence>/python/portable-transaction.ini --cov-report=json:<private-evidence>/python/portable-transaction.json for full-denominator focused diagnosis.

Test SHA256: de676b51c07c6c1333450580c3fa3a7569236865d6a2231ce56e97e81aaf0008

## ACK fail-closed follow-up
Observed RED on original implementation: 15 failed / 11 passed (0.79s).
Non-list nonempty results, non-dict rows, missing/null/unknown/unhashable statuses
either silently succeeded, raised ordinary exceptions, or took ERR rollback before
checking malformed siblings. import_archive retains files only for
CommitOutcomeUnknown and otherwise deletes the destination, so ordinary exceptions
or premature ERR classification could discard possibly committed file references.

Minimal production fix validates result is a list and every row is a dict with
status OK or ERR before interpreting any ERR. Empty responses retain prior unknown
handling. Tuple membership deliberately tolerates unhashable JSON status values
without throwing TypeError. No fixed row count, result payload type, time field
or version-specific BEGIN/COMMIT result count is imposed. Valid OK/ERR semantics
and query/parameter construction remain unchanged.

Compatibility evidence: inspected installed surrealdb/connections/async_ws.py:
query_raw forwards _send(..., bypass=True) response unchanged; query indexes
response["result"][0]["result"]. UtilsMixin checks only top-level error/result,
so these raw statement rows need application validation.
Official Python query documentation describes the RPC envelope with per-statement
status/time/result and ERR rather than automatic raising:
https://surrealdb.com/docs/reference/python/concepts/executing-queries
Local existing native transaction test assertions also expect raw.result iterable
rows with status OK, but no real database was connected/retested in this batch.
These sources justify preserving nonempty list OK/ERR, not assuming result count.

GREEN: 26 strict units plus 2 pre-existing file-boundary regressions passed.
Added 2 tool-integration cases call real import_archive and real repository.commit
with synthetic query ACKs, proving malformed ERR sibling and non-list ACK preserve
nonempty imported original files in pytest temporary directories.
First attempt at those integration assertions used an incorrect nested original
path glob (2 fixture assertion failures); corrected to actual archive flat layout.
Final: 30 passed in 0.49s (26 strict units + 4 tool-integration cases).
No real DB atomicity, remote protocol acceptance or production deployment claimed.
Historical 11-case coverage above is not presented as updated coverage.

Evidence: python/portable-ack-red.log, portable-ack-green.log,
portable-ack-final.log (incorrect fixture glob), portable-ack-final2.log.
Ruff and diff checks pass. CHANGELOG records the user-visible safety correction.

Follow-up SHA256 tests/test_portable_transaction_unit.py: 68bf7c3d320bfbb4dbca79ab4ad4865207b83f9c4ddc320efcecb928ac068967

Follow-up SHA256 tests/test_v1_portable_roundtrip.py: cfb3a0879b88e6632a069f0cac411a72f82b800791131a678cc3f4dab9c66e7e

Follow-up SHA256 api/portable_service.py: a2df4036e2978b199fad5dcd7dbfc93d9fa0387af412a25f1a14ea61837fe772
