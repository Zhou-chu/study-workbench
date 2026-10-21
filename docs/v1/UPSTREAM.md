# Fixed upstream

- Repository: https://github.com/lfnovo/open-notebook
- Commit: a0f6f3081ae06328f0a451b3a3ef2959ca25721d (2026-10-18 checkout, project version 1.15.0, no tag at shallow HEAD)
- Branch: feature/study-workbench-v1
- License: MIT; retained LICENSE and copyrights
- Python: 3.12.14; upstream supports >=3.11,<3.13
- Node:24.19.0 verified; upstream requires>=20.9, but this branch’s pinned PDF.js6.4.299 requires>=22.13.0 (or supported24+)
- SurrealDB: official v2.3.10 linux-amd64 release; BSL 1.1 license is distinct from application MIT
- notebooklm-py: 0.8.5, locked from PyPI, MIT; public SDK mapping in NOTEBOOKLM_SDK.md
- pypdf: 6.10.2, locked from PyPI, BSD-3-Clause
- All pre-existing Esperanto/LangGraph, SurrealDB and surreal-commands integrations retained

Verified source locations match plan: api/routers/sources.py; api/main.py; api/models.py; open_notebook/domain/notebook.py; graphs/{source,chat,source_chat,ask}.py; ai/provision.py, provider_registry.py; database/repository.py, async_migrate.py; commands/__init__.py; frontend/src/lib/api/client.ts. Existing migrations 1–25; V1 owns migration 26.

Baseline: `uv sync --frozen` (with writable cache) succeeded; full `pytest tests/` before V1 modules: **1000 passed, 2 upstream deprecation warnings, 14.86s**. Output captured in /tmp/sw-baseline-pytest.log during implementation.
