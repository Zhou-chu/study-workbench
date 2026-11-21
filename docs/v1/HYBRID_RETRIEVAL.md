# Evidence-native hybrid retrieval

## Status and scope

The local/independent StudyWorkbench has an explicit, optional semantic retrieval
path alongside its model-free lexical search. **The feature remains disabled by
default.** Source, synthetic offline, and production artifact gates do not approve
activation or establish real embedding quality, privacy, cost, database atomicity,
or browser usability. Current gate results and the exact tested source are in
[the verification manifest](HYBRID_RETRIEVAL_VERIFICATION_2026-11-03.json).

The [reviewed design](../superpowers/specs/2026-11-02-workbench-hybrid-retrieval-design.md)
and [implementation plan](../superpowers/plans/2026-11-02-workbench-hybrid-retrieval.md)
remain committed as design/history. This document describes the implemented path,
not permission to run it. The existing
[product audit](PM_UX_AUDIT_2026-10-28.md) retains its original date and scope;
there is no newly invented November 2 PM audit or implied browser approval.

No new vector database, RAG framework, dependency, model, credential, endpoint, or
user preference is selected by this change. NotebookLM uses its existing separate
service and authentication path. Local retrieval controls and preflight apply only
to independent/local requests. Default lexical options do not require local scope
for remote NotebookLM Ask or Outline; unsupported hybrid combinations reject
explicitly. Outline uses its existing bounded selected-evidence overview, not query
embedding. Recovery no longer labels either path as lexical-only processing.

## Explicit user journey

1. Upload and CPU extraction create immutable versions and canonical evidence.
   Neither operation embeds. A replacement creates a new version; explicitly
   selected retained versions remain usable while their native membership exists.
2. Select the exact local versions and an operator-configured available profile.
   A semantic-index preview reports counts, UTF-8 input bytes, frozen nonsecret
   provider, model name/ID, revision, profile and data destination before consent.
   Preview and status reads do not call an embedding provider or submit a worker
   job. Counts are not a price estimate.
3. Confirm document processing explicitly. Admission binds the preview, all
   selected versions, destination/profile identity and idempotency key. Durable
   group receipts retain every child. Only the existing worker command is queued;
   text and credentials are absent from queue arguments. Document acknowledgment
   does not grant permission to embed a query.
4. Search or Ask defaults to lexical. Selecting hybrid is request-specific and
   submit-only; typing does not submit searches. Query acknowledgment is separate
   and shows the same frozen provider/model/revision identity before consent. It
   resets with mode/profile/destination or model/revision changes, even when the
   profile ID and endpoint remain unchanged. Every hybrid request pins the
   disclosed profile fingerprint and destination descriptor version; a stale
   disclosure rejects before model provisioning or provider dispatch.
5. Read the effective method, fallback reason, selected/indexed counts and job
   status. Search similarities are ranking values, not confidence or truth.
   Generated references are validated from supplied, freshly reread canonical
   evidence, never from copied vector text.

Unknown outcomes stay visible. Read-only checks do not resubmit work. An explicit
retry can incur duplicate embedding cost and uses an exact original request/key
or the separately disclosed full-version rebuild flow as appropriate. Original
recovery metadata is a bounded nonsecret in-document snapshot, not a persisted
credential or proof of restored consent. Missing/rehydrated/tampered hybrid
summaries remain check-only. Cancellation prevents new local dispatch/publication
when fenced, but cannot retract sent bytes or promise remote cancellation,
erasure, or a billing reversal. A cancelled replacement does not revoke a
compatible last-good committed index.

## Scope, storage and ranking contracts

- In the new notebook-scoped path, empty scope denies, never means global. Legacy
  lexical-only search bodies retain their existing API contract. Every selected version's existence,
  notebook membership and ready/partial extraction are validated before content,
  vector reads or model work. One invalid version fails the entire request.
- Existing SurrealDB holds dedicated derived vector/scope/attempt/manifest tables.
  Migration 31 is registered through the async migration registry and its sync
  facade. This work has not executed migrations against a real database.
- A namespace binds profile fingerprint, dimension and preprocessing revision.
  Vector rows contain immutable evidence identity/hash and vector data, no quote,
  title or locator copies. A complete-count/hash manifest publishes one attempt;
  staging rows are not semantic candidates.
- Database predicates bind notebook, selected version/extraction, namespace,
  committed attempt, manifest and scope epoch before vectors are returned. There
  is no global vector scan followed by an application-only notebook filter.
  Application checks repeat physical/canonical identity validation.
