# Source insights and management decisions

Base `7b51a341`. 21 cases directly exercise source insight generation, projection
and deletion functions. Real Pydantic request/response models remain; Source and
Transformation persistence methods and the command-submission boundary are
replaced. There is no ASGI/TestClient, model execution, real file or DB access.

The tests require substantive saved text before transformation lookup/queueing,
reject absent transformations, verify pending response fields and exact queue
arguments, preserve uncertain command identity without replay, preserve
cancellation at each awaited generation stage, and distinguish downstream failure
from success. Insight projection checks order, timestamps and optional defaults;
delete returns acknowledgement only after the awaited domain boundary returns.

This is not a test of actual command execution, database deletion/cascade,
response authorization, transport middleware or durable queue acknowledgement.
SourceErrorProjection tests already cover initial lookup failures; this batch
adds downstream failure paths and user-visible output decisions. No reliability
bug was demonstrated and production behavior is unchanged. Existing tests and
production inventory remain intact. Suggested unit target: api/routers/sources.py.

## Reproduction and results

With the prepared locked Python environment and offline tokenizer:

```sh
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_source_insight_decisions_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache /prepared/tokenizer -- tests/test_source_insight_decisions_unit.py tests/test_source_error_projection_unit.py tests/test_source_input_policy_unit.py -q
python -m mypy tests/test_source_insight_decisions_unit.py
ruff check tests/test_source_insight_decisions_unit.py
ruff format --check tests/test_source_insight_decisions_unit.py
```

21 passed, 1 dependency warning (1.83s); related regression 82 passed, 1 warning
(2.42s). Ruff check/format pass. Exact-file mypy has no test diagnostics but native
exit 1 retains four existing imported SDK errors at sdk_adapter.py:540/543/544/545.
No Any/cast/ignore or exclusions were added.

Separate unit-only native coverage: 21 passed (20.63s). Sources module has
107/560 covered lines and 8/162 branches. Compared with the saved maintenance-stage
baseline, 26 previously missing lines and 8 missing arcs are newly touched.
This intersection is not a measured full-suite union. Most of this router,
including actual upload/file resolution and retry workflows, remains outside
this narrow batch.

Full 181-source denominator: 24,027 statements, 7,036 branches, 56 unchanged
default excluded lines. Narrow totals are 2,236 lines and 38 branches, combined
7.32061%; many executed lines are import/class declarations, not exercised
business paths. Native exit 1 preserves the 90.01 gate. No full-project coverage,
CI or deployment success is claimed. Raw reports and source comparison are
retained externally. Manifest changes are left to independent review.
