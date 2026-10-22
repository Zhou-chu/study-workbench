# Safe operation entrypoints

## Foreground Linux stack

Read [RUNBOOK.md](RUNBOOK.md), especially private configuration, independent runtime
storage and ports. After authorized setup, run the existing owner-scoped launcher
**in the foreground**, with an external owner-only configuration file:

```sh
.venv/bin/python scripts/v1/run_native.py --config /path/to/authorized-runtime.env
```

The launcher tracks the child sessions it creates, checks ports before starting,
and cleans up those process groups when it exits. Stop it with Ctrl-C in its owning
terminal. Its console and private runtime logs describe this instance; no global
process-name scan is a reliable status check. This is a Linux Web stack launcher,
not a mobile-native client. It is not a detached supervisor or persistent PID manager.
Do not use it to adopt or terminate an existing instance from a different launcher.
For an older running stack, stop it using its original terminal or explicitly
identified owning supervisor; the disabled Make targets cannot safely infer ownership.

`make` now prints guidance without starting services. `make api`, `make worker-start`
(`make worker`) and `make frontend` (`make run`) remain standalone foreground
**development** commands, not a coordinated deployment. Frontend binds loopback.
They require operator-provided dependencies/configuration; API startup runs migrations,
worker consumes queued jobs, and these commands are not an isolated acceptance test.
Stop each in its own terminal. Do not use development commands against private data
without explicit authorization and verified configuration.

`start-all`, `stop-all`, `status`, `worker-stop` and `worker-restart` now fail nonzero
without launching, inspecting or signalling processes. There is intentionally no
unsafe compatibility switch.

## Containers and publication

Root `docker-compose.yml` has **no services**. Plain `docker compose up` cannot start
the former upstream floating image, expose ports or use its example encryption key.
The V1 source-built candidate remains explicit at `deploy/v1/compose.yaml`;
[DOCKER_MIGRATION.md](DOCKER_MIGRATION.md) is the review and acceptance runbook.
Docker build/runtime acceptance is **NOT RUN**; do not switch a working deployment
or treat this candidate as production-ready. Empty root Compose is a guardrail,
not proof that Docker or any particular Compose version was executed successfully.

Inherited `database`, `dev`, `full`, `docker-build-local`, all `docker-buildx-*`,
`docker-push`, `docker-push-latest`, `docker-release`, `tag`, `release-test`,
`release-stack` and `release-stack-down` also fail nonzero without side effects.
They selected upstream registries/examples, shared builders or release helpers
rather than an accepted StudyWorkbench release. There is no replacement publish
command yet. Future publication needs an explicitly authorized destination, reviewed
project-owned tooling, successful acceptance evidence, source SHA and immutable image
digests. Directly invoking historical scripts/examples is not endorsed by these guards.

## Offline regression check

```sh
python tests/test_safe_operation_entrypoints.py
```

The stdlib-only test statically rejects unsafe recipes before running a copied
Makefile in a temporary directory with only recording tool stubs on PATH. It checks
all blocked targets return errors with guidance, and parses root Compose without
Docker, environment interpolation, secrets, services or network access. This is not
container or foreground-runtime acceptance.
