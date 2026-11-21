# Native runtime transaction unit split

Baseline: 1228417. This is a lossless test-layer refactor, not a production fix or live-runtime acceptance. No artificial failing test is claimed.

Thirteen complete functions, including all decorators/parameter values and assertions, move into `tests/test_spa_native_runtime_unit.py` (31 collected cases). `tests/spa_native_runtime_support.py` is a non-collected helper containing the unchanged helper loader, fake clock, fake wire service and transaction builder. Neither test module imports another collected test module. `Clock` and `helper` remain shared with the lifecycle suite.

## Boundaries independently checked

- Transaction requests use httpx.MockTransport, synthetic byte bodies and response records. Guard and clock/sleep are in-memory substitutes. No listener, socket request, remote provider, worker, DB, ZIP restore or real runtime starts.
- `environments` constructs dictionaries and random synthetic secrets; the tmp_path is only formatted into values. It does not create files or export these credentials.
- Port selection substitutes `select_unused_ports`; validation only inspects the supplied tuple. No port bind occurs.
- Module-origin/version validation compares records. Commit mismatch substitutes the Git boundary and rejects before later source/file gates; it is not evidence that real tools/source custody were checked.
- CLI exit selection substitutes `run`; argparse parses paths but never starts a runtime or writes a receipt.
- Private-directory ownership, executable/link custody, copy_log, fake_run launch/cleanup, real log threads, signals and receipts remain in the original integration suite. Mocking process start does not make that filesystem lifecycle a unit test.

## Exact moved functions

- `test_cli_exit_tracks_actual_result`
- `test_environment_is_minimal_and_secrets_are_separated`
- `test_expected_commit_mismatch_blocks_before_source_gate`
- `test_export_timeout_preserves_original_job_identity`
- `test_incomplete_or_uncertain_transaction_never_passes_or_replays`
- `test_invalid_same_origin_config_never_admits_mutations`
- `test_port_selection_rejects_live_defaults_and_duplicates`
- `test_post_response_ownership_loss_does_not_publish_success`
- `test_request_guard_prevents_any_http_and_counter_increment`
- `test_request_limit_and_deadline_prevent_dispatch`
- `test_same_origin_config_completes_provider_free_transaction`
- `test_transaction_requires_all_native_steps_and_portable_roundtrip`
- `test_wrong_loaded_origin_or_dependency_version_blocks`

## Verification

Before: 79/79 original-suite tests passed. Collection maps exactly to 31 unit + 48 retained cases; mapping back only the test filename produces identical full node IDs, including parameter IDs. AST dump comparison (ignoring source positions) proves all 44 original top-level function/class nodes are preserved exactly across the three files, including assertion and fixture bodies. Production source, coverage denominator, thresholds and classification manifest are unchanged.

After final formatting/import sorting: unit31/31 passed (0.23s); original+unit79/79 passed (1.44s); Ruff check/format passed. No coverage percentage or whole-project gate success is claimed. Classification is left to independent coordinator review.

Run with the existing prepared interpreter:

```sh
python scripts/offline_pytest.py --tiktoken-cache /absolute/existing/tokenizer-cache -- tests/test_spa_native_runtime_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache /absolute/existing/tokenizer-cache -- tests/test_spa_native_runtime.py tests/test_spa_native_runtime_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache /absolute/existing/tokenizer-cache -- tests/test_spa_native_runtime.py tests/test_spa_native_runtime_unit.py --collect-only -q
```

The retained integration tests execute disposable fake-run filesystem/log lifecycle only; these commands do not invoke actual API/DB/runtime prepare or deployment.
