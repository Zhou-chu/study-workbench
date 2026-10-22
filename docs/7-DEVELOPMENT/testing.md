# Testing

How the test suites are laid out, how to run them, and the patterns to copy when you add a test.

## Running the tests

```bash
# Backend (repo root; use an already prepared Python environment)
python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared/tiktoken-cache
python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared/tiktoken-cache -- tests/test_sources_api.py -k retry
python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared/tiktoken-cache -- tests/ --cov=open_notebook --cov=api

# Frontend (inside frontend/)
npm run test              # vitest run, once
npm run test:watch        # watch mode
npm run test:coverage     # what CI runs
```

The default backend suite needs **no running SurrealDB, worker or AI provider**.
Use the supported `scripts/offline_pytest.py` entrypoint rather than bare pytest
when checking untrusted ambient configuration. It starts a fresh subprocess with
an allowlisted environment, disables dotenv and third-party pytest plugin
autoloading, selects this checkout ahead of editable installations, and creates
temporary HOME, application, personal, runtime, NotebookLM storage and pytest
paths. Host provider credentials, proxies, Python/pytest overrides, and all live
DB/lifecycle opt-in variables are not forwarded. Temporary state is removed on
exit. Pytest arguments are trusted developer input, not a sandbox boundary.

The runner never installs or downloads anything. Supply an **existing** directory
containing the `cl100k_base` tiktoken cache file
`fb374d419588a4632f3f557e76b4b70aebbca790` with SHA-256
`446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`.
It verifies the bytes and copies them into temporary storage; it does not modify
the supplied cache. Prepare dependencies and token data separately in an
authorized environment. Missing or invalid cache data produces an actionable
error before pytest starts.

A Python audit hook rejects DNS and IPv4/IPv6 connect, bind and sendto in the test
process (also installed when multiprocessing spawn reimports the entrypoint).
Unix sockets remain available for local test machinery. **This is a tripwire, not
an OS firewall:** native extensions and arbitrary subprocesses are not guaranteed
to be covered; it does not isolate filesystem reads or malicious tests. Use an
external network/filesystem sandbox when that stronger guarantee is needed.
Synthetic isolation regressions never inspect an actual user `.env` or credential.

Tests intentionally mock DB/models/HTTP and many intentionally disable auth.
Passing them does **not** establish production authentication or runtime
acceptance. Disposable database, embedding, device-session repository and
lifecycle suites retain their explicit opt-ins and must be invoked separately
with authorized, disposable configuration, not through this offline runner.
Report skips and runtime/coverage gates separately. No checked-in CI is active
in this private source delivery; a local command is not evidence of CI execution.

## Backend layout (`tests/`)

`tests/` is flat: one `test_<topic>.py` per feature or regression (about 70 files), for example `test_sources_api.py`, `test_credentials_api.py`, `test_ask_graph.py`, `test_crud_404.py`. There are no `unit/` or `integration/` subfolders. Name a new file after what it covers, or add to the existing file for that area.

`tests/conftest.py` has no shared fixtures. It only:

- sets `OPEN_NOTEBOOK_PASSWORD=""` before anything is imported, so the auth middleware is disabled in tests;
- forces `PYTHON_DOTENV_DISABLED=1`, including for later application imports;
- preserves the upstream mocked-auth/private-mode baseline;
- puts the repo root on `sys.path`.

pytest-asyncio runs in its default (strict) mode, so async tests need `@pytest.mark.asyncio`.

## Backend patterns

**API tests** use FastAPI's `TestClient` with a per-file fixture, and patch the domain call the router makes:

```python
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.exceptions import NotFoundError


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
def test_delete_notebook_missing_returns_404(mock_get, client):
    mock_get.side_effect = NotFoundError("not found")
    assert client.delete("/api/notebooks/notebook:gone").status_code == 404
```

(Adapted from `tests/test_crud_404.py`.) Paths include the `/api` prefix. To assert on a 500 instead of having the exception raised into the test, create the client with `TestClient(app, raise_server_exceptions=False)` (see `tests/test_typed_exceptions_reach_handlers.py`).

**Patch where the name is used**, not where it's defined: `api.routers.notebooks.Notebook.get`, `open_notebook.graphs.ask.provision_langchain_model`, and so on. Async functions need `new_callable=AsyncMock` (or an `AsyncMock` as the replacement).

