# NotebookLM service orchestration unit batch

Baseline source a64bf9b; production source unchanged. The single input file is
`tests/test_notebooklm_service_orchestration_unit.py`: 51 passed in 4.23 seconds.
An initial collection failure used pytest's reserved `request` parametrization
name; the test was corrected and its failed collection log retained. No business
bug is claimed, and no production red/green claim is made.

Module diagnostic: 208/584 lines
(35.62%),
71/236 branches
(30.08%), zero exclusions.
Compared by executed line sets with reviewed-unit-subset-9a12228 (56/584 lines,
0/236 branches), this new file executes 152 previously uncovered lines. This
comparison is not a rerun of the full reviewed subset or a combined coverage
claim. The module and whole project are still below the requested target.

The production logical unit is NotebookLMService. Internal methods and DTO/error
logic run for real. A dictionary-backed async get/put stub deep-copies records;
lock context is a synthetic recorder, not a concurrency or persistence proof.
Bridge operations and evidence version lookup are AsyncMock boundaries. No real
PersonalStore, SDK client, HTTP, DB, network, subprocess, browser or file writes
are used in the tests. The 1001-page guard is synthetic and completes locally.

Cases cover complete/empty/incomplete listings, cursor repetition and bounds,
duplicate remote identities, capability recording, disconnected gates, verified
connection states, cancellation/timeout propagation, preserving local cancellation
across late responses, strict capability admission, observed capabilities not
superseding unsupported states, invalid job input, claim state guards, remote
mapping missing/stale/unchanged revisions, exact deduplicated scope snapshots,
and foreign/ambiguous/missing source refusal. The previously existing full job
idempotency example was omitted to avoid duplicating the separately classified
artifact-job unit batch.

Still uncovered here: mutation submission, polling/recovery orchestration,
imports/downloads, reference mapping, confirmation and worker dispatch. Those
require further independent unit batches; no runtime safety claim is inferred.

Evidence under `/home/USER/notebook-quality-20261113/python/`:
- `notebooklm-orchestration-collection-error.log`
- `notebooklm-orchestration-unit.log` (intermediate 43 passed)
- `notebooklm-orchestration-final.log`, `.json`, `.coverage`

Reproduce with prepared virtualenv Python:

```sh
python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared-tokenizer -- \
tests/test_notebooklm_service_orchestration_unit.py -q \
--cov=api.notebooklm_service --cov-branch --cov-report=term-missing
```

No test manifest edits, deployment, real credentials, database changes or v2
activation were performed.
