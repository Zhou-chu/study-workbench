# Personal turn dispatch uncertainty receipt plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Expose the existing unchanged-queued dispatch ACK uncertainty as an additive machine-readable receipt without changing replay or state semantics.
**Architecture:** Persist a small receipt on the original parent job, carry an explicit InvalidInputError subtype to the existing HTTP handler, and preserve receipt data through same-key responses. Strict generation and permissive retained-data serialization are separate boundaries.
**Tech Stack:** Python, FastAPI, Pydantic, existing PersonalService/store abstractions, offline pytest and generated OpenAPI.
**Spec:** docs/v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md, F1 backend dispatch uncertainty proposal. Frontend operation registry/recovery is not this batch.

## Global Constraints
- No state/code/submission_state/attempt/retry/replay/idempotency, locking or write-order change. Keep failed + WORKER_UNAVAILABLE + not_submitted for the existing unchanged-queued exception path, never describe it as proof of queue rejection or provider submission.
- Add receipt only after locked reread confirms latest == original job. Advanced/metadata-only queued/cancelled/deleted paths remain unchanged.
- Receipt exact generated shape: {"dispatch_ack":"unknown","job_id":<original parent job ID>,"turn_id":<original turn ID>,"retry_safe":false}.
- Initial HTTP 400 retains detail string "WORKER_UNAVAILABLE" and adds sibling dispatch_receipt. Same-key HTTP 200 retains existing job_id/turn_id/state and conditionally adds the stored receipt. No new POST/requeue/recovery behavior.
- Absence/malformed/future receipt values are inconclusive and never allow retry. Workspace/history remain lossless; restored archive receipt is historical metadata, never execution authority. Generic job GET is not a read-only recovery path.
- No services/provider/DB/browser/native calls, dependencies, credentials, cache mutation, main merge/deployment or restricted probes. Prepared offline runner and synthetic external seams only. Parent publishes reviewed source/tests/docs to the approved private audit branch.

## Review Focus
- Queue accepted but lost ACK and no observable acceptance both produce unknown, never rejected; same key enqueues once.
- Fast worker, lock-wait cancellation, metadata-only updates and deletion must not be overwritten or recreated by new metadata.
- Retained values of any JSON type, including future shapes and retry_safe:true, remain opaque and cannot cause a previously readable response to fail or imply safety.
- First error handler returns only fixed literals and allocated IDs, not arbitrary exception dictionaries, raw queue cause, request snapshots or private extras.
- Receipt persistence can fail; do not claim a durable receipt or convert that error into proof of no dispatch. Archive remapping must preserve historical meaning with no replay.

### Task 1: Add and verify the bounded backend receipt

**Production files:** api/personal_service.py; open_notebook/exceptions.py; api/main.py; api/routers/evidence.py; api/personal_contracts.py. No production portable/store/worker changes unless a demonstrated spec contradiction is reported to controller first.
**Tests:** tests/test_v1_personal_enqueue_reconciliation.py; tests/test_v1_personal_response_contracts.py; tests/test_v1_workspace_response_contracts.py; tests/test_v1_api_contract.py; relevant offline portable compatibility tests (not opt-in runtime). Add a focused test file if it reduces unrelated changes.
**Docs/artifacts:** contracts/v1/openapi.json, a synthetic dispatch-unknown fixture, contracts/v1/README.md, CHANGELOG.md, a short ADR and this plan.
**Interfaces:** new PersonalTurnDispatchUnknownError(InvalidInputError), keyword-only job_id: str and turn_id: str, fixed str(exc) == "WORKER_UNAVAILABLE". TurnSubmissionResponse.dispatch_receipt: Any = Field(default=None, description=...) with existing exclude_unset; strict generated receipt/error-envelope models document known fields but do not validate retained historical response values.

