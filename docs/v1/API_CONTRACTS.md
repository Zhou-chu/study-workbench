# V1 API contracts

All endpoints below are under `/api/personal`; application bearer authentication is required. Mutations with an Origin header must originate from the configured/current origin. Responses use no-store and nosniff. Download paths are derived from stored IDs, confined to configured roots and hash checked, never arbitrary client paths.

## Local source and study workflow

- `GET /notebooks/{id}/workspace`: native notebook/notes plus versions, jobs, turns, selection, links and legacy visible history
- `PATCH /notebooks/{id}/selection`: `{engine, selection_origin, source_version_ids, remote_source_ids, reading}`; at most 20 selected source versions, each belonging to this notebook
- `POST /notebooks/{id}/sources/upload`: multipart `file`, optional `title`, `source_id`, required `idempotency_key`; returns durable IDs for source/version/extraction job, repeated same operation retains identity
- `GET /sources/{id}/versions`: immutable versions
- `GET /source-versions/{id}`: original metadata, current extraction and evidence; `evidence_id` or `extraction_id` selects retained historical extraction and must belong to this version
- `GET /source-versions/{id}/download`: protected original bytes; safe PDF/plain-text/Markdown MIME only
- `GET /evidence/{id}`: exact quote, version/extraction identity and physical-page/block offsets
- `POST /search`: `{query, source_version_ids}`; bounded lexical hits within selected versions, no model required
- `POST /chats/{id}/turns`: `{notebook_id, engine, message, task, selection_origin, source_version_ids, remote_source_ids, idempotency_key, model_id?}`; task is `question` or bounded `outline`; returns stable `{job_id,turn_id}`
- `GET /chats/{id}/turns`, `GET /turns/{id}/events`: stored immutable turn scope/status; events report durable state rather than inventing model token streaming
- `POST /notebooks/{id}/notes`, `PATCH /notebooks/{id}/notes/{note_id}`: native note content plus preserved citation/scope metadata

A turn's selected scope is a snapshot, not a pointer to mutable current selection. Local citations revalidate server-side; unmapped Google references retain remote text/title/reference with unverified status. Normal question retrieval and outline sampling are bounded, and incomplete coverage is explicit. Prior answers are not promoted into source evidence.

## NotebookLM workflow

`GET /connections/notebooklm`, `POST /connections/notebooklm/connect|reconnect`, `GET /connections/notebooklm/connect/{flow_id}`, `DELETE /connections/notebooklm` expose runtime connection state/manual-login guidance. Deleting the connection clears local application state, not Google notebooks.

`GET /notebooklm/capabilities`, `GET /notebooklm/notebooks?cursor=...`, and `GET /notebooklm/notebooks/{remote_id}/sources?cursor=...` return capability/listing metadata. Recently-viewed notebook inventory is explicitly incomplete.

Durable, explicitly confirmed write/import operations:

- `POST /notebooklm/notebooks`: create target Google notebook
- `POST /notebooks/{id}/notebooklm-link`: local notebook association
- `POST /notebooks/{id}/notebooklm-source-link`: explicit exact original-to-remote-source confirmation, never filename-only inference
- `POST /notebooks/{id}/imports/notebooklm`: selected remote text/metadata import, without claiming missing originals or unavailable conversation history
- `POST /notebooks/{id}/sync/notebooklm`: exact selected original versions
- `POST /notebooks/{id}/artifacts/audio`: one selected-scope generation request
- `GET /notebooklm/notebooks/{remote_id}/artifacts`, `POST /notebooklm/artifacts/{remote_id}/download`, `GET /artifacts/{id}/download`: enumeration/import and protected local result

See typed request models in `open_notebook/integrations/notebooklm/contracts.py` and `NOTEBOOKLM_SDK.md`. Common errors include `NEEDS_REAUTH`, `EMPTY_SCOPE`, `SOURCE_NOT_READY`, `SCOPE_ISOLATION_UNAVAILABLE`, `QUOTA_LIMITED` and `IDEMPOTENCY_CONFLICT`.

`GET /jobs/{id}` exposes operation/state/submission_state, remote task/result identity, timestamps, local result and errors. `POST /jobs/{id}/cancel` stops local waiting where supported. Write retry requires reconciliation when submission is unknown. Polling is short worker work scheduled by the API dispatcher, never a sleeping worker for an entire audio generation.

## Portability

`POST /notebooks/{id}/exports` accepts an idempotency key and returns a durable export job. `GET /exports/{id}/download` serves the completed ZIP. `POST /imports/portable` accepts multipart `file` and validates before committing a new notebook. See `PORTABLE_FORMAT.md` for exact manifest/hashes/limits and archived-reference trust rules. Import does not overwrite existing notebooks and cannot trigger remote writes.

## 2026-10-20 continuation: local evidence maintenance

