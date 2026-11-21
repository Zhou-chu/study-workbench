# ADR-026: Gate new dependency violations in PR CI

The static PR workflow fails on dependency violations independently of runtime,
test coverage, and Sonar. The checks analyze source imports without starting
the API, opening a real database, or using credentials.

- **TS/JS:** run `npm ci` then `npm run architecture:ts` from the repository
  root. Dependency Cruiser resolves the workspace package and legacy frontend
  aliases to source (including type-only imports). Shared contracts, domain
  and transport cannot import apps, the legacy frontend or server platform
  modules; contracts cannot depend on domain or transport, and domain cannot
  depend on transport. The BFF cannot import either frontend. Modern Web can use
  `frontend/src/lib/locales/` as its intentionally shared translation catalog,
  not other legacy modules. First-party unresolved aliases and cycles fail
  the gate. Test files are out of scope. The known violations file records
  the existing 40 specific import edges involved in cycles; do not grow it as a way
  to pass CI. When retiring old entries use Dependency Cruiser's
  `--baseline-mode shrink-only` against the same directories.
- **Python:** install the hash-locked tooling in an isolated Python 3.12 venv
  using `uv pip sync --require-hashes` and
  `scripts/architecture/python-requirements.txt`. At repository root run
  `PYTHONPATH=. <venv>/bin/lint-imports .importlinter --no-cache --no-logo`.
  The core cannot depend (directly or indirectly) on HTTP startup/routers;
  routers cannot depend on API startup or form cycles. Domain and storage
  cannot directly import higher-tier API code beyond the two explicit
  `source_snapshot_repository` edges. This direct-only layer rule avoids
  rejecting existing indirect service integrations; the separate core-to-HTTP
  routing prohibition applies transitively. Database and graphs are existing
  namespace packages and are named explicitly so Grimp scans their files.
  Update those roots if a new core namespace directory is introduced.

These rules enforce declared static imports, not dependencies hidden behind
arbitrary runtime plugin loading.
