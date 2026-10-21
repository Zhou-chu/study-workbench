# StudyWorkbench V1 runbook

## Status and boundaries

This branch extends Open Notebook rather than replacing it: Next.js, FastAPI, SurrealDB, the existing surreal-commands worker, Esperanto and LangGraph remain in place. See `ACCEPTANCE.md` for actual versus simulated results. The local document workflow is implemented; full personal NotebookLM acceptance remains blocked by account authorization and SDK strict-history isolation. No public deployment URL is provided.

Use a single Linux host with Python 3.12, Node >=22.13.0 (Node24.19.0 verified), uv, and native SurrealDB 2.3.10. The verified cloud used Python 3.12.14 and Node 24.19.0, with 9.7 GiB RAM visible. Do not run heavy frontend builds and full backend tests together on a small host.

## Reproduce the source environment

The original upstream commit and license are recorded in `UPSTREAM.md`; `uv.lock` and `frontend/package-lock.json` are included. No environment, cache, dependency install, Google profile, or production credential is included in the source archive.

```sh
UV_CACHE_DIR=/tmp/sw-uv-cache uv sync --frozen
npm ci --prefix frontend --registry=https://registry.npmjs.org --cache=/tmp/sw-npm-official-cache
mkdir -p .runtime/bin
curl --fail --location https://github.com/surrealdb/surrealdb/releases/download/v2.3.10/surreal-v2.3.10.linux-amd64.tgz -o /tmp/surreal-v2.3.10.tgz
tar -xzf /tmp/surreal-v2.3.10.tgz -C .runtime/bin surreal
sha256sum .runtime/bin/surreal
```

Verified executable SHA-256: `bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7`. Obtain software only from the stated official source. SurrealDB has its own BSL 1.1 license; application MIT does not relicense it.

```sh
UV_CACHE_DIR=/tmp/sw-uv-cache uv run pytest tests/ --junitxml=docs/v1/evidence/python-tests.xml
cd frontend
npm run test
npx tsc --noEmit
npm run lint
INTERNAL_API_URL=http://127.0.0.1:5055 npm run build
cd ..
UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/local_check.py
```

`local_check.py` starts a fresh DB, API and worker in one process tree, with fixed public nonsecret test values. It exercises actual HTTP and CPU extraction, and stops services afterward. It performs no Google or model call. Each run has an independent `.runtime/check-*` folder with logs and JSON results. These fixtures must never be used as deployment credentials.

## Browser verification

The UI test requires Playwright in the Python selected by the `python` command plus an installed browser. The verified cloud already had Playwright installed; official Firefox was installed in `.runtime/browsers` because installed Chromium could not create its singleton Unix socket under the sandbox. No OS security settings were changed.

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" python -m playwright install firefox
STUDY_WORKBENCH_BROWSER_PYTHON="$(command -v python)" \
  PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" STUDY_WORKBENCH_BROWSER=firefox \
  UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/local_check.py --browser
```

The orchestrator invokes `STUDY_WORKBENCH_BROWSER_PYTHON` (default `python`) for the browser script. The command above captures the pre-uv Python where Playwright was installed. If Playwright is installed only in a separate Python environment, place its interpreter on PATH or install the official Playwright package in your chosen test environment. The test uses public fixtures, isolated loopback services, and clean temporary browser configuration. It asserts ten known citations across two PDF versions, nonblank canvas pixels, correct physical-page controls, an explicit malformed-PDF fallback, restored unverified references and Chinese 390px content widths/no horizontal overflow. No user desktop or existing browser profile is touched.

## Private runtime (credentials remain external to source)

`.env.v1.example` lists configuration names only. The native launcher does not generate or distribute credentials. An authorized operator must provide a dedicated runtime environment file outside exported source, readable only by its owner (mode 0600), containing at least:

- `OPEN_NOTEBOOK_PASSWORD`: application bearer/login password
- `OPEN_NOTEBOOK_ENCRYPTION_KEY`: upstream provider-credential encryption key
- `SURREAL_PASSWORD`: native database password

Use strong independent values; never paste them into chat, commit them, or include them in project exports. The launcher's checks reject empty and test-only placeholder values. Explicit blank credentials remain blank (required credentials fail closed); known optional data paths, database identity/URL and API/CORS settings use launcher defaults when blank. Runtime storage cannot be the source root or an ancestor; ambient provider credentials, credential-file variables, proxies and interpreter overrides are not inherited. Only PATH, locale, timezone and terminal settings are inherited. Config interpolation is disabled, so use literal values rather than `${VARIABLE}` references. Config must be a current-owner mode-0600 regular file outside the source tree, with no symlink components. The launcher forces database authentication, disables implicit dotenv loading and exception-frame diagnostics, and uses umask 077 with owner-only logs.

```sh
UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/run_native.py --config /path/to/authorized-runtime.env
```

Next.js rewrites are compiled at build time; keep the upstream API port5055 used by this launcher, or rebuild with a matching INTERNAL_API_URL. Runtime API_URL alone does not change the compiled proxy. Build with `INTERNAL_API_URL=http://127.0.0.1:5055` to avoid IPv6 localhost mismatch.

