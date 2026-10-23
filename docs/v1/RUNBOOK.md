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

The frontend has no external Next.js rewrites: Node App Routes read `INTERNAL_API_URL` at runtime, and the runtime configuration endpoint reads `API_URL`. A port-only change does not require rebuilding the frontend. Set native backend URLs to `127.0.0.1` rather than `localhost` to avoid an IPv6 mismatch.

The launcher defaults remain database/API/frontend `18000/5055/13000`. To prepare a separately authorized test instance on different ports, use:

```sh
UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/run_native.py \
  --config /path/to/separate-authorized-runtime.env \
  --database-port 18001 --api-port 5056 --frontend-port 13001
```

This command **starts** services; do not run it until fresh-instance creation and its credentials are authorized. Ports must be distinct integers from 1 through 65535. Changing ports alone does **not** isolate storage or create a fresh config: the separate private config must explicitly select separate `STUDY_WORKBENCH_RUNTIME_DIR`, `STUDY_WORKBENCH_DATA_DIR`, and `OPEN_NOTEBOOK_DATA_DIR` paths. Never reuse unverified old paths or point a fresh empty instance at an old browser origin that may hold unsaved work. No directory in a temporary workspace is guaranteed durable.

Port changes separate browser origins and origin-scoped storage such as localStorage, **not cookies**, which are scoped by host/domain and path rather than port. Keep this temporary HTTP standalone preview explicitly in `STUDY_WORKBENCH_AUTH_MODE=legacy_password`. Production `device_sessions` requires protected HTTPS; do not weaken its guard or attempt to bypass it with `STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK` (the production frontend rejects insecure device sessions). Cookie-session testing needs approved protected HTTPS and a genuinely separate browser profile or a distinct suitable host, not port changes alone. Preserve the existing user tab/profile; do not clear, reuse, or modify it to test the new instance.

For this port selection use `SURREAL_URL=ws://127.0.0.1:18001/rpc`, `INTERNAL_API_URL=http://127.0.0.1:5056`, `API_URL=http://127.0.0.1:13001`, and `CORS_ORIGINS=http://127.0.0.1:13001`. Blank optional URLs default to these selected ports. Explicit stale values in a copied example are rejected, not silently overwritten. Any nondefault port selection requires the database/internal API URLs to match the selected IPv4-loopback endpoints exactly (the internal API may have a trailing slash); remote backends, userinfo, query strings, fragments, and alternate paths are rejected. Explicit public HTTP(S) API URLs/paths and CORS origins remain supported, but local entries must use the selected frontend port. Use ASCII/punycode hosts for isolated browser URLs: ambiguous authorities (escaped or raw Unicode hosts, backslashes, userinfo, or missing hosts) are rejected; ordinary Unicode and percent escapes in public URL paths are preserved. Explicit wildcard CORS behavior is unchanged, not a recommendation to use it. Default-port launches retain custom remote backend/public settings; inconsistent local backend ports are rejected before storage changes.

Startup refuses occupied ports, waits for database/API/frontend HTTP health and worker database-listener startup evidence, and checks Linux listener addresses. Worker startup evidence is not a successful job-execution test; verify a public-fixture upload separately before relying on processing. Failed readiness stops all owned process groups, including npm descendants; shutdown does the same. This binds only to IPv4 loopback on the selected ports (by default frontend 13000, API 5055, SurrealDB 18000). The frontend address is local to the process environment and is not an external user-accessible URL. A separately authorized protected HTTPS ingress is needed for external browser use. Do not expose database/API ports directly. Private mode is enabled by default across legacy and V1 `/api/*` routes, and the launcher forces it on. Missing application password fails closed. The test-only `STUDY_WORKBENCH_PRIVATE_MODE=0` compatibility setting is not a deployment recommendation.

## Persistence and backup

- SurrealDB native RocksDB data: `.runtime/data/surreal.db` by default
- Immutable originals, parsed evidence, artifacts and locks: `STUDY_WORKBENCH_DATA_DIR`
- Existing upstream SQLite checkpoints, uploads and podcast files: `OPEN_NOTEBOOK_DATA_DIR`, native-launcher default `.runtime/data/upstream-data`
- `STUDY_WORKBENCH_RUNTIME_DIR` selects the native runtime/log root
- Google application profile, if later authorized: `NOTEBOOKLM_STORAGE_PATH`; never included in portable export

