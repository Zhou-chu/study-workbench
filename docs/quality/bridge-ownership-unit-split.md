# Bridge and source ownership unit split

Base: `6a2550d`. No production, manifest, coverage exclusion, deployment or service changes.

## Preserved behavior and boundaries

- `test_command_submission_unit.py`: direct bridge admission, identity validation, cancellation/deadline and bounded cleanup, plus independently targeted Source vectorize/add_insight unknown-outcome propagation. AsyncSurreal and registry schema lookup are doubles; asyncio events/tasks/semaphores are the bridge own synchronization, not external coordination. Pydantic CommandRequest/Input and RecordID are value objects. No real SDK retry policy runs here.
- `test_async_command_submission.py` retains all five complete compatibility functions: exact locked SDK wire parity; SDK unknown-create retry; Note/CommandService-to-bridge responsiveness; invalid receipt/cancellation SDK retry; external cleanup cancellation through SDK retry. They remain component integration, not unit.
- `test_source_attempt_ownership_unit.py`: claim_retry malformed acknowledgement/cancellation uses fake db_connection/query_raw. Worker admission Source.get/start_worker/graph are doubles and stop before graph or finish_worker. Create path save/association/bind/queue/status/chunk boundaries are doubles. Pending get_source_status replaces lookup/reconcile and returns before SDK reads. Portable `_clean` and Source save-data projection operate on in-memory values. No actual CAS database guarantee is established.
- Old source ownership file retains both complete cross-view list/detail/status and retry refusal functions. Real read-projection cooperation must remain component integration even though DB calls are doubles.
- Shared Choice/Input/submit definitions live in non-collected `tests/command_submission_fixtures.py`; no imports from old collected tests. Identical backend pytest fixture remains locally in both bridge files, preserving scope without global registration. This duplicates setup only, not test assertions.

## Evidence

Evidence directory: `<private-evidence>/python/bridge-ownership-unit-split`.

- Before/after collection: 70 -> 70 identical expanded case suffix multisets, parameter IDs retained. Full mapping and file hashes in adjacent JSON.
- All 24 original bridge top-level class/function definitions and 10 source definitions are AST-identical across destinations. The duplicated backend setup AST is identical in both files.
- New unit files: 49 passed, one existing SDK Pydantic deprecation warning, 1.53 seconds.
- Original retained plus new files together: 70 passed, same warning, 1.34 seconds. No skips or failures.
- Full tracked Python AST scan for Import/ImportFrom and dynamic string references found no downstream imports of either original test module, before or after split.
- Ruff check/format and git diff --check passed.
- All 180 first-party production Python files unchanged byte-for-byte against base. Sorted path-NUL-content digest: `71eddbf2136bb8c3891826d8f9a677db81f92e5d6004a4a6aec39a7644eba384`.

Runner: prepared Python invoking `scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> --` followed by the relevant file paths and `-q` (collection adds `--collect-only`). PATH uses prepared Git and Node24 before /usr/bin:/bin.

Existing frozen90315ef strict-unit baseline had bridge 17/67 lines, 0/14 branches, ownership repository 12/60 lines, 0/22 branches. This split promotes previously mixed isolated cases, but no fresh full-unit coverage or global >90 threshold claim is made. It does not replace real database/SDK integration testing.
