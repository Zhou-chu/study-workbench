# ADR-015: Opt-in strict device-session backend

Status: accepted for gated implementation; runtime activation blocked on Web/ingress acceptance.

## Decision

`STUDY_WORKBENCH_AUTH_MODE` defaults to `legacy_password`. The only other accepted
value is `device_sessions`; unknown values fail closed. Device mode has one
startup-created service/boot epoch and one strict password provider, not a
fallback password Bearer. One API process is mandatory. Migration 28 supplies
digest-only auth tables outside personal archive kinds. Migration itself does
not activate sessions. API restart invalidates all prior sessions.

All successful mutations touch one preexisting guard record in the same
SurrealDB transaction. This prevents snapshot write skew across cap checks,
create, rotation and revoke-all. Guard absence fails closed. Read/CAS failure
cannot insert access rows. Raw SDK result envelopes are checked because the
SDK convenience query method returns only the first statement result. Any
transaction conflict, missing/malformed acknowledgement or lost response is
unavailable; never retry internally. A later explicit login is recovery.

The service observes credential content and outage barriers on every auth
operation. Legacy PersonalSecurityMiddleware must not independently read the
password in device mode, or a file outage could escape epoch invalidation.

## HTTP boundary

Exact protocol routes are `/api/auth/status`, `/api/auth/sessions`,
`/api/auth/sessions/refresh`, and DELETE `/api/auth/sessions/{session_id}`.
JSON auth bodies are capped at 8192 bytes before parsing, including chunked
bodies. Errors are sanitized and no-store. UTC dates use `Z`. Only explicit
Bearer credentials authorize API resources. App cookies and conflicting
issuance Authorization headers are rejected, not consumed.

`STUDY_WORKBENCH_AUTH_ORIGINS` is a comma-separated exact scheme/host/port
allowlist. No wildcard, request Host trust or trailing-slash normalization.
Empty means reject every supplied Origin; absent Origin is allowed for
explicit native transport. BFF must remove browser Cookie and enforce its own
Origin/custom-header CSRF boundary. The HTTP boundary deliberately uses one `shared-peer` failed-login bucket
(five failures/minute shared by all Web/native callers; global30 remains an
upper bound). ASGI client may already be proxy-rewritten, so neither it nor
X-Forwarded-For/X-Real-IP is treated as trusted identity. Trusted per-peer
attribution is deferred; no launch configuration changes are required.

## Consequences and limits

Access overlaps for its original 15-minute TTL, subject to authoritative
revocation/epochs. Refresh is one-use, maximum absolute 30 days. Lost response
requires relogin; duplicate rejection does not revoke the winner. This does not
detect theft when an attacker wins first. Revocation cannot undo already
authorized writes or end existing streams. Session rows are retained; expired
access rows are pruned before issuance. Operational retention can be a later
bounded maintenance task, never part of archive export/import.

Native Surreal 2.3.10 synthetic tests cover real contention, rollback, cap and
lost ACK; HTTP tests cover local controlled headers only. No real ingress,
browser cookie/CSRF/draft coordination or runtime activation claim is made.

## Readiness correction: schema integrity

Migration version and guard presence alone are insufficient: Surreal can
implicitly recreate a missing table as SCHEMALESS. Before **every** adapter
operation, uncached `INFO` metadata on the same connection must exactly match
the migration28 auth table definitions, field types/VALUE/permission clauses,
and index columns/UNIQUE semantics. Missing or incompatible schema is
unavailable before any mutation; startup fails, status/issuance return503.
Extra/altered auth fields, events or indexes also fail closed. Normal migrations
are supported; changing the auth schema requires an explicit migration/adapter
update. The canonical metadata representation is verified on Surreal2.3.10;
this is intentionally conservative, not a claim of cross-version compatibility.

`INFO` cannot be a conditional subquery in Surreal2.3.10, so metadata validation
precedes the mutation transaction rather than occurring inside it. Concurrent
administrative DDL, like live database restore, is **unsupported**: stop the API
before changing/restoring schema, then restart. This closes observed preexisting
schema corruption, not an atomic defense against an administrator racing DDL.
It adds one metadata query per adapter operation; no performance claim is made.

Device-mode auth-only unknown-route/wrong-method errors retain404/405 (and Allow
for405) but use the sanitized `AUTH_INVALID_REQUEST` envelope. Unrelated resource
404/405 errors are unchanged.
