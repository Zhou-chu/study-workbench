# Developer Guide

Start with the [safe V1 entrypoints](docs/v1/ENTRYPOINTS.md) and
[V1 runbook](docs/v1/RUNBOOK.md) for authorized source operation. Default `make`
prints help without starting services. API startup runs migrations and the worker
can consume queued jobs; never use a user's database for an acceptance run.

- **Offline backend checks** → [Testing](docs/7-DEVELOPMENT/testing.md) (`make v1-check` requires an existing `OFFLINE_PYTHON` and prepared `TIKTOKEN_CACHE`; it is not a full repository gate)
- **Contribute** → [Contributing Guide](docs/7-DEVELOPMENT/contributing.md) (workflow, commit and CHANGELOG conventions; no checked-in CI is currently active)
- **Make a common change** → [Change Playbooks](docs/7-DEVELOPMENT/change-playbooks.md)
- **Understand the code** → [Architecture](docs/7-DEVELOPMENT/architecture.md)
- **Coding-agent rules** → [AGENTS.md](AGENTS.md)
- **Docker and publication status** → [V1 migration gates](docs/v1/DOCKER_MIGRATION.md) (candidate only, not runtime-accepted; no supported publish command)

The inherited [Development Setup](docs/7-DEVELOPMENT/development-setup.md) and
[Release Process](.github/RELEASE_PROCESS.md) are **historical, non-operational
references**, not current instructions. Legacy lifecycle/release targets and
`make clean-cache` fail closed; the cleanup target deletes nothing.
