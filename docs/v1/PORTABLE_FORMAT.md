# Portable project format 1

Status: implemented. The format is an application-level ZIP, not a database backup.
It contains no application password, API key, Google browser/session profile, encryption
master key, raw LangGraph checkpoints, or embedding vectors. The archive itself is
unencrypted and contains the user's source material and notes; handle it as private data.

## HTTP and worker contracts

- `POST /api/personal/notebooks/{notebook_id}/exports`, JSON
  `{"idempotency_key":"user-generated-stable-key"}`, returns a persisted job with
  HTTP 202. Repeating the same key for this notebook returns the same job
- The existing `GET /api/personal/jobs/{job_id}` exposes progress and terminal state
- Successful jobs have `result.export_id` and authenticated
  `result.download_url=/api/personal/exports/{export_id}/download`
- `GET /api/personal/exports/{export_id}/download` rechecks size/hash and serves an
  attachment with private/no-store caching. It inherits the API password guard
- `POST /api/personal/imports/portable`, multipart field `file`, validates the ZIP
  and returns HTTP 201 with `notebook_id`, `id_map`, `entity_counts`, `missing`,
  and `warnings`. It always creates a new notebook
- `commands.portable_commands.export_portable` uses the existing durable worker
  queue. A queued export needs a running worker. Local storage/DB failure can
  retry; invalid archives or inconsistent snapshots are explicit failures

## Inventory

`manifest.json` declares `format_version=1`, application and upstream versions,
UTC creation time, entity counts, per-member SHA-256 and byte length, coverage,
missing originals, unfinished jobs, and restore requirements. Its inventory must
match every ZIP member except the manifest itself. These hashes establish
internal integrity; they are not signatures or proof of authenticity.

Machine-readable entities:

| Member | Contents |
|---|---|
| `notebook.json` | One native notebook |
| `sources.json` | Native sources and retained full text |
| `notes.json` | Native notes |
| `chat-sessions.json` | Native session metadata and notebook/source parents |
| `source-insights.json` | Saved upstream insights, without embeddings |
| `versions.json` | Immutable original/text-snapshot versions |
| `extractions.json` | Historical extraction blocks, offsets, parser metadata |
| `evidence.jsonl` | Stable evidence records |
| `turns.jsonl` | V1 answer/scope/citation snapshots |
| `legacy-chat.json` | Normalized visible human/AI messages, including restored history |
| `remote-notebook-links.json`, `remote-source-links.json` | Noncredential remote identities/mappings |
| `jobs.json` | Historical job state and safe request/result metadata |
| `selections.json`, `note-snapshots.json` | Saved scope/read position and note provenance |
| `artifacts.json`, `import-reports.json` | Saved downloaded assets and coverage reports |

`originals/<sha256>.<extension>` stores exact original or remote-text-snapshot
bytes. `origin` and `original_status` in versions distinguish real uploaded
originals from text captured from Google. A text snapshot does not prove that the
original PDF was obtained: `original_status=missing` remains in the manifest's
missing list even when text bytes are included. `artifacts/<sha256>.<extension>`
stores downloaded audio/binary assets. `notes/note-N.md` is a readable derivative
with source titles, real page/block locations, quoted text, and relative links.
The native note content remains unchanged in `notes.json`.

Legacy PDF/MD/TXT files without a V1 version acquire an immutable version record
in the export, with no invented extraction or evidence. V1 rejects unsupported
original MIME types rather than creating an unsafe inline viewer. Files already
referenced as present must actually exist and match their recorded bytes; a
missing supposedly available file causes an explicit failure.

## Consistent export

The shared filesystem project lock is the short V1 commit/snapshot barrier. An
export waits for V1 commits, reads all entity collections, and copies the
referenced immutable bytes into a temporary staging directory under the barrier.
No later packaging step re-reads the live project.

Upstream source/note/ordinary-chat writes are not all barrier-aware. The exporter
reads those native entities and normalized SQLite messages before and after
staging; a change fails the export instead of publishing mixed state. Original
copy checks also compare inode/size/mtime and expected hash. SQLite failures are
explicit: unavailable original history is never described as fully backed up.
No raw checkpoint, tool runtime state, or hidden graph execution state is copied.

