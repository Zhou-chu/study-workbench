# Python reliability review

Baseline: 49fddcb. Rules reviewed from the saved Sonar `d119643/rule-metadata.json`:
python:S5779, S7497 and S7493. No issue suppressed, closed or excluded.

## S5779: personal turn invariant

The rule describes assertions caught by an enclosing exception handler, primarily
in tests. Here the handler is a production job boundary and deliberately persists
failure, so this is not a silently passing test. However, an unknown engine in a
stored job previously entered the NotebookLM branch, dispatched `ask`, and only
then failed its assertion because no Google turn existed. API validation normally
prevents this, but stored/imported state should fail closed too.

An explicit missing-turn check now raises `InvalidInputError` before the external
call. It is intentionally within the job boundary: the job is persisted as failed,
not left running. Valid independent and NotebookLM flows are unchanged. This works
with Python assertions disabled, too. The new test seeds only an in-memory store,
proves no provider call, no turn record and a stable INVALID_ENGINE message.

## S7497: dispatcher cancellation versus owner cancellation

Normal shutdown deliberately cancels the dispatcher and consumes its cancellation;
unconditionally re-raising would break normal shutdown. But the original handler
also swallowed cancellation of the lifespan owner while it awaited dispatcher
cleanup. A deterministic event-gated test reproduces that error.

The handler now re-raises if the current owner task has a pending cancellation.
The expected child-only cancellation remains consumed. Tests cover normal exit,
owner cancellation during child cleanup, and cancellation inside the lifespan body.
Startup migrations and device auth are mocked: no actual startup side effects run.

## S7493: cancellation-safe file operations

The synchronous file operations genuinely blocked the event loop. A new private
file owner now keeps the handle across serial worker operations; directory/open,
write, flush/fsync/close, existing-content comparison/rename, and cleanup all run
outside the event-loop thread. Streaming remains bounded to 64 KiB chunks rather
than buffering the entire response. Network requests and authentication rules are
unchanged.

Each disk operation has exactly one owned task. The waiter shields it and drains
it before propagating cancellation, including repeated cancellation. A completed
open is retained by the file owner even if its waiter was cancelled, so cleanup
can close it. A cancelled write completes before close/unlink. Worker errors are
retrieved; cancellation takes precedence if both occur. There are no detached
background operations. Finally cleanup is itself drained before the task exits.

Rename remains the commit point: cancellation during a completed commit can leave
a fully validated final asset, never a partial target. Existing identical content
is reused; conflicting content is not replaced. Existing application-generated
identity assumptions are preserved, not promoted into a new cross-process locking
guarantee. A permanently stalled filesystem syscall can delay cancellation: Python
threads cannot safely kill an in-flight syscall. The event loop remains responsive.

Tests first reproduced three failures on the old synchronous write (thread identity
and blocked-write scenarios). They now exercise off-loop blocked writes, single and
repeated cancellation, cancelled open/flush/cleanup, close/unlink ordering, disk
errors, byte-identical reuse/conflict, cancellation at commit, cancellation during
network streaming, missing Content-Length bounds, and 401/403 with no retry or
credential fallback. Files are temporary; HTTP uses MockTransport only.

## Verification to date

Before the two implemented changes: 2 tests failed for the intended reasons
(unknown engine reached ask; parent cancellation did not raise), 12 passed.
After the changes and additional body-cancellation regression, six targeted suites
passed: **50 passed, 1 warning, 5.14s**. The warning is the existing third-party
surreal_commands Pydantic class-config deprecation.

Suites: test_lifespan_cancellation, test_startup_migration_retry,
test_v1_personal_service, test_v1_personal_dispatch_receipt,
test_v1_personal_enqueue_reconciliation, test_v1_notebooklm_download.

No full-suite run or fresh Sonar scan of these changes has occurred. No production
database, encryption configuration or real provider was touched.

## SDK follow-up verification

The initial SDK-focused rerun passed **21 tests in 0.51s**, with no warnings.
This includes 18 new lifecycle cases plus the three existing download cases.
Ruff check and formatting passed on the SDK and new test file. Broader SDK regression
completed: **62 passed, 1 existing dependency warning, 3.27s**, covering lifecycle,
download, SDK, chat, sources and commands suites. Full-suite and new Sonar analysis
remain pending.
