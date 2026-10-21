# Environment evidence (2026-10-18 UTC)

- Linux x86_64; Python 3.12.14; Node 24.19.0; npm 11.9.0; uv installed
- 9 CPUs visible; 9.7 GiB RAM visible; ~30 GiB free at start; no GPU requirement or GPU assertion
- Docker absent. Official SurrealDB 2.3.10 binary runs natively. API, worker and Next.js use native user processes
- GitHub, PyPI reachable; NotebookLM public host returns HTTP 301. This is reachability only, not Google authentication
- Home is read-only. Writable caches use /tmp/sw-uv-cache and /tmp/sw-npm-cache; project at requested study-workbench directory
- Production password/key and Google credential/profile creation await user confirmation; tests use nonsecret loopback-only fixture credentials
- Human visible Google login connected to this application's filesystem: not established. Existing assistant browser sessions are not used as application credentials
- Protected external HTTPS URL/port hosting: not yet supplied or verified. localhost is never a delivery URL
- Application state: SurrealDB native data directory; existing SQLite checkpoints at data/sqlite-db/checkpoints.sqlite; originals/artifacts and V1 lockfiles under STUDY_WORKBENCH_DATA_DIR; no new database/queue
- Application restart persistence: verified in native integration; container rebuild: no Docker; workspace stop/deletion persistence: unknown. Export is required for independent ownership

## Updated integration evidence

- Native application restart now verified: original bytes, parsed evidence, notes and source selection survived API process restart
- Real fresh-database/filesystem restoration succeeded after removing the original source directory and SQLite history database; transaction rollback and post-restore re-export checked separately
- OPEN_NOTEBOOK_DATA_DIR retains the existing default but permits fully isolated upstream data/SQLite in test launches
- Official Playwright Firefox 153.0/build1538 downloaded to ignored runtime directory and launches with default settings; installed Chromium fails socket creation (Operation not permitted), so no Chromium pass claimed
- An escalation attempt could not start because the environment wrapper could not create a protected path; no permission or denied-path modifications made
