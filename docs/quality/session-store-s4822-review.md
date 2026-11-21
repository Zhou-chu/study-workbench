# S4822 session-store review

Baseline: 006831f0c6ce0c4465eb1709f70507b984795fb9. No Sonar disposition changed.

Issues a008c910-5ce3-4d6a-a5ea-a2fae8adae83 (apps/bff/src/session-store.ts)
and 56ad7541-fc54-45a0-b007-e13bcaa8a1df (frontend/src/lib/api/bff-session-store.ts)
point to the synchronous invocation boundary in #call.

The try/catch intentionally captures a synchronous adapter throw, converting it to
a rejected Promise. It does not purport to catch asynchronous rejection. The same
turn attaches raw.then(success, error); the second handler handles native Promise
rejection, including a later rejection after timeout. Both settlement paths call
done in finally, releasing physical capacity only after the native call settles.
The deadline can resolve the caller earlier without releasing a still-live call.

Do not replace this with await: #call must synchronously return its stop handle.
Do not defer invoke with Promise.resolve().then: native invocation timing and
admission/stop ownership would change. Adding void cannot fix rejection handling.

Existing tests cover synchronous NativeCallError, asynchronous create/refresh
rejection, timed-out hung owners and later physical lease release. Both existing session-store suites were rerun unchanged in the isolated baseline
and after the unrelated parser lambda change: 43 tests per implementation passed.
No new session behavior or disposition was introduced. These are focused checks,
not a full application suite or universal exception-safety proof.

The derived Promise returned by then can reject if internal failure/done callbacks
throw. Current release/settled callbacks operate on owned Sets/counters; failure
callbacks return typed outcomes (login cancellation also uses the trusted clock).
This is not a guarantee against a throwing injected clock, Proxy-like hostile native
objects, OOM or future callback changes. Do not conflate the specific native Promise
handling finding with universal exception safety. Such a counterexample requires a
separate contract and regression, not silent swallowing or a blanket FP claim.

Recommendation: independent review of this exact chain and passing regression
evidence before any false-positive disposition; leave issue status unchanged now.
