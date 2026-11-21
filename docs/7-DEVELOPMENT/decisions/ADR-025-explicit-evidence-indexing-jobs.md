# ADR-025: Explicit evidence indexing reuses durable personal jobs

- **Status**: Accepted for source; isolated DB/provider/runtime gates pending
- **Date**: 2026-11-02
- **Related**: [design](../../superpowers/specs/2026-11-02-workbench-hybrid-retrieval-design.md), [ADR-024](ADR-024-scoped-evidence-vector-publication.md)

## Context

Document embeddings disclose content and may incur duplicate cost. Preview and
polling cannot embed. Unknown queue/provider/DB outcomes cannot authorize replay,
and cancellation must preserve compatible last-good manifests and historical jobs.

## Decision

Reuse `v1_job`, shared project barriers, the existing complete pre/post-COMMIT ACK
validator and surreal-commands. No queue, table, migration or dependency is added.
Metadata-only `index_evidence_preview` records capture consent; nonexecutable
`index_evidence_group` parents retain immutable same-key submission receipts.
One atomic acknowledged transaction admits the parent and every intended child
before any queue call. Missing/unknown child records remain visible and are never
filled or dispatched by duplicate/status requests. Revision CAS establishes queue
ownership. Only `index_evidence` children execute, with durable job ID as their
only worker argument and `max_attempts: 1`.

Admission and dispatch control transactions reuse the repository's full canonical
scope/epoch predicates under the existing shared project barrier. Provider markers
also fence the registered per-version attempt; no project lock spans a provider
call. Preview hashes bind ordered evidence hashes, extraction/epoch, exact profile
fingerprint, destination-descriptor version and actual prefixed UTF-8 bytes/counts.
Queued workers revalidate captured consent/configuration, never UI/default state.

Interrupted attempts become unknown, never resume batches. An explicit retry must
reference a failed/unknown/cancelled same-notebook/version/profile child, use a new
key/current preview, acknowledge duplicate cost and durably fence the old attempt
before new admission. It rebuilds the whole version under a new ID. Cancellation
is attempt-local: no epoch increment, manifest removal or remote-cancellation
claim. An unknown fence remains unknown. Reconciliation never queues/embeds and
can prove success only from that attempt's complete compatible manifest.

Existing job routes resolve a store-only NotebookLM service; its bridge now
materializes on first `bridge` access, preserving injection/assignment. Exact
local index branches therefore never construct/access the legacy adapter.

## Alternatives considered

- Separate queue/table: unnecessary competing lifecycle/idempotency infrastructure.
- Unchecked `PersonalStore.put`, partial admission or retry-on-unknown: inadequate
  dispatch ownership/ACK evidence and possible duplicate paid processing.
- Cross-attempt batch resume: unverified partial-provider/commit outcomes; explicit
  whole-version retries make duplicate work/cost honest instead.

## Consequences

`IndexReceipt` adds required `group_id` and typed `jobs` alongside `job_ids`, with
per-version state/stage/progress/sanitized error. Immutable submission receipts and
live group reconciliation are separate; partial selection cannot report success.
No quotes/vectors/query text/raw diagnostics enter jobs or queue arguments.
Offline fake-RPC/provider tests prove contracts, not actual SQL/isolation/durability
or model quality. Feature remains disabled by default; no profile is installed.
Semantic query/Ask/UI integration and runtime acceptance are separate gates.
