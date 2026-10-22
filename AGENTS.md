# Open Notebook — Agent Rules

Open Notebook is an open-source, privacy-focused alternative to Google's Notebook LM: an AI-powered research assistant with multi-provider AI support, fully self-hostable.

This file holds the project-wide rules every coding session needs. Component rules: [open_notebook/AGENTS.md](open_notebook/AGENTS.md) (backend — also covers `api/`, `commands/`, `prompts/`) and [frontend/AGENTS.md](frontend/AGENTS.md). Knowledge lives in the docs (see [Where to look](#where-to-look)) — read it on demand instead of guessing.

## Stack, ports, startup order

Three tiers: Next.js frontend (3000) → FastAPI (5055) → SurrealDB (8000).

Use [the project entrypoint guide](docs/v1/ENTRYPOINTS.md) and [V1 runbook](docs/v1/RUNBOOK.md). The owned foreground Linux launcher starts database → API → worker → frontend and cleans up only its own process groups. **API startup runs schema migrations; the worker can consume queued jobs.** Never point an acceptance run at a user's database.

`make` is nonmutating help. Legacy `database`, `start-all`, `stop-all`, `status`, worker stop/restart and inherited Docker/release/tag targets fail closed. Root Compose has no services. Standalone `make api`, `make worker-start` and `make frontend` remain foreground development commands, not an isolated deployment. Stop them in their owning terminals; never use global process-name kills. The explicit four-service Docker candidate is not runtime-accepted.

## Commands

- Tests: `uv run pytest tests/`
- Python lint/format/typecheck: `uv run ruff check . --fix` · `uv run ruff format .` · `uv run python -m mypy .`
- Frontend (inside `frontend/`): `npm run lint` · `npm run test` · `npm run build`
- Required offline checks: Ruff/format, mypy, pytest, frontend lint/types/tests/build; coverage and opt-in database/runtime gates are reported separately. This private source delivery currently has no active checked-in CI workflows: do not claim CI ran or enable inherited publication workflows implicitly.
- Docker/release: [V1 migration gates](docs/v1/DOCKER_MIGRATION.md); inherited release Make targets are disabled, not a supported publication route.

## Hard rules

- **Async-first**: every DB query, graph invocation and AI call is `await`-ed. No sync DB access.
- **Never commit secrets.** Credentials are encrypted at rest and require `OPEN_NOTEBOOK_ENCRYPTION_KEY` to be set.
- Authentication/CORS depend on explicit runtime mode. Legacy password remains the default; device-session and same-origin Web-session code is separately gated. Preserve private-access, exact-Origin and credential-custody checks; do not assume production hardening or device activation from code presence. See [device protocol](docs/v1/DEVICE_SESSION_PROTOCOL.md).
- Product direction questions (does this feature fit?) → [VISION.md](VISION.md). Past decisions ("why is it like this?") → [docs/7-DEVELOPMENT/decisions/](docs/7-DEVELOPMENT/decisions/). Structural decisions made while coding should produce a new decision record there.
- **Conventional Commits** for commits and PR titles (`fix(podcasts): …`, `feat(providers): …`, `docs: …`).
- **Every user-visible change adds a CHANGELOG entry** under `## [Unreleased]`, in the one section for its type (`### Added` / `### Changed` / `### Deprecated` / `### Removed` / `### Fixed` / `### Security`); never create a duplicate section. Details: [contributing.md](docs/7-DEVELOPMENT/contributing.md#changelog).
- Maintainer profile lives in `.maintainer/`; do not run release, triage or discussions workflows without it.

## Where to look

| Need | Location |
|---|---|
| Architecture (processes, layout, data model, workflows) | [docs/7-DEVELOPMENT/architecture.md](docs/7-DEVELOPMENT/architecture.md) |
| Step-by-step recipes (add endpoint, provider, migration, command, i18n…) | [docs/7-DEVELOPMENT/change-playbooks.md](docs/7-DEVELOPMENT/change-playbooks.md) |
| Dev environment setup | [docs/7-DEVELOPMENT/development-setup.md](docs/7-DEVELOPMENT/development-setup.md) |
| Code standards & testing | [docs/7-DEVELOPMENT/code-standards.md](docs/7-DEVELOPMENT/code-standards.md) · [testing.md](docs/7-DEVELOPMENT/testing.md) |
| Product identity & current posture | [VISION.md](VISION.md) |
| Decision log (ADRs/PDRs) | [docs/7-DEVELOPMENT/decisions/](docs/7-DEVELOPMENT/decisions/) |
| Contribution process (Discussions → Issues → PRs) | [docs/7-DEVELOPMENT/contributing.md](docs/7-DEVELOPMENT/contributing.md) |
| User/operator docs (install, configure, troubleshoot) | [docs/](docs/index.md) |
