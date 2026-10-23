# V1 container migration — static contract, not a release

**Status: Static checks only. Docker build/run and production readiness NOT RUN.**
Do not replace a working deployment with this draft until the T11 gates below pass.
Root Compose now has no runnable services and inherited lifecycle/publication Make targets fail closed; see [safe entrypoints](ENTRYPOINTS.md). Historical Docker examples/scripts are not endorsed deployment routes. `deploy/v1/compose.yaml` remains the explicit opt-in candidate, not an activated deployment. It uses JSON syntax (valid YAML 1.2), so the offline checker needs only Python.

## Topology and boundaries

Exactly one frontend, API, worker and database on one host/local filesystem.
Only frontend publishes `127.0.0.1:8502` → container 3000. API:5055 and DB:8000
are internal only. There are two application images: API and worker share the exact
backend build/image; frontend is separate. A **third, minimal database wrapper
image** copies the pinned `surrealdb/surrealdb:v2.3.10` binary into the Python base,
so checked `_FILE` loading does not assume the official image has Python/a shell.
It receives no app code, dependencies, encryption key or access password.
All processes are non-root; API/worker/DB UID:GID is 10001:10001; frontend uses node.

Backend runtime uses installed executables directly, no `uv run`, dependency install
or opt-in runtime download. Docling/Crawl4AI installation flags fail closed. Their
optional capabilities need separately reviewed build-time packaging, not silent startup
installation. Tiktoken's o200k_base cache is baked outside mounted data.

## Secrets and origin

Keep an operator environment file and secret files **outside the checkout, build
context, exported project ZIP and backups of source**. `env.example` has variable
names only, not usable secrets. Four required files supply the DB username/password,
existing encryption key and API access password. Compose mounts them at `/run/secrets`;
the wrapper rejects missing, empty, oversized, non-regular, unreadable, NUL/multiline,
placeholder secret values and conflicting direct-value inputs without logging contents.
An existing username such as `root` is allowed only when explicitly supplied by file;
there is no username or password default. A final
newline is accepted; meaningful spaces are preserved. Files must be readable by the
container identity (test actual Compose file-secret ownership semantics in T11).
Do not rotate an existing encryption key during migration: stored credentials would
become unreadable. Root-account initialization variables do not rotate an existing DB
user's password. Secrets enter process environments, not argv; privileged host/container
administrators can still inspect those environments. `_FILE` is not an encrypted vault.

`PUBLIC_ORIGIN` must equal the browser-visible frontend origin, without trailing slash,
userinfo, path or `/api` suffix; for direct loopback use `http://127.0.0.1:8502`.
The same required `PUBLIC_ORIGIN` is passed to API `CORS_ORIGINS` as one explicit
allowed origin (never `*`). This preserves origin checking for mutations and portable
imports forwarded with browser Origin but internal API Host; foreign origins remain
rejected. It is runtime-only, never a public build secret. **Do not use `API_URL=/`**: existing
client/config code appends `/api`, producing `//api`. Empty API_URL currently triggers
`:5055` autodetection. Explicit origin remains a legacy compatibility requirement. Runtime same-origin
configuration and proxy allowlisting exist, but their actual container behavior
still needs T11 acceptance.
`INTERNAL_API_URL=http://api:5055` is a runtime server setting for the Node App
Routes. There is no external build-time rewrite bypass: ordinary API and portable
streaming requests use the registered runtime proxy policy. Device-session mode
remains gated; this candidate does not enable it. The frontend builder copies only
the exact public `contracts/v1/openapi.json` alongside frontend source because
contract tests/typechecking and the build fingerprint consume it. No private
configuration or entire backend tree is added to that build stage. Static checks
cover these declarations; they do not prove a Docker image was built or served.

## Data migration (operator procedure; not executed)

Before taking filesystem/volume snapshots of DB and both data trees, quiesce and
stop all writers, including API, worker and the database itself; stopping only
API/worker does not make a live database storage-directory copy consistent.
Keep that backup until restore and rollback are verified. Use named volumes:

| Volume | Container path | Contents |
| --- | --- | --- |
| personal | `/app/data/personal` | personal store/evidence/portable artifacts |
| upstream | `/app/data/upstream-data` | uploads, podcasts, sqlite-db/checkpoints.sqlite |
| database | `/app/data/db` | SurrealDB database.db storage directory |

For this supported candidate, the top-level `volumes` mapping must be exactly
`{"personal": {}, "upstream": {}, "database": {}}`. Empty definitions retain
Compose project-scoped volume names. The static preflight intentionally rejects
all custom definitions, including `external`, explicit `name`, `driver`,
`driver_opts` (host binds or NFS), labels and null/list/scalar definitions, rather
than accepting an unreviewed storage target under one of the expected keys.
This is a deliberately narrow candidate contract, not a claim that every custom
Docker volume is unsafe. Custom storage needs separate review and acceptance.
Project scoping alone does not prove volumes are new or unused: a future runtime
gate must verify ownership and isolation under a fresh disposable project, never
reuse a user's existing project or data, and never infer runtime safety from a
static pass. Actual migration, restore and rollback remain unverified.

Set `STUDY_WORKBENCH_DATA_DIR` and `OPEN_NOTEBOOK_DATA_DIR` exactly as the manifest.
Copy the contents of the old upstream data root, preserving its relative subpaths;
do not copy it into an extra nested `data/`. Config consumers inspected: both chat
graphs (checkpoints), sources router (uploads), podcast command/audio path helper
(podcasts), portable import/export service (uploads/checkpoints), token utils (cache).
No upstream config edits are needed. Preserve personal IDs, evidence/version identity
and portable format. Initialize ownership for UID/GID 10001 without running the
application as root; verify newly initialized and restored volume permissions.
Do not share writable SQLite data over multi-host/network filesystems or scale workers.

## Checks and outstanding gates

Offline only, from repository root:

```sh
python scripts/v1/container_check.py --static
python -m pytest tests/test_v1_container_contract.py
```

This checks manifest structure and mutations, file-secret validation, commands,
mounts, context exclusions and build policy. It never reads operator secret files,
interpolates `.env`, invokes Docker, starts services or claims readiness.

The API healthcheck targets existing `/health` **liveness only**. The API lifespan
awaits startup migrations before serving requests; dependency ordering therefore
cannot observe a successfully serving API before that startup finishes. This is
not ongoing proof of database connectivity, migration consistency or worker health.
No nonexistent `/ready` check is shipped. A bounded runtime dependency readiness
probe remains pending; change ordering only after its tests pass. Worker has no fabricated API-derived healthcheck;
independent worker lifecycle/job execution proof remains pending.

Surreal 2.3.10 `start` supports SURREAL_USER, SURREAL_PASS and --bind, confirmed by
[version-pinned official source](https://github.com/surrealdb/surrealdb/blob/v2.3.10/src/cli/start.rs)
and the existing local 2.3.10 binary's `start --help`. Its `is-ready --endpoint` CLI was
confirmed using help only (no connection). The actual image probe still needs T11.

T11 must validate base-image tags, architectures and immutable digests (current exact
tags are candidates, **not validated or digest-pinned**), the copied DB binary's runtime
libraries, frozen builds, DB probe, DNS, process UID/permissions, safe secret file
mounts, actual readiness/migrations, worker completion, restart and durable restore,
frontend same-origin configuration/allowlist, portable streaming import, streaming
answers and access authentication. No new model/Google credentials were accessed.
Google strict-isolation remains fail-closed and real model/Google evidence is a separate
release gate; independent-model-only release requires explicit scope acceptance.
