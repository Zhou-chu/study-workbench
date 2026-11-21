# StudyWorkbench Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicitly requested, evidence-scoped semantic recall to lexical workbench retrieval using existing infrastructure.

**Architecture:** Immutable evidence remains authoritative; SurrealDB holds derived normalized vectors and atomically published manifests. An explicit indexing worker pins existing embedding configuration, while a scoped service performs exact cosine + reciprocal-rank fusion and preserves canonical citation validation.

**Tech Stack:** Existing Python 3.11–3.12, Pydantic, FastAPI, SurrealDB client/database, surreal-commands, Esperanto, numpy, React/TypeScript and existing test runners. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-02-workbench-hybrid-retrieval-design.md`. Proposed plan repository path: `docs/superpowers/plans/2026-11-02-workbench-hybrid-retrieval.md`.

## Global Constraints
- Empty scope is deny, never global. Validate every requested version's existence, notebook membership and ready/partial extraction **before any evidence content read, vector retrieval or model provisioning/call**.
- Upload, extraction, workspace/status polling, index preview, lexical search and outline do not embed. Hybrid search is explicit per request and its UI is submit-only, not on each keystroke.
- Default mode is lexical; hybrid requires acknowledgment for remote/unknown destinations. Every hybrid request pins disclosed_profile_fingerprint and destination_descriptor_version; stale disclosure rejects before provisioning/call with EMBEDDING_DISCLOSURE_STALE.
- No new dependencies. Feature flag `STUDY_WORKBENCH_HYBRID_ENABLED=false` until acceptance gates pass.
- Default result limit 12; caller limit 1..100; top 48 candidates per channel; one-based reciprocal-rank fusion constant 60.
- Semantic scope maximum 5,000 rows, dimension <=4096, total selected vector elements <=2,000,000. Overflow means whole-scope lexical fallback, not truncation.
- Embedding batch size 16, timeout 30 seconds, concurrency 1 per worker. No automatic application replay of embedding calls or unknown job submission.
- Real provider/DB/browser execution, installation and device access are not authorized by this plan. Only isolated fake-based tests may run in an approved development environment without additional runtime authorization.

## Review Focus
- Mutable configured defaults/endpoint and same-dimension model changes must not mix namespaces or bypass destination acknowledgment (Task 1).
- Source unlink and notebook deletion must revoke new retrieval despite retained version/evidence records (Tasks 2 and 4).
- Worker death after provider acceptance but before durable result must report uncertainty without replay or false success (Task 3).
- Unverified archive/derived evidence must retain provenance and not become verified because semantic score is high (Task 4).
- Stale UI response after profile/mode/source switch must not repaint the new scope or resubmit an uncertain paid operation (Task 6).

---

Set `PREPARED_TIKTOKEN_CACHE` to an existing verified token-cache directory before the commands below. Do not download cache data implicitly.

## Baseline and preparation
Pinned source inspection: `df94d8c18bfbae217aea5c9283b7a24d38844d24` on `fix/audit-followup-20261022`. Product code is not yet changed. Before execution, read approved design and current branch diff; use an isolated authorized worktree and repository AGENTS instructions. Do not operate on the old local checkout as though it is this SHA. Reconcile concurrent audit UX work rather than overwriting it. Proposed migration 31 is valid only if still next. Read actual test scripts before running; commands below use installed tooling only (the supported offline runner and repository npm scripts), not dependency installation. A missing runtime blocks that verification; it is not permission to fetch dependencies or start services.

## Task 1: Immutable profile and explicit embedding boundary
**Files:** Create `open_notebook/domain/evidence_retrieval.py`, `open_notebook/ai/evidence_embeddings.py`, `tests/test_evidence_embedding_profiles.py`, `tests/test_evidence_embedding_calls.py`. Read/reuse `open_notebook/ai/models.py`; only add a utility entry point in `open_notebook/utils/embedding.py` if it avoids duplication without changing existing callers.

**Interfaces produced:**
- `EmbeddingProfile`, `ScopeEntry`, `ScopeSnapshot`, `RetrievalResult`, `IndexPreview`, `IndexReceipt` contracts per spec; create `QueryEmbeddingDisclosure` with `disclosed_profile_fingerprint: str`, `destination_descriptor_version: str`, `acknowledge_query_processing: bool` (required nonempty fingerprint/version for hybrid); `ScopeSnapshot.entries` is a sorted tuple of `ScopeEntry(version_id, extraction_id, manifest_hash, scope_epoch)`.
- `load_profiles() -> dict[str, EmbeddingProfile]`: strict local deployment configuration load, no model construction/network.
- `EvidenceEmbeddingClient.resolve_profile(profile_id: str) -> EmbeddingProfile`: metadata/config checks only.
- `async EvidenceEmbeddingClient.embed_documents(profile: EmbeddingProfile, texts: list[str]) -> list[list[float]]` and `async embed_query(profile: EmbeddingProfile, query: str) -> list[float]`: pinned provider boundary with injected resolver in tests. Stable sanitized exceptions distinguish unavailable, invalid response and outcome unknown.

- [ ] Write failing tests `test_profile_fingerprint_changes_for_revision_endpoint_dimension_and_prefix`, `test_profile_missing_dimension_or_revision_is_unavailable_without_probe`, `test_default_model_change_does_not_change_pinned_model`, `test_model_configuration_change_rejects_before_send`, `test_acknowledged_profile_a_rotated_to_b_rejects_before_provision_or_send`, `test_invalid_vectors_and_response_count_fail`, `test_timeout_is_unknown_and_not_retried`, `test_oversize_input_is_not_truncated`. Include assertions:
```python
assert fake.calls == []  # malformed profile, no acknowledgment or over-budget input
assert len(fake.calls) == 1  # timed-out invocation is not replayed
assert old.fingerprint != changed_same_dimension_model.fingerprint
assert profile_public_json.find(secret) == -1
```
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_evidence_embedding_profiles.py tests/test_evidence_embedding_calls.py -q`; expect missing new module/contracts, not external-service failures.
- [ ] Implement the listed contracts and pinned adapter; compare disclosure fingerprint/descriptor version before provisioning and send, and provision from the checked frozen config rather than rereading mutable destination; validate finite/nonzero dimensions, counts, normalization, batch 16, timeout 30, no fallback model, sanitized errors. Require explicit configured byte limit and cosine threshold; inspect provider retry controls and keep unsupported retry behavior unavailable.
- [ ] Re-run those two test modules; expect all pass, fake invocations only. Run existing embedding utility/model tests located in pinned tree if shared utility changed.
- [ ] Commit exact Task 1 files: `feat: add pinned evidence embedding profiles and call boundary`.

