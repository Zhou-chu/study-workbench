# ADR-024: Evidence-native vectors use canonical scope and fenced publication

- **Status**: Accepted for source implementation; isolated database runtime gate pending
- **Date**: 2026-11-02
- **Related**: [hybrid retrieval design](../../superpowers/specs/2026-11-02-workbench-hybrid-retrieval-design.md), [ADR-017](ADR-017-atomic-embedding-publication.md), [ADR-020](ADR-020-database-error-and-logging-boundary.md)

## Context

Classic source embeddings are not canonical evidence identities. Hybrid retrieval
must never use global candidates followed by application-only filtering, expose
staging vectors, or let a worker publish after its source scope was revoked.
Retained source-version metadata does not grant active notebook membership.

Existing personal metadata uses hashed physical `v1_version`, `v1_extraction`
and `v1_evidence` records. Native membership is `source -> reference -> notebook`.
Extraction records contain ordered evidence IDs but no retained quote-hash
manifest. Existing project locks coordinate API/worker commit sections, and the
SDK's convenience query method does not validate every statement response.

Notebook cascades already hold mutation/project locks before deleting exclusive
sources. Reacquiring those locks inside ordinary source invalidation would
self-deadlock or invert the global project-lock order. Deferring deletion beyond
that barrier would alter lifecycle/exclusivity behavior and is not this change.

## Decision

1. Keep vectors derived and separate in dedicated SurrealDB profile, scope,
   attempt, complete-manifest and vector tables (migration 31). Namespace binds
   the immutable profile fingerprint, configured dimension and preprocessing
   revision. No ANN index, new provider, default model or automatic indexing is
   introduced.
2. Deny empty selections. Validate every selected version, extraction, notebook
   and active native source membership before evidence identity/hash or vector
   reads. Fetch only scoped canonical evidence IDs and quote hashes to derive
   the ordered manifest hash; never fetch quotes, blocks or whole payloads at
   this boundary. Revalidate scope and returned vector identities.
3. Stage immutable attempt-specific rows. Publication checks canonical ordered
   IDs/hashes, exact complete count, extraction, scope epoch and uncancelled
   attempt identity in one transaction, then changes complete manifest pointers.
   Publication seals the attempt against further batch writes. Every transaction
   uses the actual SDK raw query API and validates all statement acknowledgements;
   unknown outcomes are reconciled, not automatically replayed.
4. Scope revocation increments durable per-notebook/version epochs before any
   physical cleanup. Staging and publication write the same guard records so
   epoch changes are intended to conflict with stale commits. Cleanup deletes
   only rows older than the current epoch; cleanup failure cannot undo revocation
   or sweep a newer generation. Attempt cancellation is separate and preserves
   the last complete compatible index.
5. Native source deletion holds sorted related-project locks through revocation
   and existing file/native cleanup. Notebook cascades stay in their existing
   position and use a private already-locked path: atomically revoke **all**
   retained versions of that source, including unlinked versions in other
   notebooks, without acquiring additional project locks. Database guard/CAS
   predicates, not a skipped invalidation, provide the intended stale-writer
   fence. Unlink and extraction publication revoke under their existing project
   barrier. The production `PersonalStore` exposes real locked invalidation;
   legacy custom/in-memory text stores without it are lexical-only adapters.
6. Retrieve only DB-prefiltered notebook/version/extraction/namespace/committed
   attempt rows. Before payload reads, obtain scoped metadata with actual
   `array::len(vector)` values and reject corrupt dimensions. Legitimate scope
   overflow is a whole-scope size fallback, not truncation. Bound the payload
   projection itself with a dimension-capped slice and numeric-only components,
   return its actual stored length, and reject any drift/mismatch before scoring.
   Thus a preflight-to-payload mutation cannot return an oversized vector or
   silently turn a truncated vector into valid evidence.

## Alternatives considered

- **Reuse classic global embeddings/ANN and filter afterward:** loses canonical
  evidence identity and permits out-of-scope candidates before filtering.
- **Expose staging or publish partial counts:** hides incomplete coverage and
  makes a queue/provider acknowledgement look like a complete index.
- **Use only filesystem locks or only snapshot reads of epochs:** locks require
  a shared root; read-only predicates may permit write skew. Shared DB guard
  writes and canonical predicates are also required.
- **Cancel by revoking the entire version epoch:** unnecessarily invalidates a
  compatible last-good index when cancelling only a rebuild.
- **Reacquire project locks, skip source invalidation, or defer cascade cleanup:**
  respectively risks deadlock, leaves retained epochs unfenced, or changes
  exclusivity/lifecycle behavior outside this increment.

## Consequences and verification limits

- Canonical originals and historical evidence are not rewritten by derived index
  invalidation/cleanup. Feature disablement is non-destructive rollback; the down
  migration removes only the new derived tables.
- Filesystem coordination requires the supported shared data/lock root. Fake
  query tests and a real temporary-root flock regression establish application
  ordering, not distributed lifecycle guarantees across independent roots.
- Migration execution, SurrealQL syntax, atomicity/isolation, cross-process CAS,
  cleanup races and lost acknowledgements still require an explicitly authorized
  isolated database gate. No database/schema execution occurred for this work.
- Hybrid remains disabled by default. Indexing jobs, retrieval orchestration,
  routes/UI, provider quality/cost and browser acceptance are separate gates.

## Query-function evidence

The [official array reference](https://surrealdb.com/docs/reference/query-language/functions/database-functions/array) documents length, map and integer-argument slice functions (only the range overload is marked new in 3.0). The [official type reference](https://surrealdb.com/docs/reference/query-language/functions/database-functions/type) explicitly identifies `type::is::array` and `type::is::number` as the pre-3.0 names. This implementation targets those 2.x spellings, not 3.x range syntax. Documentation inspection is not execution evidence; the composed queries still require the isolated DB gate.
