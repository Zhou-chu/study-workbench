# Bounded V1 security/reliability review

2026-10-18 UTC. This is a focused code/regression review, not a certification, full penetration test, or production authorization.

The first independent pass identified seven concrete issues. Each was reproduced and fixed, then independently checked against the final code with 14 focused passing regressions:

1. Missing application password could leave legacy source/note endpoints open: default-on private mode now protects all `/api/*` data paths, not only V1 paths
2. Late worker completion could erase the durable command ID: completion merges the latest job under the project lock
3. A cancelled queued extraction could still run: early terminal/cancellation checks prevent execution
4. Saving unmapped remote references discarded titles/quotes: note snapshots preserve remote metadata with unverified status
5. Generic outline prompts had no lexical hits: explicit bounded outline mode samples selected-source evidence and reports coverage limits
6. Stale note snapshots hid canonical upstream edits: native note content now wins, while reference metadata is retained
7. Historical evidence could only read the newest extraction: reader API accepts bound evidence/extraction identity; frontend forwards and persists it

Additional review fixes:

- Imported original MIME types are constrained to safe source types; protected downloads enforce MIME again
- Artifacts accept only fixed audio/binary types and safe disposition
- Manifest null/list/scalar types are rejected as typed client errors
- Imported physical page, printed label and bbox must match the retained extraction block and valid page bounds
- Citation text/offset/hash/scope claims are validated, and restored verification claims are downgraded because archive consistency is not proof of trusted authorship
- Every restored extraction/evidence gets a server-overwritten `restored_archive` marker; forged provenance, repeated exports/restores, note editing, search and fake-model finalization cannot launder it into verified status. A fresh extraction creates new evidence IDs without upgrading archived history
- Targeted HTTP coverage found a real upload idempotency defect: request hashing now includes normalized MIME and filename, so parser-changing retries conflict instead of returning an old version
- Restored subquote citations now validate Unicode codepoint ranges against canonical evidence, retain physical-page navigation/highlighting and remain unverified; exact whole-quote equality is no longer required
- Restored remote jobs are historical and cannot be replayed
- Exact file identity is required for source mapping; a matching filename is not sufficient
- Failed Google authentication does not clear the separate local application login
- Parser regressions cover final LF/CRLF and Unicode offsets after an actual native restore test exposed a final-paragraph omission

Remaining trust/acceptance limits are in `ACCEPTANCE.md`: no live Google/model verification, no external HTTPS penetration test, no independent revalidation of archive-supplied extraction claims, and no multi-host lock design. The later restored-unverified UI locator adjustment has its own frontend regressions; it was outside the independent review's bounded final pass.
