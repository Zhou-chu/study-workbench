# Provider classifier boundary implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove raw provider messages from classifier outputs and its unmatched warning, without changing classification or caller semantics.
**Architecture:** Keep the existing tuple classifier and ordered keyword rules. Use the existing metadata-only logging helper; no new framework or error reconstruction.
**Tech Stack:** Python, pytest, Loguru, FastAPI registered handlers.
**Spec:** docs/v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md, provider boundary section. This batch implements only its classifier and selected unmatched-warning portion.

## Global Constraints
- Only two production files: open_notebook/utils/error_classifier.py and open_notebook/utils/boundary_logging.py.
- Preserve tuple API, rule order, classes, retry semantics, caller exception identity/cause and handler status/receipt shapes.
- No provider/network calls, services, database runtime, credentials, cache mutation, dependency installation, main merge or deployment.
- Use prepared offline runner/cache; never substitute an unisolated test command if guards block execution.
- Publish tested source/tests/progress only to the existing private fix/audit-followup-20261022 branch, through parent after independent review and read-back.
- Other SSE/default-model/rollback logs and typed-error message provenance remain explicitly outside this batch.

## Review Focus
- Short and long raw messages may contain synthetic credentials, paths or document text: none may enter output or selected warning.
- Mixed keywords retain existing first-rule priority, especially auth/configuration/network versus timeout.
- Cause chains stay internal and do not reappear through the selected Loguru sink.
- Keyword-only typed uncertainty errors retain the exact object and receipt attributes through real wrappers/handlers.
- Registered handlers must run without app lifespan or real DB/model calls; cancellation and invocation count remain unchanged.

### Task 1: Close the classifier raw-message boundary

**Files:** Modify the two production files above, tests/test_error_classifier.py, tests/test_boundary_logging.py and CHANGELOG.md. Create tests/test_provider_error_boundary.py if integration coverage needs a separate file.
**Interfaces:** classify_error(exception: BaseException) -> tuple[type[OpenNotebookError], str]; log_boundary_failure(operation: str, exc: BaseException, *, level: str = "ERROR") -> None.

- [x] Establish clean baseline using the prepared interpreter and repository offline runner. Record exact source tree, commands and results.
- [x] Write failing parameterized tests for model-not-found, raw configuration and unmatched fallback, each with short and long synthetic sentinel content. Assert exact fixed messages below and original exception class.
- [x] Add real Loguru sink regression for unmatched warning: WARNING, operation=llm_error_classification, bounded exception_type and no raw message/cause. Assert registered handler status and unchanged typed uncertainty receipt, and real Ask wrapper original cause plus one provider-seam invocation. Include classification/priority matrix and retain context-length retry coverage.
- [x] Run the new tests and record expected failures against unchanged production source.
- [x] Replace model-not-found message with "The selected AI model is unavailable. Please check your model configuration in Manage -> Models." Replace raw-configuration message with "No AI model is configured for this operation. Please configure a default model in Manage -> Models." Replace unmatched message with "The AI service could not complete the request. Please try again later." Remove unused truncation helper only after checking callers.
- [x] Add llm_error_classification to helper allowlist and use log_boundary_failure("llm_error_classification", exception, level="WARNING") instead of raw warning. Keep all existing rule order and other fixed messages unchanged.
- [x] Run focused tests, fresh full offline backend tests, Ruff/format/mypy and OpenAPI checks according to repository instructions. Report frontend and runtime gates as unrun unless actually exercised, without transferring previous PASS.
- [ ] Add one concise security changelog bullet; record narrow scope, evidence and remaining four selected-log migrations. Commit tested batch locally with conventional message; obtain independent review before publication.

## Self-review and preflight

| Task/interface | Consistency check | Result |
| --- | --- | --- |
| Task 1 / classifier | Exact messages and ordered class mapping are tested; no caller rewrite | Consistent |
| Task 1 / logger | New operation is allowlisted; existing metadata-only rendering preserved | Consistent |
| Task 1 / wrappers and handlers | Tests pin existing identity, cause, status and receipt semantics; no production changes there | Consistent |

Ruling: split the published six-file proposal into this independently verifiable two-file batch and a later selected-log migration. This reduces review scope; the cost is explicitly retaining known separate log exits. No claim of global sanitization is permitted.

## Local implementation evidence (2026-10-26 UTC)

Executed in the explicitly supplied isolated recovery checkout on local branch
`fix/provider-classifier-boundary`, based on commit
`6362d90d535af55872d7330345f2474b594012ab` / tree
`8ffe2592ec884b23ad910a48cc3b998f6cab4f98`. The controller's handoff requires
inline execution without child agents; independent review and any remote
publication remain the controller's responsibility.

- Clean baseline: **2,519 passed, 128 skipped, 2 warnings**.
- Regression RED before any production edit: **28 expected failures, 59 passed**.
- Focused GREEN: **87 passed**, no skips, one existing dependency warning.
- Fresh full offline backend: **2,559 passed, 128 skipped, 2 existing dependency warnings**.
- Full candidate Ruff check/format: PASS (**313 files**); mypy: PASS (**313 source files**).
- Guarded OpenAPI snapshot comparison: PASS, without lifespan or service startup.
- Self-review: exactly the two permitted production files changed; all nine
  ordered keyword/class rules and all other fixed rule messages remain unchanged.
  Short/long sentinel, real Loguru, registered-handler, Ask cause/invocation,
  typed uncertainty identity/receipt, cancellation and context-length retry
  coverage passed. The unused truncation helper had no other callers.

Full commands, results, skip reasons and limitations are in the controller-requested
`/workspace/scratch/7ae04dc66900/provider-boundary-review/implementation.md`.
The security changelog entry is included. Local implementation is ready for
independent review; the final combined checklist item remains open for that gate.
Frontend, runtime, provider/DB/browser acceptance, coverage, CI, global
sanitization, main merge and deployment are **not claimed**.

Four selected log migrations remain deferred: Ask SSE failure, source-chat SSE
failure, default-model fallback failure and rollback cleanup traceback. Typed-error
message provenance and all other logging exits also remain outside this batch.
