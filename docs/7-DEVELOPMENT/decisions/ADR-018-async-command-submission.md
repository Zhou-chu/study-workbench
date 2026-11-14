# ADR-018: Bounded native async queue submission

- **Status**: Accepted
- **Date**: 2026-10

## Context

The public `surreal-commands` 1.3.1 submission client performs synchronous database work, blocking async API/domain/worker entrypoints. Its native async service exists but serializes schema output with `model_dump()` rather than the sync client's `model_dump(mode="json")`; dates/enums can therefore change wire representation.

## Decision

Use an application-owned async adapter preserving the locked sync client's request validation, JSON-mode schema serialization, command payload, context, and unmodified returned record ID. It uses the SDK service's existing connection configuration and a fresh `AsyncSurreal` connection, without changing global SDK state. Limit admission to eight submissions per event loop with a ten-second admission deadline, thirty-second database-operation deadline and separate five-second cooperative cleanup deadline. No executor or orphan task owns unfinished submissions.

Pre-CREATE failures keep their exception types. Once CREATE starts, failures become `CommandSubmissionUnknownError` with the original cause. Cancellation propagates and never asserts rollback. Neither path automatically replays a possibly committed command. Source domain wrappers preserve the unknown exception; affected source/transformation/insight worker retry predicates stop on it. Portable exports preserve their existing job/idempotency identity for status reconciliation and late worker completion.

## Alternatives considered

- Calling the native SDK service directly changes JSON serialization semantics.
- Bounded thread offload preserves payloads, but the installed sync websocket SDK has no receive timeout. One hung call can retain capacity and delay executor shutdown indefinitely.
- Timing out a thread and releasing its slot is not safe cancellation and could grow unbounded work.

## Consequences

All formerly synchronous submission paths in async API services, source/note domain methods, transformation enqueueing, insight creation and embedding rebuilds now await this adapter. `Note.submit_embedding` is async; all in-tree callers await it. The already-native personal and NotebookLM queue callers remain unchanged. Limits are loop-local, not distributed/global worker limits. Deadlines depend on SDK cancellation cooperation; they do not roll back remotely committed work. There is no submission transaction/outbox: existing known-failure retries after an insight record was created may still duplicate insight records. This change prevents unknown-submission replay, not general workflow idempotency. Recheck payload parity and cancellation behavior when upgrading either locked SDK.