## Task 2: Scoped vector storage, manifest publication and invalidation
**Files:** Create `open_notebook/database/evidence_embedding_repository.py`, `open_notebook/database/migrations/31.surrealql`, `open_notebook/database/migrations/31_down.surrealql`, `tests/test_evidence_embedding_repository.py`. Modify migration registries `open_notebook/database/async_migrate.py` and `open_notebook/database/migrate.py` only as their actual registration requires; `open_notebook/domain/notebook.py`, `api/routers/notebooks.py`, `api/evidence_service.py` extraction publication seam. Add tests to `tests/test_migration_integrity.py`.

**Interfaces consumed:** Task 1 profile and scope contracts; existing `repo_query`, physical IDs, project commit locks.
**Interfaces produced (async repository):** `capture_scope(notebook_id: str, version_ids: list[str]) -> ScopeSnapshot`; `assert_scope(snapshot: ScopeSnapshot) -> None`; `status(snapshot, profile) -> dict`; `write_batch(attempt_id: str, snapshot: ScopeSnapshot, profile: EmbeddingProfile, rows: list[dict]) -> None`; `publish(attempt_id, snapshot, profile, expected_count: int) -> dict (checks both scope epoch and attempt cancellation fence)`; `scoped_vectors(snapshot, profile, row_cap: int=5000, element_cap: int=2000000) -> list[dict]`; `invalidate(notebook_id: str, version_ids: list[str], reason: str) -> None`; `cleanup_staging(attempt_id: str) -> None`.