Startup refuses occupied ports, waits for database/API/frontend HTTP health and worker database-listener startup evidence, and checks Linux listener addresses. Worker startup evidence is not a successful job-execution test; verify a public-fixture upload separately before relying on processing. Failed readiness stops all owned process groups, including npm descendants; shutdown does the same. This binds only to loopback: frontend 13000, API 5055, SurrealDB 18000. The frontend address is local to the process environment and is not an external user-accessible URL. A separately authorized protected HTTPS ingress is needed for external browser use. Do not expose database/API ports directly. Private mode is enabled by default across legacy and V1 `/api/*` routes, and the launcher forces it on. Missing application password fails closed. The test-only `STUDY_WORKBENCH_PRIVATE_MODE=0` compatibility setting is not a deployment recommendation.

## Persistence and backup

- SurrealDB native RocksDB data: `.runtime/data/surreal.db` by default
- Immutable originals, parsed evidence, artifacts and locks: `STUDY_WORKBENCH_DATA_DIR`
- Existing upstream SQLite checkpoints, uploads and podcast files: `OPEN_NOTEBOOK_DATA_DIR`, native-launcher default `.runtime/data/upstream-data`
- `STUDY_WORKBENCH_RUNTIME_DIR` selects the native runtime/log root
- Google application profile, if later authorized: `NOTEBOOKLM_STORAGE_PATH`; never included in portable export

Application-process restart was tested with actual disk-backed SurrealDB. Filesystem state is shared across command invocations, but this cloud gives separate PID/network namespaces per command. Services and browser tests must therefore be launched together. Workspace stop/deletion and externally managed host lifecycle guarantees are unknown. Back up the full runtime while stopped for operational recovery; use portable project exports for independent project ownership.

## Google connection and future acceptance

See `NOTEBOOKLM_SDK.md` for the exact supported SDK operations and honest limitations. A visible/manual login in the application runtime is required; an assistant's existing Google connection is not an application credential. No password or cookie upload field is provided. The web connect flow reports instructions; it does not pretend a runtime sign-in occurred. Production profile setup still requires the user's targeted authorization.

`make v1-live-check` is inert by default and prints a blocked result. Only after authorized runtime login may an operator set `STUDY_WORKBENCH_LIVE_READONLY=1` to verify authentication plus notebook listing. This does not authorize remote create/upload/generate actions. Even successful authentication does not remove the strict-chat isolation blocker in SDK 0.8.5. Do not bypass that guard or delete Google conversation history to manufacture a fresh turn.

## Operations and recovery

- Originals are immutable by version; upload a new version instead of overwriting
- PDF image-only pages show `needs_ocr`; OCR is not included; malformed/encrypted/over-limit files fail explicitly
- Text/PDF locator offsets refer to retained extraction text; the reader shows physical page and quote, not invented PDF bounding boxes
- A provider write with uncertain submission is `submission_unknown`; inspect the remote account before any new explicit submission
- Local cancellation stops waiting where possible; remote work may continue
- Restored jobs are historical/cancelled locally and cannot replay Google writes
- Imported citation positions remain readable but archive-supplied verification claims are downgraded to unverified; use the local revalidation workflow below to independently check retained originals.
- For failures inspect the isolated runtime logs; never publish full logs containing real credentials or private source content

## Local maintenance workflow (2026-10-20)

