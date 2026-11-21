# Enqueue reconciliation and workspace projection unit splits

Base: `1393ae1`. No production, manifest, denominator, exclusion or threshold
changes. New unit files execute existing complete tests unchanged.

## Boundaries

- `test_personal_enqueue_reconciliation_unit.py`: 4 complete test functions,
  10 expanded cases. Actual PersonalService.submit_turn performs idempotency,
  commit/queue/reconciliation ordering and typed uncertainty. MemoryStore is a
  synthetic deep-copy store; its project lock uses only asyncio.Lock/Event,
  not PersonalStore, file locks, DB or real queue. Constructor only retains
  supplied store/submit. The race case uses bounded tasks and finally cancels
  and joins both. Real ASGI receipt cases stay in the old file. The MemoryStore
  fixture self-test stays there too, not claimed as production unit coverage.
- `test_workspace_view_projection_unit.py`: 14 complete functions, 75 expanded
  cases. Actual pure projection and internal DTO schemas consume versioned
  static JSON fixture records. Unknown/invalid proof states, privacy allowlists,
  null/absence, identity, maintenance output and retained history are verified.
  Reading this immutable repository fixture is allowed unit setup. No API,
  persistence or protocol execution occurs. Two actual ASGI cases and the
  upload/capabilities multi-entry budget case stay in the old mixed file.

## Fixture and downstream audit

Shared MemoryStore moved unchanged to `personal_enqueue_fixtures.py`; example()
with its static fixture path moved unchanged to `workspace_view_fixtures.py`.
Both are non-collected files under tests/, not production scope. The original
request_payload fixture is copied identically into both enqueue test modules to
keep local fixture discovery, rather than registering a global plugin or adding
lint suppression. Only this setup node is duplicated; no test is duplicated.

AST scanning all tracked Python found one old-test import:
`test_v1_personal_dispatch_receipt.py` used SnapshotStore from the old enqueue
module. Its import now points to the non-test helper; every downstream test/
function AST remains identical. All 15 downstream cases were collected and run.
No old-module imports or dynamic string references remain for either moved
fixture module. Existing unrelated test imports were not changed.

## Verification

- Original enqueue 8 top-level functions/classes are preserved across old/new/
  helper, with only the identical local request_payload setup duplicated.
- Original workspace 18 nodes preserved across old/new/helper. Parameters,
  decorators, assertions and test bodies all AST-identical.
- Exact native collection mapping including downstream: 106 -> 106 cases.
- New units: 85 passed / 1.21s, no warnings, failures or skips.
- All five collected files: 106 passed / 3.54s, one pre-existing SDK Pydantic
  deprecation warning, no failures/skips.
- Ruff check and format check on seven modified/new Python files; git diff check.
- All 180 tracked first-party production Python sources byte-identical to base.
  Digest `250fe265331e7768cfccbf4d21b45347c7360d24ff89e8a4f06c927fca45e6cd`
  before and after. Exact case map, file hashes and import audit accompany this doc.

Runs use prepared Python with `scripts/offline_pytest.py --tiktoken-cache
PREPARED_CACHE -- <files>`, first `--collect-only -q`, then new units and all
old/new/downstream files with `-q --junitxml=<external report>`. Logs are retained
in the external `python/enqueue-projection-unit-split` evidence directory.
No real service, data, deployment, push, complete coverage run or >90% claim.
Disk free was 50.99 GiB before setup and 50.93 GiB after verification.