- Semantic limits are 5,000 rows, dimensions at most 4,096 and 2,000,000 total
  selected vector elements. Legitimate whole-scope overflow falls back to lexical;
  it does not truncate or silently drop sources. Corruption and authorization or
  database-integrity failures abort rather than masquerading as normal fallback.
- Exact cosine yields at most 48 semantic candidates, alongside at most 48 lexical
  candidates. One-based reciprocal rank fusion uses constant 60, deduplicates IDs
  and breaks ties by evidence ID. Default final limit is 12; caller limit is 1–100.
  Semantic execution with no qualifying hits still reports hybrid, not failure.
- Stable degradation includes disabled/unavailable profile, unready/stale index,
  legitimate size/input limits, unavailable embedding and unknown provider outcome.
  The response explicitly reports lexical_fallback and its reason. There is no
  fallback to a different embedding model or application replay of paid calls.
- Search uses the explicit `{hits, retrieval}` wire envelope, preserving effective
  method, fallback reason, unknown-outcome warning and coverage through transport
  and UI state. Legacy `{hits}` responses remain valid and do not invent semantic
  metadata. Empty results can still carry retrieval warnings.
- Document batches are at most 16, with a 30-second embedding deadline and one
  dispatch slot per worker event loop. Input budgets include prefixes. Exact
  count/dimension, finite/nonzero vector validation and normalization are required.
  Only the specifically inspected no-retry provider adapters/stack versions are
  enabled; other providers/versions fail closed. This is not a provider recommendation.
- Document calls re-admit the current running job, exact attempt, accepted full
  scope and frozen profile after shared-slot acquisition, model resolution and
  provisioning. Admission is per call and task-local; classic callers without it
  keep their existing behavior. Project barriers are not held over provider I/O.
  Admission failures remain hard errors, and already-started/unknown calls are
  never automatically replayed.
- Local Ask carries immutable parent job/turn/notebook/session/request/attempt
  identity through retrieval, query embedding, generation and final child commit.
  Each paid phase rechecks current parent admission. Cancellation or changed
  ownership blocks a new phase and successful child commit for lexical and hybrid
  paths. Parent settlement cannot overwrite a newer or stopped receipt. This
  does not retract already dispatched requests or resolve an unknown outcome.
- Unlink, deletion and reparse advance revocation epochs before cleanup/publication.
  Old vector bytes remaining after cleanup failure do not restore their eligibility.
  Scope is rechecked before generation and inside the final answer commit barrier.
  Historical evidence/citation identities are not rewritten by derived cleanup.
- Restored archives are not automatically locally verified; derived notes/answers
  remain non-independent evidence. A verified quote/locator proves identity/text,
  not that a generated answer's reasoning is correct.

## Configuration illustration: deliberately nonfunctional

Do not paste this into an operational environment. This is an intentionally invalid
schema illustration: the model, credential binding, provider, revision and dimension
are unresolved, and the reserved `.invalid` endpoint cannot be a service destination.
It cannot pass profile validation or configure a real model. No secret belongs here.

```text
STUDY_WORKBENCH_HYBRID_ENABLED=false
STUDY_WORKBENCH_EMBEDDING_PROFILES=/NONEXISTENT/NOT_CONFIGURED/profiles.json
```

```json
[
  {
    "profile_id": "NOT_CONFIGURED",
    "model_id": "NO_MODEL_SELECTED",
    "provider": "NO_PROVIDER_SELECTED",
    "model_name": "NO_MODEL_SELECTED",
    "revision": "NO_REVISION_SELECTED",
    "endpoint": "https://embedding.invalid/not-configured",
    "credential_binding_id": "NO_CREDENTIAL_CONFIGURED",
    "dimension": "UNSET_DIMENSION_DO_NOT_USE",
    "document_prefix": "",
    "query_prefix": "",
    "preprocessing_revision": "evidence-identity-v1",
    "max_input_bytes": "UNSET_BUDGET_DO_NOT_USE",
    "cosine_min_score": "UNSET_THRESHOLD_DO_NOT_USE",
    "destination_descriptor_version": "NOT_CONFIGURED",
    "destination_kind": "unknown"
  }
]
```

