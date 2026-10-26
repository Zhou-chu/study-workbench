# Persisted evidence failure boundary plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Stop persisting arbitrary exception text/type names into newly failed extraction and maintenance records that are returned by successful read endpoints.
**Architecture:** Replace only two persistence-boundary payloads with fixed public values; retain original exception control flow, state transitions, writes and permissive historical reads. No generic sanitizer or migration.
**Tech Stack:** Python, existing EvidenceService/MaintenanceService, offline pytest and real router serialization with fake external seams.
**Spec:** This plan's scope follows code audit of api/evidence_service.py extract catch and api/evidence_maintenance.py run catch at local9eeb160 / remoteed58c6e. Existing safe HTTP handlers do not sanitize subsequent successful reads of stored error text.

## Global Constraints
- Only api/evidence_service.py and api/evidence_maintenance.py production changes. Do not modify arbitrary stored historical JSON or response serializers.
- New extraction.error is exactly "Source extraction could not be completed." New maintenance job.error is exactly {"code":"EVIDENCE_MAINTENANCE_FAILED","message":"Evidence maintenance could not be completed."}.
- This intentionally replaces exception-class-name codes and raw text at the maintenance processing-failure boundary. Existing enqueue WORKER_UNAVAILABLE and all other error branches remain unchanged.
- Keep original extraction exception identity/cause with bare raise, original state/attempt/replay/write ordering, retained prior-current extraction/version behavior and original files. Maintenance still catches and records failure as before. Do not add retries or broad catches.
- No service/DB/provider/browser/network/dependency/credential/cache mutation, restricted probes, main/deployment or remote writes by implementer. Use prepared offline runner and only owned synthetic test data; parent publishes reviewed/tested source/docs to approved private audit branch.
- Fixed messages do not repair failure persistence itself or certify all historical errors/global logs. No automatic historical cleanup.

## Review Focus
- Raw SDK exceptions may include short/long tokens, paths and document content even when only the error-record write succeeds later.
- Reparse can populate partial blocks/evidence before failing; only error diagnostic fields change, never silently delete useful data.
- A failed reparse must preserve prior readable extraction/version and original bytes.
- Revalidate and direct extraction must have identical privacy boundary behavior without changing their operation semantics.
- Unknown exception class names and known domain errors must not bypass fixed diagnostics; failed persistence and cancellation retain original propagation rules.

### Task 1: Fix two stored diagnostic fields

**Files:** two production files above; tests/test_v1_evidence_maintenance.py; tests/test_v1_evidence_revalidation.py or new tests/test_v1_evidence_failure_boundary.py; CHANGELOG.md; this plan.
**Interfaces:** Existing function signatures unchanged. Public fixed failure payloads specified above.

- [x] Inspect actual service/read routes and fixtures; document reachability and exact baseline.
- [x] Write RED tests with short/long synthetic private canaries (including exception type name), one-shot extraction/DB seam failure and later successful failure-record writes. Assert both stored records and actual public job/version-detail endpoint payloads contain only fixed diagnostics, not canaries. Verify raw original exception identity still emerges from direct extraction.
- [x] Cover reparse and revalidate, preserved prior readable extraction/version/original bytes, terminal no automatic rerun and explicit new operation still supported. Existing integrity-message expectation must change to documented fixed message while integrity detection/status assertions remain. Verify unrelated WORKER_UNAVAILABLE branch unchanged.
- [x] Cover failed error persistence and cancellation without claiming any durable failure record when write failed; no extra action/retry. Do not expose real data or call services.
- [x] Run expected RED on unchanged production; replace the two diagnostics with fixed values only; remove unused exception binding if appropriate but no new logging or helper framework.
- [x] Run focused GREEN and fresh full offline backend; Ruff/format/mypy and guarded OpenAPI check. Report inherited link/runtime/frontend gaps separately.
- [x] Add scoped security changelog, update plan, commit locally and write full evidence report for independent review before publication.

## Self-review / preflight

| Task/interface | Check | Result |
| --- | --- | --- |
| Task1 / extraction catch | Fixed error string only; bare raise and restoration unchanged | Consistent |
| Task1 / maintenance catch | Stable operation code/message, existing state/write policy unchanged | Consistent |
| Task1 / read routes | Tests verify actual serializer; no historical payload filtering | Consistent |

Ruling: replace exception-derived processing-failure codes with fixed EVIDENCE_MAINTENANCE_FAILED rather than maintain an unbounded class-name channel. Cost: new records have less diagnostic detail and clients relying on arbitrary prior type names need the stable operation code; no known typed contract promises those names. Preserve queue WORKER_UNAVAILABLE separately.

## Implementation evidence (2026-10-26)

- Baseline: local `9eeb160a887187a11ba1ee4016a7ea1e576ba08b`, tree `2150f26c9f0b8d4e841c034e1d6baaca2e1df4a5`; controller identified remote equivalent `ed58c6e`. Fresh unchanged-source full offline backend: 2,647 passed, 128 skipped, 2 warnings.
- RED: final boundary tests exercise real GET job/version-detail serialization before checking fixed diagnostics. Unchanged production failed 27 cases as expected; 20 compatibility/history/cancellation/other tests passed. Initial stored-boundary RED is also retained.
- GREEN: focused extraction/maintenance/revalidation suite: 47 passed, 1 inherited Pydantic warning. The 31 new cases cover short/long synthetic canaries, arbitrary type names and domain exceptions, parser and one-shot DB failures, partial evidence retention, original direct exception identity/cause, prior-readable extraction/version/original bytes, terminal replay versus explicit retry, failure-record write failures, cancellation and historical read compatibility.
- Ruling: continue the existing isolated branch and execute the single assigned task without nested agents/worktrees. Controller owns independent review and publication. Cost if wrong: author verification is not independent acceptance; no merge/deployment claim is made.
- Ruling: failed diagnostic persistence and cancellation preserve existing running/extracting state and propagation rather than inventing a durable failure receipt or compensating write. Cost: such interrupted operations still need existing recovery/reconciliation; this patch only bounds newly written diagnostics.
- Final full offline backend: 2,678 passed, 128 skipped, 2 inherited deprecation warnings. Ruff check, full-tree format (316 files), mypy (316 files), guarded actual-app OpenAPI comparison and approved-change-only full-file AST comparison all passed.
- Link checks, frontend gates, coverage and opt-in DB/runtime/provider/browser acceptance were not rerun; no inherited gaps are claimed repaired.
- Full evidence, command logs, static/OpenAPI results and limits: `/workspace/scratch/7ae04dc66900/evidence-errors-review/implementation.md`. This is implementation completion for independent review, not publication or runtime acceptance.