- `POST /source-versions/{id}/reparse`: `{idempotency_key}` returns the durable job. A successful result contains `source_version_id`, new `extraction_id`, `status`, and `evidence_count`.
- `POST /source-versions/{id}/revalidate`: `{extraction_id, idempotency_key}` targets the retained historical extraction of this version. A successful result contains `source_version_id`, historical `extraction_id`, independently produced `fresh_extraction_id`, `checked_count`, `verified_count`, `unverified_count`, and `checked_at`.
- Both require available retained originals, not a remote-text snapshot. They use local CPU parsing, not Google or a model. Reusing a key returns the existing operation; changed operation/extraction under the same key is `IDEMPOTENCY_CONFLICT`. A failed operation requires an explicit new key to retry.
- Version detail evidence includes current server `reference_validity` and `reference_reason`; restored extraction provenance remains `restored_archive`, with a server-produced `revalidation` report after comparison. A report is not archive authenticity or claim-truth verification.
- `GET /jobs/{id}` drives recovery of stale queued/running maintenance jobs using the same job and fresh-extraction identity. Per-job dispatch/run locks prevent overlapping execution; restored historical jobs cannot replay. This is polling-driven recovery, not an autonomous always-running scheduler.
- Reader navigation aborts client requests and ignores stale completion, but does not cancel a durable server operation. A polling error can recheck that existing job without submitting another. Reparse does not replace a historical citation selector.

Fresh evidence verification does not override frozen answer scope: explicit `invalid` and `out_of_scope` citations remain such. Only matching, restored, unverified local citations can receive an updated reader-only badge; stored answer/note citation snapshots are not rewritten by maintenance. Strict remote ask capability is checked again inside the serialized call boundary; the published SDK remains blocked until non-destructive fresh context is supported.


## Atomic note revisions (T3b backend)

Personal note creation uses a separate typed create payload (title, content,
citations, scope_snapshot). Personal PATCH and legacy PUT add optional
`expected_revision`, a strict positive integer: bool, float, string, zero and
negative values return the existing 422 validation-list envelope. Create responses
start at `revision: 1`; editorial updates (including citation/scope-only changes)
advance exactly once. Native `note.revision` is authoritative. Native content and
personal snapshot metadata/revision are committed and read transactionally;
original creation timestamps survive. Embedding-only submission does not revise.

- Stale supplied predecessor: 409
  `{"detail":{"code":"NOTE_REVISION_CONFLICT","current_revision":2}}`.
- Missing/null predecessor in explicit `multiclient` mode: 428
  `{"detail":{"code":"NOTE_REVISION_REQUIRED"}}`.
- `STUDY_WORKBENCH_NOTE_WRITE_MODE` defaults to `legacy_single_web`: omission/null
  remains accepted for compatibility, but any supplied revision is enforced.
  Invalid configuration fails startup. No authentication/session-mode activation
  is part of this change, and omission-compatible operation is not a multiclient
  release-readiness claim.
- `GET /api/personal/note-capabilities` reports `contract_version: "v1"`,
  `conditional_writes: true`, and `expected_revision_required` for the current mode.
- Missing/foreign notebook membership returns 404 before revision disclosure.
  Native-only notes can gain a snapshot on their first authorized personal save.
  A shared note keeps one snapshot owner; other notebooks may read native content
  and revision, but not the owner's citation/scope metadata or edit that snapshot.
- Unknown commit acknowledgement (including lost connection/cancellation after a
  possible commit) is a typed 500 detail string. Preserve the draft, read/reconcile,
  and never automatically retry with either the old or a newly fetched base.

Legacy PUT retains supplied-field semantics, and domain saves enforce their loaded
revision. Note deletion atomically removes native rows, artifact memberships and
snapshots. Notebook deletion atomically removes its note set and parent at the
final note commit; unrelated source/chat cleanup is not claimed newly atomic.
Local export coordination still requires a shared flock-capable data root; DB CAS
provides revision safety across independent roots, not distributed export locks.
Portable restore preserves valid N under fresh identities; old absence is 1 and
malformed or inconsistent native/snapshot revisions reject the archive before writes.


Membership/deletion safety uses `note_write_guard` records keyed by the native
note/notebook identity, in the same transaction as the mutation. These internal
random tokens are not revisions, carry no content, and are excluded from archive
exports. Guards are retained as tombstones after deletion (not deleted/recreated
across the competing mutation), and are lazily initialized for restored/legacy
IDs. They prevent database snapshot-isolation write skew without touching native
user-visible timestamps. A definitive serialization loser is an error requiring
reconciliation, not an automatic retry. Related project locks are acquired in
sorted order only after the note mutation barrier; export/read project locks never
acquire that barrier. Archive import uses fresh identities in its existing single
transaction; no live guards or runtime concurrency state are imported.