- [ ] Write failing fake-query tests `test_empty_scope_reads_no_content`, `test_all_metadata_checked_before_first_evidence_read`, `test_vector_query_binds_notebook_versions_extractions_namespace_attempt`, `test_staging_is_invisible`, `test_publish_cas_rejects_changed_epoch`, `test_source_unlink_revokes_retained_versions`, `test_delete_failure_cannot_reenable_vectors`, `test_cap_checked_before_vector_payload_read`, `test_parameter_values_never_interpolated`. Assert foreign row injection fails and tombstone precedes cleanup:
```python
assert query_params['notebook_id'] == 'nb_allowed'
assert 'foreign_quote' not in repr(fake_model.calls)
assert operations.index('invalidate') < operations.index('delete_vectors')
assert published_after_revocation is False
```
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_evidence_embedding_repository.py tests/test_migration_integrity.py -q`; expect new contract failures only.
- [ ] Implement tables/profiles/manifests/vector identity and bound DB prefilters; first metadata-count rows and vector-element budget, then fetch scoped vectors. Implement transactional/CAS publish of complete count/hash manifest and epoch invalidation under existing project barrier; verify every multi-statement acknowledgment using established raw-query pattern. Do not rely on SDK returning only first statement. Wire source/notebook deletion/reference-removal and extraction-change invalidation before destructive publication. Never mutate historical evidence/originals.
- [ ] Re-run offline tests; expect pass. Mark DB transaction/query syntax and cross-process semantics **pending live isolated DB gate**, not proven by mocks. Down migration removes only new derived tables; disabling flag is non-destructive rollback.
- [ ] Commit Task 2 files: `feat: persist scoped evidence vectors with fenced manifests`.

## Task 3: Explicit preview and durable no-replay indexing jobs
**Files:** Create `api/evidence_indexing.py`, `tests/test_evidence_indexing_jobs.py`, `tests/test_evidence_indexing_routes.py`. Modify `commands/evidence_commands.py`, `commands/__init__.py`, `api/routers/evidence.py`, `api/personal_contracts.py`, `api/personal_service.py` only for operation registration/reconciliation/cancel handling. Reuse existing dispatch receipt conventions.

**Interfaces consumed:** Task 1 client, Task 2 repository.
**Interfaces produced:** `async EvidenceIndexingService.preview(notebook_id: str, version_ids: list[str], profile_id: str) -> IndexPreview`; `async submit(notebook_id: str, request: IndexRequest) -> IndexReceipt`; `async run(job_id: str) -> dict`; `async status(notebook_id: str, version_ids: list[str]) -> dict`. `IndexRequest` fields exactly per design (`source_version_ids`, `profile_id`, `preview_hash`, `acknowledge_external_processing`, `idempotency_key`, `retry_of_job_id: str | None = None`, `acknowledge_duplicate_embedding_cost: bool = False`). A retry must reference a prior same-notebook/version/profile failed/unknown/cancelled attempt and explicitly set the duplicate-cost flag true; it uses a fresh idempotency key and current preview/disclosure. A fresh initial build must omit retry_of_job_id; setting the duplicate-cost flag alone never authorizes replay. `index_evidence` worker takes only durable job ID; one attempt, no SDK-independent retry loop.

- [ ] Write failing tests for preview no-call, changed preview/profile/extraction rejected, explicit acknowledgment required, duplicate receipt same key, conflict changed intent, failure/unknown queue acknowledgment, cancellation before/between batches, test_cancel_rebuild_preserves_scope_epoch_and_last_good_manifest, test_explicit_retry_rebuilds_all_batches_with_duplicate_cost_ack, restart after dispatch-started, failed final publish and late worker fencing. Assertions:
```python
assert preview_provider.calls == []
assert await submit_same_key_twice() == original_receipt
assert restarted_job['state'] == 'submission_unknown'
assert restarted_provider.calls == []
assert failed_publish_manifest_is_ready is False
assert cancelled_job['remote_cancel_confirmed'] is False
```
  Use missing/false remote confirmation rather than inventing a provider cancellation API. Test progress increments only after durable acknowledged batch, and failed rebuild leaves compatible last-good manifest identifiable.
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_evidence_indexing_jobs.py tests/test_evidence_indexing_routes.py -q`; expect missing handlers/service.
- [ ] Implement GET status and POST preview/index routes under existing personal authentication; all scope checks precede content loading; persist disclosure snapshot and exact provider/model identity, hash and epoch. Register worker; add canceled/unknown reconciliation without replay. Cancellation changes only the attempt fence, never version scope epoch or last-good compatible manifest. Only explicit retry with new intent and duplicate-cost acknowledgment can redo provider work; first increment rebuilds every batch of the whole version under a new attempt ID and implements no cross-attempt resume. Do not expose provider raw errors, secret URLs, quotes, vectors or queries in receipts/logs.
- [ ] Re-run new tests plus `tests/test_v1_personal_dispatch_receipt.py`, `tests/test_v1_personal_enqueue_reconciliation.py`, `tests/test_v1_job_cancellation.py`; expect pass and unchanged legacy job behavior.
- [ ] Commit Task 3 files: `feat: add explicit semantic indexing with durable receipts`.

