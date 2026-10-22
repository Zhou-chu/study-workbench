# ADR-020: Native fixture UI state is owned outside navigation

- Date: 2026-10-22
- Status: Accepted for the offline source slice, not connected-client acceptance

## Context

The reviewed mobile core requires exact in-memory save-attempt object identity.
Screen-local draft state is lost on back/dismiss; rebuilding a responsive tree can
also restart operations. Serializing or deep-cloning pending attempts breaks
completion ownership. Queued fixtures must not masquerade as generated material.

## Decision

`clients/mobile/src/session/FixtureSession.ts` owns drafts by note ID and one outline
operation per notebook for one demo lifetime. React subscribes to shallow immutable
snapshots. Save callbacks capture the exact object returned by `beginSave`, the
repository and the epoch; they never reconstruct or serialize the ticket. Reset
increments the epoch, invalidates reads and replaces the repository. Read failures
are retryable; uncertain writes/submissions are not. Clean/saved drafts do not
cause additional writes. The bounded fixture offers no conflict merge, unresolved
write reconciliation or second generation action.

React Navigation native-stack owns only screen paths. The session is created once
above it. An >=840 logical-unit sidebar changes presentation, not state lifetime;
large font scaling falls back to full-width controls when width/fontScale<600.
The navigator's stable keyed main region survives sidebar insertion/removal.
Only explicit confirmed reset replaces navigation through the epoch key.

The workspace preserves the server fixture's empty sources and opaque history.
A selectable public-text screen is expressly separate from source-version content.
History is read-only, and queue receipts have no output/replay action. Settings and
reset are separate from everyday reading and writing. No WebView is used.

## Consequences and alternatives

This provides testable navigation-independent ownership without introducing a
persistent store or custom native navigation implementation. It deliberately does
not survive process death: all draft/save/queue copy says demo/reset-on-restart.
A future protected persistent draft/transport layer must design its own durable
ownership token and reconciliation; it must not serialize current capabilities or
weaken identity comparison. Native-stack peers add genuine platform dependencies
whose builds and accessibility behavior remain independent acceptance gates.

Vendor RN0.87 guidance requires skipLibCheck for generated declaration migration;
application source stays strict and the unchanged domain config remains isolated.
The JS component suite mocks native host modules and cannot replace device tests.
