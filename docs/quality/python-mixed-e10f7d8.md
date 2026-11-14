# Complete mixed Python regression at e10f7d8

This is **mixed regression coverage, not strict unit coverage**.

Frozen commit: `e10f7d89d9c8de85891b0741b840d394817312c5`.
The supported offline runner executed the complete `tests/` collection with
branch measurement and the unchanged full-production coverage policy.

- 4,721 passed; 128 opt-in database/lifecycle cases skipped; 6 deprecation warnings.
  Two originate in third-party packages; four are our existing instance-level
  `model_fields` access in `open_notebook/domain/base.py`, still to address.
- 308.20 seconds. Raw pytest exit **1**, because the 90.01% threshold failed.
- 179 expected / 179 reported production Python files, including tooling.
  No missing or unexpected source files.
- Lines: 17,968 / 23,842 = **75.362805%**.
- Branches: 4,940 / 6,988 = **70.692616%**.
- Combined coverage.py metric: 22,908 / 30,830 = **74.304249%**.
- 56 native Protocol/ellipsis exclusions; no new coverage omission.
- Exact HEAD and all 2,446 tracked input file hashes unchanged during the run;
  checkout clean before and after.

The 128 skipped real-service cases are not passes. This run did not start an
actual database, deploy the application, enable v2 encryption, or establish a
current Sonar gate pass. In particular, the credential-wiring fix has mock
boundary regression evidence but still needs an isolated real-DB rerun.

The separate reviewed unit-subset diagnostic remains documented in
`strict-unit-subset-24f5fe7.md`; do not substitute these mixed percentages for it.
Raw command, pytest log, JUnit, coverage JSON/XML, full-source audit and input
consistency receipts are retained in the private `python/full-e10f7d8` run.
Later test-only splits need their own targeted verification and do not change
which source revision these coverage receipts describe.