**Graph tests** patch `provision_langchain_model` in the graph module and return a fake model, then call the node function or `await graph.ainvoke(...)` (see `tests/test_ask_graph.py`, `tests/test_graphs.py`).

**Command tests** call the command function directly with its `CommandInput` and patched dependencies (see `tests/test_source_deleted_before_processing.py`, `tests/test_embed_source_partial_cleanup.py`).

**Things that leak between tests:**

- `RecordModel` subclasses (`DefaultModels`, `ContentSettings`, …) are singletons. Call `clear_instance()` in setup/teardown when a test touches one (see `tests/test_domain.py`).
- `provision_provider_keys()` writes to `os.environ`. Use pytest's `monkeypatch.setenv` / `delenv` so environment changes are undone.

**Migrations** can be tested as text, without a database, by reading the `.surrealql` file (see `tests/test_insight_timestamps.py`).

### Disposable fresh-install migration gate

`tests/test_source_attempt_repository_db.py::test_fresh_full_migration_chain_composite`
runs the actual registered migrations 1–30 on an empty, memory-only SurrealDB
2.3.10 database, then exercises source-attempt ownership, embedding publication,
and revision-guarded note writes together. Enable only with
`SOURCE_ATTEMPT_DISPOSABLE_DB=1` and `SOURCE_ATTEMPT_TEST_SURREAL_BINARY` pointing
to the official binary matching the fixture's pinned SHA-256. The fixture owns
an unused loopback listener, public synthetic credentials, and process cleanup;
it never uses a configured application database.

### Migration 7: legacy podcast safety stop

Migration 7 no longer resets `speaker_profile`. Before submitting writes, the
registered migration performs a read-only preflight. Any existing
`speaker_profile`, `episode_profile`, or `episode` table (even empty, since its
schema is unknown), or any record in legacy `podcast_config`, stops startup with
an explicit **manual review** error. Empty `podcast_config` from migrations 1–6
is supported and is not modified. Custom fields and conflicting default profile
names are not converted, discarded, or overwritten.

The SQL independently guards against existing records and uses strict table
creation inside one transaction; it does not rely solely on the earlier Python
check. An existing table introduced between preflight and execution aborts the
transaction, including earlier schema writes. Indexes are built synchronously
inside that transaction, not in background jobs. These guarantees are tested on
owned memory-only SurrealDB 2.3.10: manager and direct SQL paths compare all
records, schema definitions, and migration version before/after rejection;
a failure after seed insertion rolls back and permits a clean retry. The actual
fresh chain 1–30 also remains covered.

**If startup stops at migration 7:** stop application writers, retain the existing
database, take a backup and verify restoration on a separate copy, then have an
operator review a data-preserving conversion against that copy's actual legacy
schema. No automatic conversion is supplied. Do not delete tables, rename away
conflicts, or advance the migration version merely to bypass the stop. A raw SQL
race/failure may produce the generic sanitized statement-error message rather
than the preflight's manual-review message; investigate the copy, not live data.

This is not acceptance of arbitrary existing upgrades, partially applied
migration replay, or backup/restore. Migration SQL and version bookkeeping still
use separate requests: interruption after a successful schema commit but before
the version bump needs operator review, not automatic replay. Already completed
migration 7 is not rerun, and previously deleted data cannot be recovered by this
change. **`7_down.surrealql` remains destructive**: it removes podcast/profile
tables and records. It was not invoked by these tests and is not a safe downgrade
or recovery procedure; any manual rollback requires its own reviewed backup and
restore plan. Never run these disposable gates against user data.

## Frontend layout

Tests are colocated with the code as `*.test.ts` / `*.test.tsx` (for example `src/lib/locales/index.test.ts`, `src/components/common/ConfirmDialog.test.tsx`). `frontend/src/test/` holds only the shared setup (`setup.ts`: jest-dom matchers and mocks for `next/navigation`, `matchMedia` and `@/lib/hooks/use-translation`, whose `t()` returns the key itself, so assert on keys rather than English text).

Vitest runs in `jsdom` with globals enabled and the `@/` alias (`frontend/vitest.config.ts`). Use Testing Library to render components; mock API modules rather than the network.

## What to test

- A bug fix comes with a test that fails without the fix. Name it after the behavior (`test_delete_notebook_missing_returns_404`) and reference the issue in the docstring.
- API changes: status codes, validation errors and the error mapping, not only the happy path.
- Don't test third-party libraries (Esperanto, content-core, LangGraph) or make real provider calls.
