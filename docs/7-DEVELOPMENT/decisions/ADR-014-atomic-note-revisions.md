# ADR-014: Atomic editorial note revisions

Status: accepted for implementation; 2026-10-21. Multiclient enforcement is not activated by this ADR.

## Decision

Native note.revision is the strict positive-integer editorial authority. Native content and personal snapshot content/citations/scope/revision commit together in one bounded SurrealDB transaction. Legacy PUT applies only supplied fields; domain saves validate before persistence and preserve fields omitted by projected reads. Embedding-only updates do not change editorial revision.

Supplied expected_revision is always enforced. Default legacy_single_web compatibility accepts omission; explicit multiclient mode requires it (428). Stale writes return 409 with a typed detail object and current revision, after verifying membership. No automatic write retry or silent conflict merge is introduced.

## Concurrency boundary

Local lock order is note-mutation barrier, then sorted project locks, then a database transaction. Read/export helpers do not reacquire held locks. Database compare-and-set protects independent data-root writers. Real SurrealDB 2.3.10 tests showed parent existence reads alone permit write skew against deletion; stable internal note_write_guard records make membership mutations and deletion conflict on writes. Guard records contain no note content and are retained as tombstones, excluded from portable archives. Do not prune them without a separately reviewed quiescent protocol.

SurrealDB 2.3.10 TYPE int coerces integral floats. The migration therefore uses TYPE any with an explicit strict integer/positive assertion, alongside API/model/archive strict validation.

## Consequences

Lost commit acknowledgement is unknown outcome, not proof of rollback. Clients must reconcile rather than replay blindly. Parent deletion and creation races may reject either participant, but cannot leave an orphan or resurrect deleted data. Full unrelated source/chat cascade is not newly transactional. Valid archive revision N survives restoration under new identities; contradictory or malformed revisions are rejected. Legacy absent revisions read as 1.

The server capability distinguishes conditional-write support from required enforcement. Both Web editors must retain drafts and send captured predecessor revisions before activating multiclient mode. Auth/session changes are separate. Native clients, Sites and Docker runtime remain independent acceptance gates.

## Evidence

Reviewed backend source dc96f38; 77 isolated native-note/portable checks passed. Integrated foundations plus backend: 1499 passed, 19 gated skips, two existing deprecation warnings. The gated database cases were exercised separately; a skipped aggregate case is not counted as an aggregate pass. Review caught and fixed projected-note body erasure and post-commit domain validation.

## Archive-version correction

A targeted compatibility check found that old format-1 readers accept newly versioned notes but drop the native revision while retaining the snapshot revision. A subsequent migration backfills native revision 1 and correctly exposes an inconsistency. Therefore new exports use **format 2**; current readers accept exact-integer formats **1 and 2**, preserving strict revision checks and all ZIP/hash limits. Existing archives are not rewritten.

Cost: old applications intentionally refuse new backups until upgraded, rather than appearing to restore them successfully while losing revision state. Historical rejection is verified against the frozen old gate, not claimed as a full old-runtime test. Native current-runtime proof covers format 2 → revision 7 restore → revision 8 save.
