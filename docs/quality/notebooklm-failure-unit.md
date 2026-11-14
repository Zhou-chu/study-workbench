# NotebookLM failure/import/reference unit batch

Base 52f216f. Production unchanged. New test file
`tests/test_notebooklm_service_failure_unit.py`: 30 passed on first execution,
3.82 seconds. No business bug or fabricated failing-test claim.

Single-file module diagnostic: 216/584 lines
(36.99%),
50/236 branches
(21.19%), zero exclusions.
This file adds 104 executed lines relative to the prior 51-case file's line set;
that is not an increment against the separate artifact-job batch.

Actual combined rerun with the 51-case orchestration file and 13-case
`test_v1_artifact_jobs_unit.py`: **94 passed in 4.38 seconds**. Module coverage:
370/584 lines (63.36%),
138/236 branches (58.47%).
The original tool-classified download test file was not included. No whole-project
coverage or gate claim is made; this module remains below 90%.

Boundary contract: real NotebookLMService orchestration, with dictionary-backed
copying get/put and async lock recorder replacing all PersonalStore I/O. Fake bridge
methods replace SDK/network calls. File download and native source persistence are
explicit I/O stubs; evidence ingest/extract/validation are external-service stubs.
No real file creation/deletion, DB, HTTP, browser, subprocess, credentials or remote
mutations occur. Lock recording is not a concurrency/durability proof.

New cases cover confirmed-identity preservation on polling errors, cancellation
propagation (not converted to retry), processing/failed audio status, remote success
retained when download fails, disconnected/missing-identity write refusals, cancelled
write retains unknown intent, typed failure projection, citation outside scope,
missing/ambiguous/stale mapping and nonunique quote refusal, successful exact evidence
validation delegation, metadata-only import, missing remote source, empty or failed
fetch, existing/new synthetic snapshot, and import cancellation propagation.

Remaining gaps include actual download I/O (separate integration), sync/upload,
explicit mapping confirmation, ask dispatch/answer persistence, and recovery/queue
branches. No production behavior, safety guard or cancellation policy was changed.

Evidence directory `/home/USER/notebook-quality-20261113/python/`:
`notebooklm-failure-unit.{log,json,coverage}`,
`notebooklm-three-unit.{log,json,coverage}`.
Reproduce with prepared virtualenv and tokenizer cache using
`scripts/offline_pytest.py --tiktoken-cache <cache> --` followed by the three named
files, `-q --cov=api.notebooklm_service --cov-branch --cov-report=term-missing`.

No manifest edit, deployment, migration or v2 activation.