- [x] Inspect actual paths and record baseline local c4b4832 / remote3145912; previous full backend2631/static/OpenAPI evidence applies to unchanged baseline, no need duplicate baseline run solely for bookkeeping.
- [x] Write RED tests for unchanged queued enqueue errors: accepted-but-ACK-lost and unobserved acceptance get exact original-ID receipt stored and in real registered HTTP400 handler; preserve state/error/attempts/cause, no raw synthetic secret leakage. Same key/body produces same receipt through real router HTTP200, one enqueue; changed body remains conflict. Preserve all existing advanced-state/deletion/lock-wait race cases.
- [x] Test legacy absence and retained null/string/list/false/malformed object/future extensions/conflicting IDs/retry_safe:true with actual response serialization: preserve supplied JSON, no re-enqueue, never coerce to safe/rejected. Test workspace receipt retained without dispatch and archived nested ID remapping with replay disabled using existing pure/offline helpers.
- [x] Test ordinary InvalidInputError handler unchanged including CORS; dedicated subtype emits only fixed receipt fields/allocated IDs even with injected private extras. Test persistence failure keeps original error semantics and does not report durable receipt. Confirm failed job run_turn remains non-replayed.
- [x] Run focused tests and record expected RED before production changes.
- [x] Implement narrowly: create dedicated exception for allocated IDs, attach exact receipt to latest during existing failed update, persist and raise subtype from original queue error. Keep existing control flow. Handler explicitly checks subtype and constructs allowlisted sibling receipt. Router copies field only if key exists, not by truthiness. Any field preserves stored JSON and absence; no receipt drives backend behavior.
- [x] Document generated HTTP400 envelope additively; regenerate OpenAPI with guarded repository exporter, add synthetic fixture and tests. ADR records strict generation versus permissive read and legacy state limitations. Preserve generic HTTP400 detail-string compatibility and existing success absence.
- [x] Focused GREEN followed by one full offline backend suite, Ruff/format/mypy and guarded OpenAPI check. No skipped/runtime tests counted as passed. No frontend completion claimed.
- [x] Add scoped changelog, update plan evidence steps, commit locally, report exact evidence/limits for independent controller review before publication.

## Self-review / preflight

| Task/interface | Contract check | Result |
| --- | --- | --- |
| Task1 / service and handler | Same original IDs and fixed literals, original status/detail/cause retained | Consistent |
| Task1 / response and historical reads | Any + key membership + exclude_unset preserves every stored JSON type and absence | Consistent |
| Task1 / queue and worker | No retry/read path introduced; advanced/deleted cases untouched | Consistent |
| Task1 / OpenAPI | Strict generated error envelope does not tighten stored receipts | Consistent |

Ruling: keep detail as a string and add sibling dispatch_receipt instead of changing the error envelope's existing field type. Cost: clients must inspect an optional sibling to recognize this uncertainty; legacy clients remain no more informed than before.
Ruling: preserve retained receipt as opaque Any, not a strict optional generated model. Cost: clients need explicit recognition and must never interpret arbitrary stored retry_safe values as authorization; this avoids breaking historical reads.


## Task 1 implementation evidence (2026-10-26 UTC)

- Inspected local baseline `c4b48322621ae0da30d7fb079dc17b654caa4e64`, tree
  `aa348ffce805a2f6ec40f5a46fa18fe19fb7a643`. Controller supplied the verified
  published counterpart `3145912894c49c782f77af72ed018def3673dfae` with that tree;
  this implementer made no remote read or write. Existing candidate branch kept.
- RED, before production edits: **15 expected failures, 19 passed, 1 warning**.
  Missing subtype/receipt, dropped opaque retained values and absent HTTP400 schema
  caused the failures. Existing advanced-state, lock-wait, deletion and pure archive
  compatibility cases remained green. Added an explicit legacy-absence case to the
  subsequent compatibility run; that behavior was already protected for successful
  submissions by the unchanged response-contract fixture.
- Initial GREEN: **52 passed, 1 warning**. Expanded focused gate (enqueue,
  dispatch-receipt, response/workspace/API contracts and three portable suites):
  **187 passed, 1 skipped, 1 warning**. The skip requires an isolated SurrealDB.
- Full unchanged offline runner, prepared Python/token-cache paths from the brief:
  **2647 passed, 128 skipped, 2 warnings**, exit 0. Skips are not passes; dependency
  warnings are Pydantic class-config and Starlette/httpx deprecations. No services,
  provider, DB/runtime or browser acceptance was run.
- Required static gates: Ruff check exit 0; Ruff format check **315 files**, exit 0;
  mypy **315 source files**, exit 0. Guarded exporter regenerated the additive
  snapshot; `export_contract.py --check` exited 0. `git diff --check` passed.
- An extra repository Markdown-link check found one **pre-existing** missing
  historical directory link in `docs/v1/UX_RED_TEAM_2026-10-21.md` to
  `evidence/ux-red-team-2026-10-21/browser/`. The document is unchanged from baseline
  and the target is absent from its tree. It is outside this batch, not repaired or
  counted as a passing gate.
- Full logs and implementation report are in the controller-requested local
  `dispatch-receipt-review/` directory, outside the repository. Offline runner
  SHA-256 remains `fcb70572a0eb213989575a06410668b7035eeadb5467105d504f55fe3d039835`.
  No frontend, deployment, CI, global privacy or reliable-dispatch completion claim.
- Implementer self-review: exact original parent IDs and fixed handler literals;
  opaque key-preserving reads; original state/cause/error/write order preserved;
  unchanged advanced/deleted reconciliation paths; persistence failure propagates;
  failed/restored jobs do not replay. Independent controller review/publication is
  still required after the local implementation commit.
