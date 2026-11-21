# Controller rulings for Notebook SPA implementation

Source: approved 2026-11-07 design and plans, checked on 2026-11-08 against the actual deployed 91a92fa plus Cookie compatibility patch.

Ruling F1: Freeze the recovery-specific allowlisted projections and operation-specific receipt semantics in PREFLIGHT_REVIEW.md before A1. The minimal OperationReceipt is only a generic handle. Unknown/invalid original receipt or request shapes must remain safely non-actionable after projection, never become valid by stripping fields. Cost if wrong: unsafe replay or false completion.

Ruling F2: A1 explicitly owns the existing turn and note write DTO exports consumed by B5/B7, with compile and wire regression tests. Read-only NoteView is not a write receipt. Cost if wrong: incompatible clients or lost revision/identity semantics.

Ruling F3: A2 owns RuntimeConfig in packages/contracts, its index exports and tests, and explicitly stages these files. Cost if wrong: broken shared contracts/build.

Ruling F4: Execute B1 after A4, not concurrently after A1, because its test harness consumes the real WebTransport. No fake temporary transport API. Cost: reduced parallelism only.

Ruling F5: A4 owns browser-visible ingress response classification and the transport error surface. A3 only classifies its actual BFF hop. A redirect:error network rejection does not reveal status/Location or prove authentication loss. Preserve drafts and mutation identity, do not automatically log out or replay. Cost if wrong: misleading recovery and duplicated side effects.

Ruling F6: B2 storage tests permit the already-established legacy auth-storage lifecycle only in its scoped existing adapter. No new password location or copy is permitted. Device mode continues to keep browser native credentials absent. Appearance preference is the only new persisted browser value. Cost if wrong: credential exposure or breaking current login.

Ruling F7: B5 citation callbacks carry both citation and originating turnId/focusKey. B6 owns explicit source-read to ReaderIntent conversion with target/generation capture. Neither read path changes selection. Cost if wrong: wrong evidence or lost conversation context.

Ruling F8: B7 distinguishes local UI operation identity from server-enforced idempotency. Existing note create has no idempotency_key and note update uses expected_revision; keep those wire contracts. Unknown creates remain check-only and cannot silently be reissued. Cost if wrong: duplicate notes or lost edits.

Ruling F9: The task introducing each workspace explicitly owns/stages reviewed root package-lock.json changes, with one integrator. The old frontend lock is not silently replaced. Cost if wrong: non-reproducible installation.

Ruling F10: Do not claim already-loaded Next pages acquire a new handshake. Before C1/C3 cutover, prove a compatible old-client window against the real loaded legacy client, or implement/observe a genuine bridge/tab-update/drain procedure. If neither is proven, cutover remains blocked. No force override. Cost: delayed release rather than risking stale-client writes or lost drafts.