Large ZIP writing runs after releasing the project barrier. ZIP members are
stored without compression, avoiding exceptional expansion ratios in our own
exports. A complete archive replaces a temporary file atomically, and its
metadata/download is published only after successful completion.

## Validation and trust boundary

Validation completes before creating any database records. It rejects:

- Absolute/parent/Windows/backslash/NUL paths, duplicate names, symlinks and other
  special files, encrypted entries, excessive entry counts, expanded size, or
  compression ratio
- Unknown format, malformed manifests/JSON, mismatched inventory, hashes, byte
  counts, entity counts, and references outside the exported project
- Original/asset file references outside their corresponding payload directories
- Unsafe original MIME types; original types are PDF, plain text, and Markdown
- Evidence quote hashes or Unicode offsets inconsistent with extraction text,
  page index/label or geometry inconsistent with the extraction block, or page
  indices outside the extraction's page count
- Claimed verified citations inconsistent with evidence identity, saved source
  scope, actual evidence IDs, exact quote substring, or exact locator
- Connection/secrets/runtime credential fields, including nested sensitive keys
  and ephemeral URL fields. Remote identity metadata remains; credentials do not

An attacker can rewrite an entire extraction together with its evidence and
manifest. Consequently restored `verified` citations become `unverified`, with
`archived_reference_validity=verified` retained. IDs, quote, and locator still
open the historical content, but the UI must not claim that a new trusted
extraction verification occurred. No signing or authenticity claim is made.

Every imported extraction and evidence record is additionally assigned
`verification_origin=restored_archive` by the server, overwriting any claimed
origin in the archive. Exports preserve this marker and every later restore
reapplies it. Without an independent local revalidation, citation validation and retrieval treat these historical records
as unverified, even if the imported quote and locator match the imported
extraction exactly. Editing notes or generating new answers alone cannot upgrade that
trust. As of 2026-10-20, explicit local revalidation can independently parse retained original bytes and compare historical evidence against that fresh extraction. Exact matching evidence can then validate without changing historical IDs, quotes, or locators; mismatches remain unverified. The archive-derived marker remains, and stored citation snapshots are not rewritten. Verification means quote/location consistency, not authorship or truth of the cited claim.

Import discards all supplied extraction revalidation reports, even after a prior successful local check and re-export. Each restored project must establish its own fresh verification; neither a forged report nor a report copied from another runtime is trusted. Missing originals and remote-text snapshots cannot supply this independent original-byte check. Explicit invalid/out-of-scope citation decisions are not upgraded by a reader badge.

Defaults, tunable through environment variables:

- `STUDY_WORKBENCH_PORTABLE_MAX_BYTES=1073741824` bounds both physical ZIP bytes and total expanded member bytes (including `manifest.json`)
- `STUDY_WORKBENCH_PORTABLE_MAX_ENTRIES=10000`
- `STUDY_WORKBENCH_PORTABLE_MAX_RATIO=200`, with a 1 MiB small-member allowance
- Manifest maximum 8 MiB; each entity metadata member maximum 32 MiB
- Exact authenticated `POST /api/personal/imports/portable` accepts that ZIP budget plus 1 MiB bounded multipart overhead; all other routes retain `OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB` (100 MiB default).
- `GET /api/personal/portable/limits` requires authentication and returns numeric `max_archive_bytes`, `max_expanded_bytes`, `max_entity_bytes`, `max_manifest_bytes`, `max_request_bytes`, `multipart_overhead_bytes`, `max_entries`, and `max_compression_ratio`. Frontend preflight uses the archive-byte limit; server validation remains authoritative.