## Task 4: Scoped lexical/semantic retrieval and canonical reread
**Files:** Create `api/evidence_retrieval.py`, `tests/test_workbench_hybrid_retrieval.py`, `tests/fixtures/workbench_hybrid_retrieval.json`. Modify `api/evidence_service.py` only to share lexical scoring if necessary; retain `retrieve(query, version_ids, limit=12)` legacy contract.

**Interfaces consumed:** Tasks 1–2; existing evidence reads/citation validation.
**Interface produced:** `async EvidenceRetrievalService.retrieve(query: str, notebook_id: str, version_ids: list[str], *, mode: str='lexical', profile_id: str|None=None, acknowledge_query_processing: bool=False, disclosed_profile_fingerprint: str|None=None, destination_descriptor_version: str|None=None, limit: int=12) -> RetrievalResult`; `rrf(lexical_ids: list[str], semantic_ids: list[str], limit: int=12) -> list[tuple[str,float]]` with constant 60.

- [ ] Write failing tests for empty/foreign/not-ready/all-ready scope, exact English/Chinese lexical, synthetic synonym/cross-lingual semantic, below-threshold unrelated vector, ties/dedup, top 48 channels, 12 final hits, tiny scope adjacent foreign high scores, same-dimensional foreign namespace, cap/overflow/no-ready-index fallback, provider unavailable/unknown, stale/deleted/reparsed scope, canonical corruption and restored/derived evidence. Include:
```python
assert rrf(['a'], ['a'])[0] == ('a', 2 / 61)
assert empty_result.hits == []
assert empty_result.retrieval_method == 'hybrid'  # semantic ran, no qualifying hit
assert unready_result.retrieval_method == 'lexical_fallback'
assert unready_provider.calls == []
assert restored_hit['reference_validity'] == 'unverified'
assert derived_hit['independent_support'] is False
```
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_workbench_hybrid_retrieval.py tests/test_v1_scoped_retrieval.py -q`; expect new service missing, legacy tests unchanged.
- [ ] Implement validation, lexical candidates, whole-scope readiness preflight, one authorized query embedding, scoped exact cosine and stable RRF per spec. Canonical reread validates IDs/hash/locator/provenance; integrity/auth errors abort instead of fallback. Return metadata even zero hits; no automatic index/model fallback; reject invalid mode/profile combinations and out-of-range limits.
- [ ] Re-run targeted tests plus `tests/test_v1_evidence_reads.py`, `tests/test_v1_evidence_revalidation.py`; expect pass. Fixture documentation must say synthetic vectors exercise routing/ranking, not prove a real multilingual model's recall.
- [ ] Commit Task 4 files: `feat: add scoped hybrid evidence retrieval and explicit fallback`.

## Task 5: Search and grounded-turn integration without changing grounding authority
**Files:** Modify `api/routers/evidence.py`, `api/personal_contracts.py`, `open_notebook/graphs/grounded_chat.py`, `api/personal_service.py` as needed to preserve full request dispatch. Create `tests/test_workbench_hybrid_contracts.py`; extend `tests/test_v1_grounded_chat.py`, `tests/test_v1_api_contract.py`.

**Interfaces:** Search accepts legacy lexical body unchanged, new workbench body includes notebook_id plus retrieval_mode/embedding_profile_id/acknowledge_query_processing. Hybrid must have notebook ID; search and TurnRequest additionally require disclosed_profile_fingerprint and destination_descriptor_version for hybrid, lexical defaults. GroundedChat calls Task 4 and stores `retrieval` metadata with result; legacy `hits` payload remains. Outline never uses Task 4 semantic path. Include retrieval fields in immutable request hash.

- [ ] Write failing tests `test_hybrid_search_requires_notebook_and_ack`, `test_old_lexical_search_has_no_provider_calls`, `test_zero_hits_skips_generation_but_reports_query_embedding`, `test_outline_never_embeds`, `test_scope_recheck_before_generation`, `test_mode_or_profile_change_conflicts_same_turn_key`, `test_queued_turn_keeps_disclosed_fingerprint_and_rejects_rotated_destination`, `test_model_cannot_cite_unsupplied_semantic_evidence`, `test_fallback_metadata_survives_response_models_and_persistence`.
```python
assert generator.calls == []  # no retrieval hits
assert query_embedder.call_count == 1  # eligible hybrid no-hit
assert turn['retrieval']['retrieval_method'] == 'lexical_fallback'
assert forged_citation['reference_validity'] != 'verified'
```
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_workbench_hybrid_contracts.py tests/test_v1_grounded_chat.py tests/test_v1_api_contract.py -q`; expect only new contract failures.
- [ ] Integrate service and metadata; preserve current engine/local restrictions, prompt budget, no-hit no-generation and supplied evidence validation. Recheck scope just before prompt dispatch and do not silently retry a changed scope. Add stable fallback/no-hit wording and never equate similarity with verified facts.
- [ ] Re-run targeted tests plus `tests/test_v1_personal_response_contracts.py`; expect pass.
- [ ] Commit Task 5 files: `feat: expose hybrid retrieval metadata in search and grounded turns`.

