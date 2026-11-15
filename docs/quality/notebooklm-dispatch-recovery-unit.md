# NotebookLM durable dispatch and recovery units

Base cd9c3873e1f4b9ff254e7cea7bd5faeeb1111f4a. New tests only; no production,
classification, threshold, deployment or migration changes. Initial C free 50.62 GiB.

The prior frozen-a84cbfb strict-unit report already covers connection verification,
source pagination and mapping refresh. This batch instead exercises adjacent
NotebookLMService._dispatch and dispatch_due_jobs, with real job/_save behavior.
Only persistence, project-lock boundary, queue submission and deterministic clock
are replaced. No bridge methods, SDK clients, profiles, remote notebooks, sockets,
filesystem stores or worker processes execute. The memory store deep-copies values;
its lock records ownership but does not claim real cross-process exclusion.

20 unit cases assert durable lease save before enqueue, enqueue outside the lock,
separate ACK save, latest-state revalidation despite stale caller objects, future
lease suppression, disabled queue, original queue cancellation propagation and
local cancellation preserved across successful/failed late ACK. Error messages do
not retain the synthetic backend detail. Recovery tests cover expired unknown
submission with no replay, confirmed task identity routed only to poll, safe queue
recovery for not-submitted or confirmed-without-task states, unchanged attempt
counters, live/equal-deadline leases, foreign-provider filtering and cancellation
preservation during recovery. The confirmed-without-task path characterizes current
behavior; it does not establish remote exactly-once semantics or queue atomicity.

Verification:
- New tests: 20 passed in 7.06 seconds with native coverage and unchanged 90.01
  threshold; exit 1 is the expected unmet full-source coverage gate.
- New plus existing orchestration/failure unit files: 101 passed in 1.34 seconds,
  exit 0. No existing tests were modified or moved.
- _dispatch: 18/18 lines, 8/8 branch arcs. dispatch_due_jobs: 8/8 lines,
  8/8 branch arcs. Function coverage is not full-module acceptance.
- Complete api/notebooklm_service.py: 100/584 lines (17.1233%), 19/236 branch
  arcs (8.0508%), combined 14.5122%, zero exclusions.
- Full production denominator: 180/180 tracked files, 536/23902 lines,
  35/6998 branch arcs, combined 1.8479%. The 56 existing excluded lines remain
  unchanged. No extra/missing sources. Every production byte equals the base.
- Against frozen-a84cbfb's native missing sets, these tests execute 17 previously
  uncovered lines and 10 previously uncovered branch arcs. This is a set comparison,
  not a new full-suite measurement or a sum of percentages.
- Ruff check/format and git diff checks pass. Initial lint removed one unused test
  import. No failing behavior was invented and no production bug fix is claimed.

Evidence retained privately under python/notebook-dispatch-recovery-unit:
command.json, coverage.ini, raw.coverage, coverage.json, unit.log, regression.log,
increment.json, source-audit.json and exit.txt. Coverage configuration is the
repository's full-source configuration with only its external data_file changed.
Replay with the prepared interpreter:

    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_notebooklm_dispatch_recovery_unit.py -q --cov --cov-config=<private-evidence>/coverage.ini --cov-report=json:<private-evidence>/coverage.json --cov-report=

Suggested classification: unit; target api/notebooklm_service.py. Test SHA256:
bbffde816318d23e856adc4890b3033c123d363b70780e19f469102a6866781f.
All-project strict unit gate and Sonar acceptance remain separate and unmet.
