# ADR-019: Durable source submission ownership

Status: accepted (code; migration not applied to any existing runtime)

## Decision

Migration 30 adds optional structured `source.processing_attempt` with a unique
submission token, per-execution owner UUID, ownership phase, and optional actual
queue command reference.
A new source stores its pending attempt and original text/upload asset before
submission. Explicit retries atomically compare the observed token and command
and inspect the linked command's actual terminal status in the same update.
Only an owner-confirmed failed execution AND a failed/canceled/cancelled command
permit replacing an existing attempt;
pending no-ID attempts cannot be reclaimed. Legacy sources without an attempt
or command can be claimed once.

`pending`, `confirmed`, and `running` describe submission binding/worker ownership,
not terminal task status. Owner-only `succeeded`/`failed` phases separately record
positive pipeline termination; shared SDK command status cannot provide that proof. ACK writes are token-conditional and field-only, preserve
worker-advanced phase/content, and cannot replace a newer owner. Ordinary existing
Source saves omit operational ownership fields. Portable export/import sanitization
drops attempts as well as command references.

Before graph/provider work, a worker atomically acquires the matching attempt once,
binding its actual execution-context command and a newly generated execution UUID. Stale/duplicate workers raise a
permanent error, never a success-shaped result. Legacy no-token jobs are accepted
only when not superseded by an attempt or another command. **One pipeline execution
per attempt** is deliberate: an SDK retry after acquisition is rejected permanently;
a later explicit retry requires that same owner to record `failed`, plus the command
actually being failed/cancelled. A duplicate worker can independently mark the shared
SDK command failed while its winner still runs; it cannot finalize the owner. A
successful owner remains nonretryable even if a duplicate corrupts command status.
This trades automatic transient recovery for protection against repeated providers,
extraction, and downstream submissions whose side effects may be uncertain.

Read/reconcile can bind only a unique actual command matching app, name, source ID,
and submission token. Zero or multiple matches leave the attempt unresolved; absence
is not proof of nonacceptance. Reconciliation never enqueues. Lost/malformed DB
acknowledgements fail closed. Submission, cancellation, and post-ACK association
failures retain source and input; operators must not treat these as safe replay.

## Execution completion and operational recovery gap

The installed LangGraph async executor cancels and awaits its node tasks before
`ainvoke` exits. Drain alone is insufficient: LangGraph may surface one ordinary
exception while hiding a cancelled sibling's unknown submission. A mutable
per-execution ContextVar object is inherited by graph task contexts; every source
node latches cancellation or unknown submission independently of state merging.
Ordinary failure is released only after positive drain, a clear uncertainty latch,
and only by the acknowledged execution UUID. Any cancelled sibling conservatively
blocks release even when its effect may in fact have been harmless. Cancellation, worker crash, unknown downstream
submission, lost claim acknowledgment, and uncertain completion retain unresolved
ownership. An execution that did not receive its own successful claim receipt must
never finalize an owner inferred from submission token + command ID. There is no
lease timeout, blind retry, or automatic operator override. Legacy command-linked
records without owner completion evidence are likewise not safe to retry solely
because the SDK says failed. This intentionally leaves an operational recovery gap:
manual evidence/reconciliation beyond binding a queue command is not implemented.

Source extraction publishes fields with a token + execution UUID + running-phase
CAS; an old owner cannot publish after a newer claim. Provider/insight/embedding
entrypoints check current ownership; retry cannot race these checks while the owner
is active. Queued owned processing retains original uploads even when the old
`delete_source` flag was set, rather than deleting inputs before an uncertain
completion or downstream submission. User-directed deletion remains separate.

## Boundaries and validation

Initial source creation before its database acknowledgment remains an existing
separate boundary. No arbitrary command ID is fabricated, and no background replay,
lease expiry, destructive cleanup, or new-request bypass is introduced. Migration
application to a live database remains a separately authorized deployment action.

Offline tests cover response ambiguity, cancellation, worker refusal before graph
work, original input retention, fast-worker response content, and portable stripping.
Opt-in `tests/test_source_attempt_repository_db.py` validates migration up/down,
concurrent claim/worker races, late ACK, actual terminal states, unique read recovery,
and ordinary stale saves against an owned memory-only SurrealDB 2.3.10 process.

Acceptance includes actual installed SDK duplicate executions with mocked I/O and
owned in-memory DB owner-completion races. The separate fresh full-chain composite
gate runs all registered migrations before source/embedding/note checks; neither
this nor the targeted schema fixtures claims arbitrary existing-database upgrade
safety.

### Owner-aware public status

List, detail and status reads project the same owner evidence. A running owner with a shared failed/completed/cancelled SDK record is `unknown`, not retryable. A positively finalized succeeded owner is `completed` even if a duplicate changes the SDK record to failed. Only owner-failed plus an actual failed/cancelled command exposes terminal failure. Legacy command-linked terminal state without owner evidence is unknown; legacy sources without commands retain their existing behavior. Conflicting SDK error/result metadata is suppressed. A lost successful-finalization receipt therefore reads completed if the durable success write committed, or unknown if it did not; neither permits retry. This changes no response schema.