## Task 6: Explicit indexing UI and truthful hybrid status
**Files:** Create `frontend/src/components/workbench/SemanticIndexPanel.tsx` and `.test.tsx`; modify `frontend/src/components/workbench/StudyWorkbench.tsx`, `TurnCoverage.tsx`, `JobsPanel.tsx`, `frontend/src/lib/api/evidence.ts`, `frontend/src/lib/types/personal.ts`, `frontend/src/lib/hooks/use-workbench-evidence-search.ts`, `frontend/src/lib/hooks/use-workbench-turn.ts`, `frontend/src/lib/workbench/turn-context.ts`, `frontend/src/lib/locales/workbench.ts`. Extend colocated tests; exact i18n exports must follow current pattern, not create duplicate locale system.

**Interfaces:** `SemanticIndexPanel({notebookId, sourceVersionIds, profileId, onProfileChange})`; API client `semanticStatus`, `previewSemanticIndex`, `buildSemanticIndex` mirror Task 3; typed `RetrievalResult` mirrors backend. Search/turn request context identity includes mode and profile. UI sends disclosed_profile_fingerprint and destination_descriptor_version captured with the disclosure, and binds both to request generation/idempotency. UI stores disclosure acknowledgment separately for documents and query processing, resets it when destination/profile changes; never persists credentials.

- [ ] Write failing component/hook tests for lexical default, explicit preview/confirm, missing profile unavailable, cloud/unknown destination disclosure, counts not price estimates, keyboard confirm/cancel, indexing versus extraction ready, fallback on zero-hit, unknown/late job status, cancellation not promised remote stop, profile/source/mode switch during request, no per-keystroke embedding request and no automatic submission retry.
```typescript
expect(buildIndex).not.toHaveBeenCalled() // preview/open alone
expect(search).not.toHaveBeenCalled() // typing alone
expect(screen.getByText(/仅关键词|Lexical only/)).toBeVisible()
expect(newScopeResults).not.toContain(oldProfileEvidenceId)
```
- [ ] Run installed frontend test runner for new panel and modified hooks (`cd frontend && npm run test:unit -- src/components/workbench/SemanticIndexPanel.test.tsx src/lib/hooks/use-workbench-evidence-search.test.tsx src/lib/hooks/use-workbench-turn.test.tsx`); use `npm run test` for the full repository frontend test script. Expect missing controls/contracts first. Never load ambient service/credential configuration for these tests.
- [ ] Implement minimal panel and mode selector; localize Chinese/English; show actual effective method, reason, coverage and job phase; never mark configured as tested or partial index as ready. Bind all submissions to immutable request context. Retain audit-fix extraction readiness and privacy behavior.
- [ ] Re-run targeted tests, all workbench component tests, existing frontend typecheck/lint commands; expect pass. A mocked component test is not real keyboard/browser acceptance.
- [ ] Commit Task 6 files: `feat: add explicit indexing and hybrid retrieval controls`.

## Task 7: Gate evidence, regression and reviewed delivery
**Files:** Create `docs/v1/HYBRID_RETRIEVAL.md`, `tests/test_workbench_hybrid_acceptance.py`; update `docs/v1/PM_UX_AUDIT_2026-11-02.md` only if that report exists after parent integration, otherwise link current audit without inventing status. Keep proposed design and plan committed beside implementation.

**Interfaces:** Offline acceptance composes fake repository/provider/worker using Tasks 1–6; live fixture uses a separately authorized isolated database/provider and is opt-in, never default CI.

