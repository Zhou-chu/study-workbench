# Indexing pipeline strict-unit increment

Frozen baseline 2f81790. Chosen from reviewed-unit-subset-0dbdf1a/coverage.json:
api/evidence_indexing.py had 268 missing lines, including input projection and
successful worker execution. Target source bytes are unchanged between that
baseline and this tree (`git diff 0dbdf1a HEAD -- api/evidence_indexing.py` empty).
This adds 22 tests; no production implementation or shared manifest is modified.

## Real logic and boundaries

All service methods remain real: _preview/_inputs, _validate_job/_fields,
_current_profile, _commit/_update, run and preview. The fixture builds a complete
synthetic captured request with genuine schema validation, request hashes,
profile fingerprint, exact Unicode evidence hashes and preview disclosure. It
obtains the preview by executing the real service, not by stubbing the target.

Only external I/O is replaced: store reads/copied rows, repository scope/query,
locked metadata guard builder, attempt registration/vector writes/publication,
transaction ACK boundary, provider resolution/embedding, queue and filesystem
lock boundary. The transaction stand-in records writes; it does NOT implement
or prove DB CAS/atomic guards. In-memory locks do not prove actual flock behavior.
No existing mixed/integration test is imported. No ZIP, filesystem data, real
network/provider, DB, browser, process or live service participates in test bodies.

Meaningful assertions include:
- 17 evidence rows traverse the real BATCH_SIZE=16 as 16+1, preserving identities,
  profile namespace and vectors, with progress after acknowledged writes and
  publication only after all rows; quotes do not enter vector payloads.
- Valid empty input publishes without provider work.
- Registration, provider, batch-write and final-publication failures have distinct
  honest states; unknown errors project only whitelisted codes, not secret prose.
- Short vector responses reject before writes; failed batches never advance to
  another provider call or invent successful progress.
- Cancellation before dispatch admission, after provider completion or after
  acknowledged write cannot publish or overwrite cancellation with progress.
- Tampered attempts fail dispatch admission; disclosure rotation blocks work;
  task cancellation propagates with owned lock release, retaining uncertainty.
- Real input membership/content validation rejects cross-notebook, duplicate,
  missing and hash-invalid evidence before dispatch.
- Preview counts prefixed UTF8 bytes exactly and creates its durable record once.

## Results and honest coverage increment

Standalone: 22 passed in 0.56s. First lint found one unused import, removed before
running; no production RED or bug fix is claimed. Final Ruff check/format and
git diff --check pass.

Full-denominator targeted run: 22 passed in 9.84s, 180 production sources retained,
original 90.01 threshold correctly fails (exit 1):
- Target: 229/454 lines (50.44%), 58/194 branches (29.90%), zero excluded lines.
- Full denominator: 811/23902 lines (3.39%), 81/6996 branches (1.16%); combined 2.89%.
- Relative to the same-source 0dbdf1a report, these tests hit **120 previously
  unhit target lines and 44 previously unhit target branch arcs**. Set-union of
  observed locations would be 306/454 lines and 99/194 arcs. This is an incremental
  diagnostic comparison, NOT an executed combined gate or whole-project pass.

Remaining gaps include full request/retry/dispatch admission APIs and actual
repository/transaction/provider/lock integration. The preceding 32 state tests
are not duplicated as a substitute for this batch's successful pipeline paths.

Evidence prefix <external-evidence>/python/index-pipeline:
-unit.log, -full-denominator.log, .ini, .coverage, .json. External config copy
changes only data_file; source/report inventory and exclusions remain unchanged.

```
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-tokenizer-cache> -- tests/test_evidence_indexing_pipeline_unit.py --cov --cov-config=<external-evidence>/python/index-pipeline.ini --cov-report=json:<external-evidence>/python/index-pipeline.json --cov-report=term -q
```

Test SHA256: `e30c8fae6dd3cf615485e9219a4a48bca0273ab2124088843563e5a9afb70840`.
No deployment/migration/push or full-suite run.