Export and import enforce the same entity, manifest, inventory and size limits. ZIP headers count toward the physical ZIP limit, so an expanded payload at the full budget may still be too large to export. Oversized exports fail the durable job with an actionable error and publish no download; reduce project content or increase the shared budget (the entity metadata cap remains 32 MiB). ZIP_STORED export avoids compression-ratio rejection even for repetitive text. Configuration changes require API and worker restart; configure both identically. Nonpositive, malformed or JSON-unsafe numeric settings fail startup rather than silently disabling bounds.

Authentication precedes body reads. Both declared Content-Length and streamed bytes are bounded. Before constructing `ZipFile`, a bounded central-directory preflight counts actual directory records (not only the declared count), including ZIP64 archives, so excessive entries cannot allocate unbounded `ZipInfo` objects first. The isolated preflight relies on stdlib ZIP end-record helpers and is covered by ZIP64/compatibility tests; retain those tests when upgrading Python. The portable parser rejects non-multipart content before reading the body and accepts exactly one file part named `file` and no text fields; rejected multipart uploads close their temporary files. A dedicated Next.js POST route streams portable imports to the internal API without buffering or using the general 100 MiB rewrite-clone path. External reverse proxies can still impose lower limits; configure the protected portable import path with sufficient body allowance before relying on large browser restores. The application limits endpoint cannot discover external proxy limits.

## Fresh restore and failure handling

All primary identities are remapped to new IDs, including native notebook,
source, note, chat session and insight IDs and V1 evidence/version/turn/job IDs.
Every local identifier reference and file reference is remapped. Scope hashes
are recomputed for remapped IDs; remote IDs and prose are not rewritten. Files are staged under the new data root, then atomically moved to
`restored/<import_uuid>/originals/` and `restored/<import_uuid>/artifacts/`.
One SurrealDB transaction creates native entities, relationships and V1 records.
The normal Note.save path is deliberately bypassed, so restore does not launch
embedding work. No raw SQLite execution state is restored. Normalized old chat
lives in `v1_legacy_chat`, is readable in the workbench, and survives re-export
without the old SQLite file.

Confirmed transaction failure rolls back all DB records and removes staged
files. A lost acknowledgement or cancellation during commit is different: its
outcome cannot safely be inferred. The service reports an unknown commit outcome
and keeps the immutable restore directory, so a possibly committed record never
loses its bytes. Inspect the new database/restore directory before retrying;
never automatically replay an uncertain import. Existing notebooks are untouched.

Remote links are `unverified` and require a new authenticated rebind. All imported
jobs become cancelled local history, retain `historical_state`, and have
`replay_allowed=false`. No creation, upload, question or generation is replayed.
Interrupted extraction metadata becomes failed with an explicit re-extract hint.
Credentials must be configured separately; embeddings can be rebuilt separately.
Data restoration success does not imply Google or model connectivity.

## Verified evidence

`tests/test_v1_portable_roundtrip.py` exercises real ZIP bytes in disjoint temporary
roots, deletes the original root before restore, and checks graph remapping,
original hashes, normalized history, notes, assets, remote-scope preservation,
secret exclusion, malicious archives, rehashed citation forgery, and cleanup.

The opt-in integration test
`test_real_surreal_sqlite_and_originals_restore_into_fresh_environment` uses a
loopback-only SurrealDB 2.3.10 fixture, two newly migrated unique databases,
real CPU TXT extraction and real SQLite LangGraph visible messages. It removes
the original files and SQLite, restores with the production transaction, checks
new IDs/hash/history, then re-exports without accessing the original environment.
Set `STUDY_WORKBENCH_TEST_SURREAL=1` only against an isolated test database server.

Whole-instance administrative backups are a separate operation: include
SurrealDB, SQLite, file directories and necessary configuration, and separately
protect credentials. They do not belong in this portable ZIP.

A20 is reported as partial under this trust policy: the data roundtrip is proven,
but a restored historical citation is intentionally not marked freshly verified.
A21 archive-integrity, malicious-input and managed-secret exclusions are covered
by the dedicated tests. After the persistent provenance fix, the final dedicated
suite has 38 passed and 1 skipped without the native flag; the isolated native
run has 39 passed. Both logs record one upstream Pydantic deprecation warning.
