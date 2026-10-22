.DEFAULT_GOAL := help
.PHONY: help run frontend api worker worker-start lint ruff export-docs clean-cache

help:
	@echo "StudyWorkbench: read docs/v1/ENTRYPOINTS.md before starting services."
	@echo "Owned foreground stack: scripts/v1/run_native.py (see docs/v1/RUNBOOK.md)."
	@echo "Docker candidate only: docs/v1/DOCKER_MIGRATION.md; runtime acceptance pending."

# Standalone foreground development only; operator owns configuration and terminal.
run: frontend

frontend:
	cd frontend && npm run dev -- --hostname 127.0.0.1

api:
	uv run --env-file .env run_api.py

worker: worker-start

worker-start:
	uv run --env-file .env surreal-commands-worker --import-modules commands --max-tasks "$${OPEN_NOTEBOOK_WORKER_MAX_TASKS:-5}"

lint:
	uv run python -m mypy .

ruff:
	ruff check . --fix

# Legacy lifecycle and upstream deployment/publication are intentionally disabled.
# No prerequisites: rejection must precede any process, Docker or remote operation.
.PHONY: database
database:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: start-all
start-all:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: stop-all
stop-all:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: status
status:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: worker-stop
worker-stop:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: worker-restart
worker-restart:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-buildx-prepare
docker-buildx-prepare:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-buildx-clean
docker-buildx-clean:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-buildx-reset
docker-buildx-reset:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-build-local
docker-build-local:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-push
docker-push:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-push-latest
docker-push-latest:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: docker-release
docker-release:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: tag
tag:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: release-test
release-test:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: release-stack
release-stack:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: release-stack-down
release-stack-down:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: dev
dev:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

.PHONY: full
full:
	@echo "Blocked: legacy entrypoint disabled. Read docs/v1/ENTRYPOINTS.md" >&2
	@exit 2

# === Documentation Export ===
export-docs:
	@echo "📚 Exporting documentation..."
	@uv run python scripts/export_docs.py
	@echo "✅ Documentation export complete!"

# === Cleanup ===
clean-cache:
	@echo "🧹 Cleaning cache directories..."
	@find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name ".mypy_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name ".ruff_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name ".pytest_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name "*.pyc" -type f -delete 2>/dev/null || true
	@find . -name "*.pyo" -type f -delete 2>/dev/null || true
	@find . -name "*.pyd" -type f -delete 2>/dev/null || true
	@echo "✅ Cache directories cleaned!"
# StudyWorkbench V1: no paid or Google calls in these checks.
.PHONY: v1-check v1-api-check v1-e2e v1-live-check
v1-check:
	UV_CACHE_DIR=/tmp/sw-uv-cache uv run pytest tests/
	cd frontend && npm run test && npx tsc --noEmit && npm run build

v1-api-check:
	UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/local_check.py

v1-e2e:
	UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/local_check.py --browser

v1-live-check:
	UV_CACHE_DIR=/tmp/sw-uv-cache uv run python scripts/v1/live_check.py
