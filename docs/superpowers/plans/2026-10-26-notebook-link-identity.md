# NotebookLM live-link identity alignment plan

> **For agentic workers:** Use superpowers:subagent-driven-development task-by-task.

**Goal:** Make a successfully created live NotebookLM association visible to its workspace without activating restored history or choosing an ambiguous target.
**Architecture:** Share one deterministic live-link identity between writer and reader, with one bounded raw-envelope batch for exactly the canonical and legacy identities and conservative compatibility validation. No list-first lookup, migration, deletion or new remote calls.
**Tech Stack:** Python, PersonalStore, existing FastAPI routes, offline pytest with synthetic repository/provider seams.
**Spec:** Read-only audit showed link_notebook saves link_<uuid5(notebook_id)> while workspace reads plain notebook_id. Actual route + PersonalStore + workspace synthetic proof produced link:null despite a stored record. Portable restoration remaps link_id and sets requires_rebind=True; these records must stay inactive.

## Global Constraints
- Preserve current route's deterministic link_id value and remote verification/write ordering. connection_id='notebooklm' is a provider label, not account identity.
- Shared helper in api/notebooklm_links.py; modify api/routers/notebooklm.py and api/personal_service.py only as consumers. Existing wire record fields stay lossless.
- Canonical identity is exactly 'link_' + str(uuid5(NAMESPACE_URL, notebook_id)); writer continues storing under it. Reader never uses arbitrary list()[0] or searches history for an active target.
- Reader validates requested notebook ownership, nonempty string remote_notebook_id, known connection label when present, and canonical link_id agreement. Canonical records require the current route's fields. Legacy notebook-key records may omit link_id/connection_id, but any provided values must match the canonical ID/provider.
- Recognized historical/inactive or malformed activity markers never activate: requires_rebind/restored_history are eligible only absent or strictly false; replay_allowed only absent or strictly true. Exact `origin` or `verification_origin` values `restored_archive`/`restored_history` indicate inactive. Structural owner/ID/provider/remote validation precedes activity checks even on inactive exact-key rows. Do not coerce strings/null to booleans or infer activation from mapping_status/remote_status.
- Canonical absent: strictly validated active legacy notebook-key record may be returned. Canonical present but inactive: return None, not legacy resurrection. Canonical active: return it only after checking any legacy record; a valid active different target is a fixed conflict, inactive history is ignored. Malformed/wrong-owner keyed records fail closed with fixed errors rather than selecting a target.
- Use fixed InvalidInputError codes NOTEBOOKLM_LINK_INVALID, NOTEBOOKLM_LINK_OWNER_MISMATCH, NOTEBOOKLM_LINK_CONFLICT, not raw record values. No new mutation in workspace reads.
- Use existing `PersonalStore.get_many("link", [canonical_id, notebook_id])` raw row envelopes, so an absent physical row differs from a present `payload:null` or missing payload. A null/missing payload is invalid, never legacy fallback. Root approved this replacement of two individual reads; no store changes or fallback to mock-only methods.
- Preserve all rows, including inactive archives; explicit current relinking creates/updates canonical live record and does not delete restored rows. Conflicting live legacy data may require operator reconciliation; do not auto-migrate it.
- No services/real DB/provider/browser/network/install/credentials/cache changes, restricted probes, main/deployment or implementer remote writes. Use prepared interpreter and unchanged offline runner. Parent publishes reviewed source/tests/docs to existing private audit branch.

## Review Focus
- Real link-route write followed by real workspace/response read, using PersonalStore physical key semantics, not a fixture seeded under the reader's wrong key.
- Archived requires_rebind records with random IDs must never become active; exact-key legacy restored rows must also stay inactive.
- Wrong-owner, malformed IDs/flags and conflicting live targets must not silently pick a notebook.
- Explicit relink preserves historical rows and restores visibility without extra remote verification calls.
- Shared helper must not introduce router/service dependency cycles or alter idempotency, connection/account assumptions or other store kinds.

### Task 1: Align live-link identity and guard history

**Files:** new api/notebooklm_links.py; api/routers/notebooklm.py; api/personal_service.py; new tests/test_v1_notebooklm_link_identity.py (reuse audit proof as reference); relevant workspace/portable tests; CHANGELOG.md and this plan.
**Interfaces:** notebooklm_link_id(notebook_id: str) -> str; async read_notebooklm_link(store, notebook_id: str) -> dict | None. Fixed error codes above.

- [x] Read actual writer/store/workspace/portable code and audit proof /tmp/link-identity-audit-XG4Aoy/test_link_identity.py if available; do not assume that temporary path persists.
- [x] RED real-route/store/workspace regression: successful route record appears as workspace.link with the same IDs/target and retained extension metadata. Test ordinary no-link -> None. Fake only provider/DB external seams, never the physical identity contract itself.
- [x] RED canonical/legacy matrix: active canonical; absent canonical + valid legacy; identical targets; conflicting targets; wrong notebook; bad link_id/provider/remote target; explicit null/string/true history flags; random restored rows; exact-key requires_rebind history. Assert no list/arbitrary selection, no write from read, no raw sentinel in fixed errors. Additional RED physical null canonical + valid legacy rejects fallback.
- [x] RED explicit relink over an inactive exact-key row and alongside random restored history: newly canonical current target becomes readable, historical rows retained. Preserve remote verification failure behavior and call counts.
- [x] Implement helper/consumers with original route ID and locking/write sequence unchanged. No schema or historical-record migration.
- [x] Focused GREEN, fresh full offline backend, Ruff/format/mypy/OpenAPI. Report any inherited/runtime gaps separately.
- [x] Changelog and concise evidence; scoped implementation commit prepared after verification.
- [ ] Parent independent review and approved publication (not implementer authority).

## Self-review / preflight

| Interface | Check | Result |
| --- | --- | --- |
| Writer/helper | Exact current uuid5 identifier retained | Consistent |
| Reader/helper | Exactly canonical + legacy identities in one raw-envelope get_many batch; owner/history/null checks | Consistent; root-approved null distinction |
| Portable | No selection of remapped historical rows; no migration | Consistent |

Ruling: support only exact-key, strictly validated legacy live records; reject conflicting live targets instead of picking by order/time. Cost: corrupt or ambiguous legacy databases may need manual reconciliation, but workspace never silently activates a different remote notebook.

## Implementation evidence (2026-10-26)

- RED actual POST/physical store/GET workspace: persisted canonical record was invisible; initial matrix 92 failed / 3 passed. Additional physical-null RED: 2 failed.
- GREEN focused link/workspace/portable/NotebookLM/API-contract suite: 254 passed / 1 opt-in skip. Final full offline backend: **2,778 passed / 128 skipped / 2 inherited warnings**.
- Full Ruff/format/mypy (318 source files) and guarded nonwriting OpenAPI comparison passed. One bound raw-envelope query reads exactly two physical link identities, including deliberately unordered rows; no link scans, writes or remote calls.
- Detailed logs and review record: `../notebook-link-review/implementation.md` outside the source worktree. Runtime/real DB/provider/browser, frontend, coverage, deployment and CI were not run or claimed. Parent owns independent review/publication.