Application-process restart was tested with actual disk-backed SurrealDB. That is not a host-lifecycle durability test. In the current test environment, commands can use different PID/network namespaces; readiness must be checked from the same context as the application/browser, not inferred from an unrelated loopback failure. Files visible across commands are not necessarily retained across an environment resume.

An observed 2026-10-22 interruption left the temporary preview unreachable and its expected runtime paths absent, while the published source tree remained recoverable. Git/source ZIPs did not contain the user's database, configuration or credentials. Treat temporary cloud previews as disposable and test-data-only until all of these operational gates are met:

1. Identify storage with verified lifecycle guarantees. A directory name, successful process restart or surviving source checkout is not evidence of durable runtime storage.
2. Keep a stopped, consistent full-runtime backup for operational recovery and portable notebook exports for independent ownership. Store required authorized secrets separately from source control; secret export or reconfiguration requires the owner's specific authorization. A password-only file is not a database or complete configuration backup.
3. Demonstrate restoration into an isolated target without overwriting the source, using a known notebook/source inventory and readable originals. Record the verification time and limitations. Do not label fixture archives or a newly initialized empty database as recovered user data.
4. If runtime paths disappear, preserve surviving files and any unsaved browser content first. Do not silently initialize a new store, invent replacement credentials, or start migrations against an unverified datastore. Distinguish exact code recovery, actual data restoration and an owner-approved fresh test instance.

Workspace stop/deletion and externally managed host lifecycle guarantees remain unknown. Do not use this temporary preview as the sole copy of important material.

## Google connection and future acceptance

See `NOTEBOOKLM_SDK.md` for the exact supported SDK operations and honest limitations. A visible/manual login in the application runtime is required; an assistant's existing Google connection is not an application credential. No password or cookie upload field is provided. The web connect flow reports instructions; it does not pretend a runtime sign-in occurred. Production profile setup still requires the user's targeted authorization.

`make v1-live-check` is inert by default and prints a blocked result. Only after authorized runtime login may an operator set `STUDY_WORKBENCH_LIVE_READONLY=1` to verify authentication plus notebook listing. This does not authorize remote create/upload/generate actions. Even successful authentication does not remove the strict-chat isolation blocker in SDK 0.8.5. Do not bypass that guard or delete Google conversation history to manufacture a fresh turn.

## Operations and recovery

- Originals are immutable by version; upload a new version instead of overwriting
- Ordinary upload version-metadata errors return HTTP 500 `UPLOAD_COMMIT_UNKNOWN` with `retry_safe: false`. Retain the file and inspect the existing source before taking further action; do not automatically retry or delete retained data. The returned source/version IDs are allocated inspection hints, not proof of a database commit. The server preserves original bytes and sources even when it cannot establish whether metadata committed, and does not enqueue extraction on this failure path. This narrow safeguard does not establish same-key replay safety, an upload receipt/outbox, initial source-save or extraction-job acknowledgement recovery, or power-loss durability. Browser consumers must honor `retry_safe: false`; backend tests alone do not establish that UI behavior.
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


### Portable backup size preflight

Use authenticated `GET /api/personal/portable/limits` to inspect the active contract. API and worker must use identical `STUDY_WORKBENCH_PORTABLE_MAX_BYTES`, `STUDY_WORKBENCH_PORTABLE_MAX_ENTRIES`, and `STUDY_WORKBENCH_PORTABLE_MAX_RATIO`; restart both after changes. Default archives are bounded to 1 GiB physical ZIP and 1 GiB expanded bytes including the manifest, with 32 MiB per entity metadata member and an 8 MiB manifest. The import route alone allows an additional 1 MiB for multipart framing. Ordinary uploads retain the 100 MiB default.

A failed export has no usable download: check the durable job error and reduce content if an entity metadata member exceeds 32 MiB. Raising only the total budget does not change that safety cap. The dedicated Next.js POST route streams portable imports to the trusted internal API rather than using the ordinary 100 MiB rewrite-clone path. For large browser restores, the protected ingress must allow the exact portable import path sufficient body bytes; external proxies can still impose a lower cap. Application preflight cannot detect those external caps. Do not expose the API port publicly to bypass a proxy.
