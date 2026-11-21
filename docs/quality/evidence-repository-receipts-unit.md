# Evidence repository receipt and invalidation units

Base `acc96ce`; 40 cases in `tests/test_evidence_repository_receipts_unit.py`.
Targets: `_transaction`, `EvidenceEmbeddingRepository.query`, `_invalidate_scopes`
and `source_deletion_barrier` in the real evidence embedding repository.

Only DB connection/query RPCs and project lock are substituted. The fake transaction
wire returns controlled supported or damaged protocol envelopes; it does not parse
SQL or emulate a transactional database. Real receipt validation, exception
sanitization, scope ordering/deduplication, cleanup admission and project-set recheck
execute unchanged. No repository methods are mocked. In-memory async context
managers record lock entry/exit, without flock or filesystem lock files.

Success requires two matching operation-bound receipts and separate invocations
must use different tokens; caller receipt parameters cannot overwrite those tokens.
Malformed/mixed/partial envelopes remain unknown. Only supported abort envelopes
produce domain rejection. Cancellation retains identity and closes the connection
context. Read errors discard diagnostic chains even for recognized typed errors.
Cleanup starts only after acknowledged invalidation and cannot undo revocation on
its own failure. Project locks are sorted/released and a new project observed under
the barrier refuses the deletion body before any transaction.

Existing `test_evidence_embedding_repository.py` uses actual project locks and
contains composed router/native/file workflows. It remains unchanged. Some receipt
policy scenarios overlap existing integration cases intentionally; these new
independent units isolate the protocol without relabelling actual lock/SQL tests.
No production, inventory, thresholds or classification manifest were changed.

40 passed in 4.85 seconds; Ruff format/check and diff whitespace checks pass.
Full target module native coverage summary (import lines included):
{
  "covered_lines": 123,
  "num_statements": 371,
  "percent_covered": 28.598848368522074,
  "percent_covered_display": "29",
  "missing_lines": 248,
  "excluded_lines": 0,
  "percent_statements_covered": 33.15363881401617,
  "percent_statements_covered_display": "33",
  "num_branches": 150,
  "num_partial_branches": 2,
  "covered_branches": 26,
  "missing_branches": 124,
  "percent_branches_covered": 17.333333333333332,
  "percent_branches_covered_display": "17"
}

Measurement used the full open_notebook package, then read the complete target
module record, not a narrowed function-only denominator. It is a targeted
diagnostic, not complete 180-source strict gate coverage. No SQL execution, database
CAS/isolation, real cross-process exclusion, vector publication durability or live
provider guarantee is proven by these fixtures. Receipt success is protocol policy,
not independent proof that a database actually committed.

Reproduce with the already prepared interpreter and tokenizer cache:
```text
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-cache> -- tests/test_evidence_repository_receipts_unit.py -q --cov=open_notebook --cov-branch --cov-report=json:<external-evidence>/coverage.json --cov-report= --cov-fail-under=0
<prepared-ruff> check tests/test_evidence_repository_receipts_unit.py
<prepared-ruff> format --check tests/test_evidence_repository_receipts_unit.py
```
The zero coverage threshold applies only to this diagnostic command. No bug fix or
RED/GREEN production claim is made: these characterize current behavior.
