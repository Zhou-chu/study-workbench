# Portable snapshot coordinator units

Base `1393ae1`; 10 cases in `tests/test_portable_snapshot_unit.py`.
Actual `_snapshot`, deep-copy/clean, historical URL marking and `_validate_project`
execute. Only project repository read, store list/project barrier and `_stage_files`
file boundary are replaced. There are no imports of collected tests, real DB/FS
staging, archive compression or user data. The standard `asyncio.to_thread` is real,
but its callable only manipulates synthetic memory and asserts barrier ownership.
Constructor Path.resolve/import-time configuration may touch runner-isolated path
metadata; zero import-time filesystem activity is not claimed.

Cases cover two reads and staging inside the same barrier, detached immutable
returned state, personal collection source precedence, existing note snapshots and
legacy chat, filtering portable-export jobs, removing runtime/secret fields,
historical web URL markers, before/after change rejection, real dangling-reference
validation and propagation from read/list/stage/cancellation with barrier release.
Cancellation is raised by the fake staging callable and propagated through the real
thread await. This does not prove cancellation draining of a still-running real
file-copy thread. In-memory ownership assertions are not database atomicity or
cross-process lock guarantees. Compression ordering is not executed: the test
asserts only the snapshot that a later archive writer would receive.

10 passed in 4.63 seconds; Ruff check/format and whitespace checks passed. Native
full portable_service module counts (including import lines):
{
  "covered_lines": 167,
  "num_statements": 758,
  "percent_covered": 20.70175438596491,
  "percent_covered_display": "21",
  "missing_lines": 591,
  "excluded_lines": 0,
  "percent_statements_covered": 22.03166226912929,
  "percent_statements_covered_display": "22",
  "num_branches": 382,
  "num_partial_branches": 23,
  "covered_branches": 69,
  "missing_branches": 313,
  "percent_branches_covered": 18.06282722513089,
  "percent_branches_covered_display": "18"
}

Snapshot function counts:
{
  "covered_lines": 16,
  "num_statements": 16,
  "percent_covered": 100.0,
  "percent_covered_display": "100",
  "missing_lines": 0,
  "excluded_lines": 0,
  "percent_statements_covered": 100.0,
  "percent_statements_covered_display": "100",
  "num_branches": 6,
  "num_partial_branches": 0,
  "covered_branches": 6,
  "missing_branches": 0,
  "percent_branches_covered": 100.0,
  "percent_branches_covered_display": "100"
}

No production, manifest or denominator changed. The api-wide diagnostic keeps the
whole target module, not just `_snapshot`, in the report. This is not full-project
strict unit coverage, nor a threshold pass. Existing 103 validator and 19 queue/
remap cases are not copied; this exercises their caller coordination and one real
validation rejection. No bugfix or RED/GREEN production claim.

```text
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-cache> -- tests/test_portable_snapshot_unit.py -q --cov=api --cov-branch --cov-report=json:<external-evidence>/coverage.json --cov-report= --cov-fail-under=0
<prepared-ruff> check tests/test_portable_snapshot_unit.py
<prepared-ruff> format --check tests/test_portable_snapshot_unit.py
```
Zero fail-under is diagnostic only; repository gates remain unchanged.