1. Open a retained source original in the reader. “Reparse” creates a fresh extraction; for a restored extraction, “Revalidate historical references” compares retained historical evidence with independently parsed original bytes. Neither action calls Google or a model.
2. Keep API and worker running. The reader polls the returned durable job. If status retrieval fails, recheck that existing task rather than submit a duplicate. After a failed terminal operation, an explicit retry uses a new idempotency key.
3. Status polling can redispatch a stale queued/running local job after its dispatch deadline. Recovery retains job/extraction identity and uses per-job locks. It is not a background scheduler when nobody polls; restored jobs are excluded from replay.
4. Read checked/verified/unverified counts. Missing originals, integrity failures, extraction failures and unmatched evidence are not successful verification. Partial results stay visible. Verification establishes quote/location agreement only, not that an answer is true or in its frozen scope.
5. Historical citation IDs, locators and stored snapshots remain unchanged. Reparse keeps historical reading anchored to the selected evidence; a failed/restarted reparse retains the previous ready extraction. Invalid/out-of-scope citations stay invalid/out-of-scope.
6. Navigating away stops client polling, not the durable job. Reopen the job/status to inspect its outcome. Exported revalidation metadata cannot grant trust after another restore: import discards it and a fresh local check is required.

The composer now recovers when a matching job terminates before creating a turn, including local cancellation and unknown submission. Unknown remote outcomes are still not permission to resubmit. Google ask remains disabled when disconnected, capability loading/failed/unsupported, or unlinked; no engine is switched automatically.

## Remaining handoffs

1. Approve and provision private runtime credentials if continuing deployment
2. Establish an authorized protected HTTPS ingress with known storage lifecycle
3. Authorize application-runtime Google login and a real read-only check
4. Resolve SDK non-destructive strict-history isolation before claiming real scoped NotebookLM Q&A
5. Explicitly authorize each real remote create/sync/audio test, and configure an existing independent model if desired
6. Re-run the acceptance matrix in the target runtime; do not promote fake or localhost-only results to live acceptance

## Coverage measurement

See `COVERAGE.md` for baseline and final measured line/branch/statement counts, exact scope and remaining gaps. Pytest includes injected-fake, CPU and service tests; Vitest includes unit/component/transport contracts. Their coverage does not include the separately run real browser/native stack. Unimported production files are included in the frontend denominator.

## Isolated maintenance crash check (2026-10-21)

Run `.venv/bin/python scripts/v1/maintenance_crash_check.py --out /tmp/study-workbench-crash-evidence` from the repository. This launches a fresh disk-backed native database and authenticated loopback API/worker using public, nonsecret fixtures. It kills only its own worker process group after a durable parser checkpoint, restarts a normal worker, and polls the original job under unchanged production recovery deadlines. Allow several minutes for two 90-second stale intervals. Both reparse and revalidation must retain original job/extraction identity, finish on attempt two, preserve prior ready content and handle duplicate submission without another attempt. All spawned processes are stopped afterward.

This checks API-driven maintenance recovery, not host reboot, filesystem deletion, browser disconnect or live Google recovery. Test children disable implicit dotenv loading. The private native launcher also disables implicit child dotenv loading after explicitly reading its selected `--config`; it does not disable normal configuration handling in the application itself.

## Saved-audio verification and private snapshot publication

After building the frontend, run `PYTHON_DOTENV_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" python scripts/v1/audio_playback_check.py --out .runtime/audio-check` using the interpreter with Playwright/httpx installed. This uses synthetic audio and two isolated native environments, verifies authenticated playback/download before and after reload, exports and restores the project, and repeats the checks with remapped IDs. It does not require or test Google generation. Generated media and browser images stay in the local output directory.

Prepare subsequent committed, verified repository updates using [PRIVATE_SNAPSHOT.md](PRIVATE_SNAPSHOT.md). That offline helper never pushes or authenticates. The developer checkout's existing origin is upstream; do not push project snapshots there. The verified private progress repository is `Zhou-chu/study-workbench`, with snapshot publication on `main`; published commit IDs differ from source-development commit IDs, which are recorded in each manifest.

### Authorized runtime verification checkpoint (2026-10-21)

Dedicated application/database/encryption credentials were provisioned outside the source repository under owner-only permissions, not copied into this repository. Real protected verification passed on the final launcher: direct API and frontend proxy reject missing/wrong credentials (401) and accept configured credentials (200); database anonymous reads are rejected and authenticated reads pass; a public synthetic local worker fixture parses; full stop/restart preserves original bytes; encryption/decryption round trip passes. Only IPv4 loopback ports 18000/5055/13000 listen, and all close after shutdown.

The verification intentionally stopped services afterward. Credentials and data remain in the private runtime location, with one labeled public verification workspace. This is not an externally reachable deployment or a guarantee of cloud workspace lifetime. No Google session, model credential or remote generation was configured. The committed verification JSON contains statuses only; private configuration and raw runtime logs are not published.
