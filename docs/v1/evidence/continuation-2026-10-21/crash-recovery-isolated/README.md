# Native maintenance process-kill check

Run from the repository root:

```sh
.venv/bin/python scripts/v1/maintenance_crash_check.py --out docs/v1/evidence/continuation-2026-10-21/crash-recovery-isolated
```

The test launches its own loopback-only SurrealDB (disk-backed RocksDB), authenticated API and real `surreal-commands` worker against disposable fixture storage. Test-only credentials are literal non-production fixture values. Provider/session variables are stripped and `PYTHON_DOTENV_DISABLED=1` prevents ambient `.env` loading. No Google session or model is configured.

For each of reparse and revalidation, a temporary import in the first worker pauses at the parser boundary, after the real durable job/extraction have entered their running state and while advisory locks are held. The harness verifies the pause belongs to its worker PID, sends SIGKILL to its own worker process group, then starts an unmodified worker. Normal authenticated job-status polling triggers recovery after the production stale-job deadline. It does not edit job timestamps, invoke maintenance directly, replace the store, replace the queue, or shorten recovery deadlines.

Assertions:
- The previous ready extraction and evidence remain readable while parsing is paused and after SIGKILL. The version's maintenance status can be `extracting`; this check does not require the version status to remain `ready` during maintenance.
- Recovery preserves the exact job ID and predetermined fresh extraction ID and ends with exactly two attempts.
- The final current extraction and version are ready, historical evidence remains unchanged, and revalidation checks every historical excerpt against the freshly parsed original.
- Resubmitting the same idempotency key returns the completed job without a third attempt.
- All owned services are stopped on completion or failure.

`results.json` is the authoritative pass/fail output. Logs show HTTP polling and command dispatch. This is an API/worker fault-injection test, not a browser test, host-reboot test, database-corruption test, or proof of Google integration. It uses locally generated historical evidence rather than importing a restored archive; restored-archive trust is covered separately. Worker restart alone is not claimed to recover work without status polling.
