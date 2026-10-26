# Selected provider log migration plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Remove raw values and traceback rendering from four selected failure logs while leaving error propagation and public response contracts unchanged.
**Architecture:** Reuse log_boundary_failure with four allowlisted operations. Do not rebuild typed errors, wrap generators, redesign model provisioning or change rollback semantics.
**Tech Stack:** Python, pytest, Loguru, existing SSE generators and graph helper.
**Spec:** docs/v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md, selected provider logging section. Classifier portion is already implemented and published at c828657.

## Global Constraints
- Production scope: api/routers/search.py, api/routers/source_chat.py, open_notebook/ai/models.py, open_notebook/utils/graph_utils.py and existing open_notebook/utils/boundary_logging.py allowlist.
- Only selected failure logs change. Preserve SSE event shape and typed-error payload behavior; no complete after failure. Preserve default-model None fallback, exception catch types, rollback ordering and original exception object/cause.
- No services, DB, browser, providers, dependencies, credentials, cache mutation, main changes or deployment. Use unchanged offline runner/prepared cache and synthetic external seams only.
- No universal sanitation claim: typed SSE messages, missing-model warning, message-count warning, embedding/model repr and other sinks remain out of scope.
- Parent publishes tested source/tests/docs to existing private audit branch after review and remote readback.

## Review Focus
- SSE errors before and after partial output must retain event order with one error and no complete.
- Typed domain errors retain exact public message/receipt attributes where applicable; logging change cannot alter retry decisions.
- Model IDs/types/kwargs and short/long exception strings must not enter the selected fallback error log.
- Rollback failures may hold the original provider failure in their implicit context; neither chain nor thread/message IDs may enter the selected log.
- Rollback with no message ID/missing stored message remains a no-op, and cleanup failures never mask the original invocation error.

### Task 1: Migrate four logs using the existing helper

**Files:** Five production files above; new tests/test_selected_provider_logs.py; existing tests/test_boundary_logging.py only if useful; CHANGELOG.md; this plan.
**Interfaces:** log_boundary_failure(operation: str, exc: BaseException, *, level: str = "ERROR") -> None. Existing function/generator signatures unchanged.

- [x] Inspect current source/tests and document actual causal paths. Baseline is local 8ac44ed / tree ab51f1fe, equivalent to published c828657. Prior fresh backend gates already cover this unchanged application source; do not rerun a baseline solely for bookkeeping.
- [x] Add failing tests through real Ask/source-chat generators, real ModelManager.get_default_model with synthetic get_defaults/get_model, and real invoke_chat_turn/discard_unanswered_message with a fake graph. Capture actual serialized Loguru sink with backtrace and diagnose enabled. Use synthetic short/long token, path, document, model/thread/message ID sentinels and cause/context chains; assert absence in selected log records.
- [x] Pin ERROR level and operations ask_stream, source_chat_stream, default_model_load, discard_unanswered_message. Assert original SSE output shape/order and terminal behavior, default fallback None and one get_model call, rollback ordering/no-op behavior, original invocation exception identity/cause. Include typed errors and cancellation propagation to ensure no changed catches.
- [x] Run focused tests against unchanged production code and record expected RED. Do not weaken assertions to match leakage.
- [x] Replace the four selected raw logs with log_boundary_failure and add the four operation names to existing allowlist. Bind caught cleanup Exception as needed; do not change catches, return values or add retries. Remove imports only if actually unused.
- [x] Run focused GREEN, then one full offline backend run; Ruff/format/mypy and guarded OpenAPI snapshot checks. Report all runtime/frontend/CI gates as not run.
- [x] Add one scoped security changelog item. Update plan checkboxes for implemented checks and commit locally. Write full evidence report outside source; parent obtains fresh independent spec+quality/whole-branch review before publishing.

### Implementation evidence (2026-10-26 UTC)

- Unchanged-production RED: 60 expected selected-log failures, 12 passing contract/cancellation cases; no assertions weakened.
- Final focused GREEN: 144 passed, 2 existing warnings. Final full offline backend: 2631 passed, 128 unchanged opt-in skips, 2 existing warnings.
- Full-tree Ruff/format/mypy PASS (314 files); guarded actual-app OpenAPI snapshot matches. AST comparison preserves all other production behavior and unrelated log statements.
- Initial new-test typing errors were corrected with annotations and real Model fixtures; focused/full/static gates were rerun on final test bytes.
- Full implementation evidence and logs are outside source in `selected-logs-review/implementation.md` in the parent workspace.
- Frontend/runtime/DB/provider/browser/coverage/CI/main/deployment gates were not run. Independent parent review and any publication remain pending; these checkboxes record implementation, not independent approval.

## Self-review / preflight

| Task/interface | Consistency | Result |
| --- | --- | --- |
| Task 1 / four log call sites | Same helper and ERROR level, independent allowlisted operation keys | Consistent |
| Task 1 / SSE and model fallback | Tests pin existing outputs/returns, changes only logs | Consistent |
| Task 1 / rollback | Tests pin original failure identity and cleanup order, changes only sink rendering | Consistent |

Ruling: preserve typed-error SSE message semantics rather than silently redefine their trust boundary in a logging-only batch. Cost: typed-message provenance remains a separately documented gap, not globally safe output.
