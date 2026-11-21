# ADR-022: Add personal turn dispatch ACK uncertainty evidence without replay

- **Status**: Accepted
- **Date**: 2026-10-26
- **Related**: [F1 boundary design](../../v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md), [implementation plan](../../superpowers/plans/2026-10-26-dispatch-uncertainty-receipt.md)

## Context

The personal turn enqueue call can raise after the queue accepted a command.
An unchanged queued parent then retains the existing `failed`,
`WORKER_UNAVAILABLE`, `not_submitted`, zero-attempt policy. Those labels cannot
prove queue rejection or authorize a new operation key. More advanced worker or
cancellation metadata must survive reconciliation; deleted jobs must stay deleted.

## Decision

Only after the existing locked reread establishes that the latest job equals the
original queued parent, add an exact receipt alongside its existing failure update:
`{"dispatch_ack":"unknown","job_id":<original parent ID>,"turn_id":<original turn ID>,"retry_safe":false}`.
Keep all states, error code/message, attempts, locking, write order and worker
replay rules unchanged. Raise a dedicated `InvalidInputError` subtype with the two
allocated IDs and fixed `WORKER_UNAVAILABLE` string, chained from the queue error.
If persistence raises, keep that failure propagation: the receipt may or may not
be stored, and no dedicated durable-receipt response is asserted.

The registered handler explicitly emits only fixed public literals and the two
allocated IDs. HTTP 400 and its existing detail string stay compatible; an
optional sibling carries the receipt. Arbitrary exception attributes, stored
objects, request snapshots and underlying queue causes are not serialized.
Same-key/body POST still returns the existing job without enqueueing; its success
projection includes a stored receipt by key membership, including false/null.

Separate **strict generation** from **permissive retained-data reads**. Known
HTTP 400 receipt/error-envelope models forbid extensions and describe the
generated literals. The success response field remains opaque `Any`, serialized
with `exclude_unset`, so previously readable historical JSON of any type remains
readable. Unknown, malformed or absent evidence, conflicting IDs and even a
retained `retry_safe:true` never authorize backend actions. Workspace/turn history
retain metadata; portable restore uses existing nested ID remapping and marks jobs
historical with replay disabled. A restored receipt is not live execution authority.

## Alternatives considered

- Replace `detail` with a structured object: rejected to preserve string consumers.
- Apply the generated receipt DTO to all reads: rejected because it would tighten
  historical compatibility or discard future evidence.
- Infer rejection from failed/not_submitted, or add retries/outbox/reliable queue
  recovery: rejected as an unsupported inference and a different delivery design.

## Consequences and limits

Clients can recognize explicit dispatch ACK uncertainty without a new endpoint.
They must distinguish retained opaque data from a recognized live receipt and
keep legacy absence inconclusive. This is not provider-submission reconciliation,
exactly-once execution, frontend recovery or permission to repeat work. Generic
job GET remains dispatch-capable; this change does not make it a read-only check.
The offline synthetic tests establish serialization, race preservation and
non-replay behavior, not database, worker, provider, browser or deployment acceptance.