A separately authorized operator must choose an existing explicitly configured
embedding model/credential, exact sanitized HTTP(S) destination, dimension, revision,
prefixes, input budget and score threshold. Missing configuration is unavailable,
not permission to probe a paid endpoint or inherit mutable defaults. The deployment
revision is an operator assertion: silent upstream model alias/weight changes
cannot be detected from the alias alone. Rotate profile identity deliberately.
Do not infer on-device processing from a provider name or a loopback-looking label.

## Offline evidence and remaining real gates

`tests/test_workbench_hybrid_acceptance.py` composes the real ingest/parser,
repository, index admission/worker, retrieval, grounded generation/citation reread
and unlink route. Only storage RPCs, queue transport and embedding/generation
outputs are fake. Synthetic English/Chinese text and fixed vectors test routing,
manifest completeness, exact citation identity, fallback and revocation, **not**
multilingual semantic quality. The fake intentionally leaves revoked vectors
physically present. No service, browser, actual provider or real database is used.

The earlier Task 7 assembled run exposed test-harness assumptions and an unrelated
recovery-label regression. That historical result did not cover all integration
boundaries. Subsequent independent review confirmed five defects: document
admission after asynchronous preparation, cancelled parent Ask continuation,
remote lexical preflight, search wire metadata, and initial identity disclosure.
All five were reproduced and addressed together, with permanent actual client,
service, route, transport and rendered UI regressions. The original review probes
remain unchanged and now pass. Shared synthetic wire/turn fixtures are checked
against actual backend route JSON and actual frontend behavior. English/Chinese
consent tests and all 14 locale parity checks pass.

The final frozen product/test commit is
`3a083e49e12f63e70f9cb1a0d8d9790b17461592`. Fresh full gates passed: 3,262 backend
tests (128 skipped), 2,171 frontend tests and 25 artifact tests, all static checks,
production packaging and independent source/artifact verification. An earlier
freeze failed nine frontend cases because revision-bearing disclosure exposed
stale test fixtures; those fixtures were corrected without relaxing production
validation, then the entire frozen gate sequence was rerun. Results are not
warning-free. The manifest records exact commands, hashes, the superseded run
and the distinct documentation-only followup. Independent rereview and the real
runtime gates below remain pending.

Use the prepared environment and supported runner from
[testing](../7-DEVELOPMENT/testing.md), never install dependencies as part of a gate:

```sh
.venv/bin/python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared/tiktoken-cache -- tests/test_workbench_hybrid_acceptance.py -q
.venv/bin/python scripts/offline_pytest.py --tiktoken-cache /path/to/prepared/tiktoken-cache -- tests/ -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/python -m mypy .
```

Frontend gates use an empty allowlisted environment, installed dependencies,
offline npm/no telemetry, TypeScript, lint and the full `npm run test` script
(Node artifact tests plus Vitest). Production `npm run build` and a separate
`node scripts/build-artifact.mjs --verify ARTIFACT_DIR` follow the existing
[artifact identity workflow](ARTIFACT_IDENTITY.md). They establish association and
freshness, not reproducibility or deployment/runtime acceptance. Compiler output
is intentionally suppressed by that workflow, so a successful build is not a
claim of warning-free compiler output.

Before any activation or runtime acceptance claim, separately authorize and record:

- An isolated owned real SurrealDB/queue fixture with synthetic data: execute schema,
  actual bound query syntax, transaction acknowledgment/atomicity, cross-worker
  publication/revocation/cancellation races and cleanup failure behavior. Fake RPCs
  and migration-file integrity do not prove these properties on a server.
- A specifically selected real embedding destination/profile with a bounded budget:
  validate transport/retry/privacy/logging behavior, actual dimensions/revision,
  English/Chinese recall and threshold choices, response quality, privacy/retention
  terms and measured spend. No general quality or cost guarantee is established.
- A current real browser journey against owned isolated services: exact disclosure,
  keyboard/focus, responsive geometry, stale/unknown recovery, full evidence
  readability, citation navigation and visual comfort. Components/jsdom do not
  establish real browser usability.
- Fresh independent integrated code/security review and owner-approved publication.
  Source upload remains denied pending owner approval; no retry, alternate upload,
  push, merge, CI, deployment or activation is performed by this gate.

Keep `STUDY_WORKBENCH_HYBRID_ENABLED=false` until the required acceptance gates and
explicit operational choices are complete. Disabling it leaves lexical search,
local reading and the existing non-embedding outline path available; it does not
claim to cancel already dispatched remote work or erase historical index data.
