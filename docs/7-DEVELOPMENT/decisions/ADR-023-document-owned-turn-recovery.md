# ADR-023: Bounded document-owned Ask/Outline identity and explicit recovery

- **Status**: Implemented; integrated independent review/build gate pending
- **Date**: 2026-10-26
- **Related**: [F1 boundary design](../../v1/NEXT_BOUNDARY_DESIGN_2026-10-24.md), [dispatch receipt](ADR-022-personal-turn-dispatch-receipt.md), [implementation plan](../../superpowers/plans/2026-10-26-frontend-turn-ownership.md)

## Context

A component-local mutation cannot retain an uncertain POST identity across a route
remount. A new key can duplicate work, and generic job GET can dispatch a Google
child. Failure, cancellation, `not_submitted`, missing records and unknown states
cannot prove the original request did not execute. A successful old outline must
not replace a newer editor, nor may an old question ACK clear an edited draft.

## Decision

Keep one immutable capture per notebook in the existing root provider, inside
I18nProvider and outside ConnectionGuard. Claim admission synchronously before
async work. Retain the exact emitted DTO, original session/key/target and mount /
question / editor generations. Do not put payloads or raw errors in mutation
variables, global singletons or persistence. Use the shared guarded API client.

The fixed bounds are **8 unresolved notebook slots** and **1,048,576 UTF-8 bytes**
of emitted request JSON summed over retained captures. Reject before dispatch
when either bound is exceeded. Do not evict unresolved captures, including a
completed capture whose consumer has not yet released it. This bounds retained
request serialization, not total JavaScript memory or network buffers.

Use a small feature hook and recovery panel, not a general operation runtime.
Explicit checks reserve the registry latch before creating an attempt/context-
tagged TanStack Query read. Fresh keys and zero stale time prohibit cached
completion proof; no observer enables focus/reconnect refetch. Read only the
captured notebook workspace and canonical session history. Poll acknowledged
known-active work every two seconds while a consumer is mounted; inconclusive
reads require an explicit Check. Each raw failure is immediately reduced to safe
metadata. An HTTP 400 uncertainty receipt is not acceptance of a question draft.

Known receipt or proven live parent means **check only**, even if canonical
history is missing or failed to read. Without one, only an explicit warned POST
reuses the same session, key, body and target. It can submit work if the original
record does not exist; it is not a read or worker restart. No auth/focus/online/
remount/timer action submits. Only a first, branded locally-not-dispatched attempt
with no possible earlier dispatch can be abandoned. Otherwise only matched,
confirmed parent/result/canonical answer evidence releases the fence.

The current observed Google link must match the captured remote notebook and any
previously known connection label before replay. If A changes to B or becomes
unavailable, replay is blocked; restoring A may re-enable only the explicit
button, never submit automatically. An absent legacy label is not an absent
link. The literal provider label `notebooklm` **does not prove account continuity**.

Pass the fence into the real JobsPanel, including its CSS-hidden Studio view.
Associated parent/same-key child/uncertain chat-or-ask cards use workspace props,
not cached generic-job data; they disable generic queries and intervals. Explicit
cancellation refreshes workspace, never generic job GET, and cannot release the
fence. Known unrelated jobs keep their prior polling and cancellation behavior.

Transient accepted/completed results carry tokens. Ask clears only the original
mount's unchanged question generation; changing away and back is a new generation.
Outline never owns the question and applies only to the original editor session
and revision. Application preserves citations/scope, increments the editor session,
clears its save base and review, and cannot attach an earlier note-save ACK to the
new outline. Other-mount completion is released without editor effects; answers
remain available in history and explicit Save Answer retains its existing behavior.

## Consequences and limitations

Conservative unresolved requests can remain fenced indefinitely and consume a
slot. Failure/cancellation labels do not supply an operator recovery proof. This
change does not add reliable dispatch, backend replay, exactly-once guarantees,
a new endpoint, model-default changes or provider reconciliation.

Explicit privacy/target invalidation clears retained local capture references and
quarantines late results. Ordinary same-target auth/readiness recovery does not
forget the request. Reload, crash, tab close, root-provider replacement and
sign-out lose this document-only recovery; losing local identity does not stop
remote work. Reference release is not secure erasure and does not recall transport
bytes already dispatched. There is no storage, cross-tab journal or TTL eviction.

English/Chinese shared workbench locale shapes cover all 14 configured locales.
Offline hook/component/core tests establish these local contracts only. Independent
review and the separate frozen-source build/artifact gate remain required; browser,
service, DB, worker and provider runtime acceptance remain blocked/not run.
