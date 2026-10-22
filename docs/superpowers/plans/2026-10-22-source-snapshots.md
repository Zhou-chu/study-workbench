# Source snapshots implementation plan

**Goal:** One explicit action captures a saved note revision or completed answer as immutable material in the same notebook.
**Architecture:** Existing local evidence indexing, immutable bytes and one guarded SurrealDB transaction. No provider, embeddings, worker or automatic selection.
**Tech stack:** FastAPI/Pydantic, SurrealDB, existing React Query/API client.
**Spec:** Root-approved source-snapshots contract in task handoff (2026-10-22).

## Constraints and review focus
- At most 1 MiB UTF-8 for text/title/provenance combined and 1,000 evidence records; exact saved title/body; authoritative membership and revision checked in the committing transaction.
- Deterministic client key/request reconciles across remount; different request conflicts. All transaction failures retain deterministic bytes so a losing writer cannot unlink a winner. Publication fsyncs file and path hierarchy before metadata commit.
- Derived material remains distinct through ingestion, reparse, citations, model input and portable roundtrip.
- Saved origin may later disappear; provenance is historical, never authorization. Deleted target source returns 410 SNAPSHOT_UNAVAILABLE on replay and is never resurrected.
- No credentials, live-preview writes, provider calls, security changes or automatic source selection. Native source.full_text deliberately remains empty until the classic reader/chat path can preserve derived provenance; StudyWorkbench reader/search is supported.

## Tasks
- [x] Test new provenance types and propagation; implement shared schema and pure evidence builder; rerun existing ingestion/retrieval tests.
- [x] Test source snapshot validation, immutable payload, idempotency, rollback/unknown handling; implement contracts/service/atomic repository/router.
- [x] Test actual isolated Surreal transaction, stale revisions, cross-notebook requests and concurrent deletion where available.
- [x] Test archive lineage and restored distrust; implement conservative portable checks without widening older archive versions.
- [x] Frontend child tests and implements standalone button/API/hook/types, stable retry identity and stale completion guards.
- [x] Run focused regressions, lint/types, review diff and commit scoped changes. Root owns router registration, UI integration/locales and CHANGELOG.

## Verification and integration boundary

Final backend regression: 204 passed with 9 gated skips; the 8 snapshot database cases then passed separately against a fresh isolated in-memory SurrealDB (one legacy database gate remains skipped). These cover atomic creation, same-key contention, native CAS, foreign origin, missing origin, lost acknowledgement, independent writers, deleted-source replay and retained source after origin deletion. Scoped Ruff and five-module mypy passed. Standalone frontend: 16 tests passed, TypeScript and scoped ESLint passed, covering deterministic keys, remount recovery, duplicate clicks during hashing, stale navigation and 410 handling. Root owns route registration/BFF allowlist, locale integration, aggregate acceptance and final publication.

No provider call, actual-user database mutation or live-preview write was used. Safe unacknowledged deterministic files may remain after rejected transactions; garbage collection is intentionally outside scope.