- [ ] Write failing end-to-end fake scenario `test_explicit_index_search_turn_citation_and_revoke`: two notebooks, immutable version replacement, index preview/build, hybrid question, citation reread, revoke/unlink, late job completion; assert scoped text only, manifest count complete, citation locator exact, revoked vectors unusable, no silent retries. Add `test_lexical_remains_usable_with_hybrid_disabled`.
- [ ] Run `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- tests/test_workbench_hybrid_acceptance.py -q`; expect missing assembled behavior first, then implement only integration fixes exposed by test (return to owning task review if scope changes).
- [ ] Run all new modules and existing v1 scoped retrieval, grounding, evidence read/revalidation, routes, dispatch, cancellation, migration integrity suites with existing tooling. Record exact commands, commit, results, test count and environment; no inherited historical totals.
- [ ] Run full installed backend/frontend suites if authorized and available; report skips/failures separately. Inspect diff for secrets, raw provider errors, fallback model selection, global vector scans and automatic retries. Request fresh code/security review before merge.
- [ ] Document configuration example with deliberately nonfunctional placeholder model/revision/dimension values; no provider recommendation becomes a user's setting. Record isolated real DB, real embedding quality/privacy/spend, and real browser gates as pending until explicit authorization and results exist. Keep feature flag false until gates pass.
- [ ] Commit reviewed progress and push to the user-authorized branch; verify remote head contains commit. Never force-push/merge or claim runtime acceptance merely from upload. Parent owns GitHub writes for this planning turn.

## Plan self-review (performed 2026-11-02)
Coverage: contracts/provider/privacy Task 1; namespaces/filtering/fences/deletion Task 2; explicit authorization/jobs/unknown outcomes Task 3; fusion/fallback/canonical authority Task 4; public/persisted metadata and no-hit behavior Task 5; accessible visible controls/context isolation Task 6; runtime gates/rollback/evidence Task 7. Review Focus items all have named tests. Types use `ScopeSnapshot` consistently, and retrieval acknowledgment is explicit in Task 4 and request contracts. Existing classic helper/API remain compatible. No task authorizes services, credentials, installs or devices. The plan is sequential except test fixture preparation; security-sensitive storage and provider interfaces should receive fresh review per task, so subagent-driven execution is recommended when implementation is authorized.

Status/action ledger: design and self-reviewed plan **done locally**; pinned GitHub reads **done**; two nonexistent guessed file reads **not found, no writes**, corrected using pinned tree evidence. Product implementation **not started by delegation**. Real SurrealDB/provider/browser acceptance **pending authorization/environment**; target is isolated test deployment and explicitly chosen provider, reason is privacy/cost/service/device boundary. No denied action has been retried or bypassed. Model/profile/threshold values are unresolved deployment configuration, not assumptions.

Builder correction incorporated: query disclosure identity survives queued dispatch and rejects endpoint/model rotation with zero provisioning/provider calls. Index preview identity alone was not sufficient for query consent.

Final builder decisions incorporated: cancellation is attempt-local, preserves compatible last-good index, and cannot widen to scope revocation; explicit retry is a full-version rebuild with possible duplicate-cost warning and no cross-attempt batch resume. Tests in Task 3 pin both decisions.

## Execution runner correction
Root AGENTS/testing requires the supported offline runner for every backend test invocation; bare pytest/python -m pytest is not an alternative. The prepared execution cache value is `"$PREPARED_TIKTOKEN_CACHE"`; this is an execution-environment value, not a product default or permission to download a cache. Use `.venv/bin/python scripts/offline_pytest.py --tiktoken-cache "$PREPARED_TIKTOKEN_CACHE" -- <test paths and pytest arguments>`. It must run without ambient service/credential configuration. Frontend scripts are `npm run test` (full) and `npm run test:unit -- <paths>` (targeted), never npm test -- --run. Missing approved tooling/cache is reported, not bypassed by direct pytest or installation. Continue authorized work autonomously; this plan does not introduce an optional product-choice approval stall.

Contract completeness: both SearchRequest and TurnRequest carry `QueryEmbeddingDisclosure` fields on their wire body (not just internal service parameters). `IndexRequest` explicitly includes retry_of_job_id and acknowledge_duplicate_embedding_cost; Task 3 tests reject absent/false acknowledgment on retries, cross-notebook retry IDs, a fresh key pretending to be the old uncertain submission, and mismatched preview/profile. No automatic retry follows a flag default. Before publishing an explicit retry receipt, fence the referenced old attempt under the project commit barrier so a late uncertain worker cannot publish after its replacement; retain the old receipt/history and never mutate it into the new attempt.
