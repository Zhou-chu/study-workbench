# SDK cancellation review (5bfa1dc)

Issue a9712917-411e-4c97-a3cb-c4debefd3c7c, python:S7497, sdk_adapter.py:516. Verdict: evidenced false-positive candidate at this catch; NOT transitioned or suppressed.

## Complete helper control flow

`_asset_file_operation` creates one owned task for `asyncio.to_thread`. `shield` prevents caller cancellation from cancelling that owned task. Each caught CancelledError is saved in `cancellation`; repeated cancellation overwrites it with another CancelledError, never None. The loop drains until work is done; worker Exception breaks the loop only after shield observes completion. After any caught cancellation, the helper retrieves the completed worker exception (avoiding an unobserved failure) then unconditionally raises the saved cancellation. If the worker itself is cancelled, exception retrieval is skipped but cancellation is still raised. Without cancellation, result() returns the value or raises the worker error. There is no return path after a caught cancellation. Re-raising immediately inside the handler would allow disk writes to race finally cleanup, reintroducing the defect.

The downloader awaits this helper serially for open/write/finish/commit, and in finally for cleanup. Network cancellation also enters that finally. Cancellation during completed commit can leave a complete final asset, explicitly documented; never a partial final file.

## Existing 18 lifecycle cases independently reread and rerun

- blocked write: no cancel / one / repeated cancel (3), off-event-loop work, drain-before-cleanup, all handles closed;
- cancellation in open / finish / cleanup (3), repeated cancel and owned-handle cleanup;
- commit absent / same bytes / conflicting bytes (3), identity preservation;
- disk failures open / write / finish / commit (4), propagate and no partial orphan;
- unauthenticated 401 / 403 (2), no retry or credentials fallback;
- streamed size limit (1), partial cleanup;
- cancellation during network stream (1), response and file closed;
- cancellation at commit (1), only complete valid asset remains.

Additional `tests/test_asset_operation_cancellation_review.py`: four direct helper cases combine one/three cancellations with successful/failing disk worker. Assert waiter remains pending while disk work is held, worker actually finishes, await raises CancelledError and task.cancelled() is true even when disk worker raises OSError. These target the alleged swallowed cancellation directly.

Result: 22 passed in 0.48s under isolated HOME/data and Python network guard, no live service/API used. Node inventory compatibility tests: 9 passed.

## Limits and separate risks

An indefinitely blocked filesystem syscall deliberately delays cancellation; Python cannot safely kill that thread. This is not cancellation swallowing. A separate cleanup I/O exception can mask an already propagating exception under ordinary Python finally semantics; existing tests do not claim protection from arbitrary cleanup failure. Neither limitation makes this specific saved-and-raised cancellation handler an S7497 violation. No rule/profile/source suppression or issue status change was made. SDK production code is unchanged.
