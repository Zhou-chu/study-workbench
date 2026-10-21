# Portable archive format compatibility

New exports use **format 2**. The current reader explicitly accepts formats **1
and 2**, with the same integrity, size, ZIP safety, graph and revision checks.
Format numbers must be exact JSON integers: booleans, strings, floats, missing
values and unknown versions are rejected before restoring records or publishing
destination payloads. Every new export uses 2, including native-only notes and
projects without notes. The archive README identifies the same format.

## Why a version boundary is necessary

Historical format-1 readers (including commits `07654a46` and `51a58f1`) accept
only format 1. Those readers omit native note revisions on restore while retaining
snapshot revisions. Importing a native 7 / snapshot 7 archive there and subsequently
upgrading can backfill native revision 1, leaving an inconsistent 1/7 pair. The
current reader correctly refuses that inconsistency; copying or resetting a
revision is not a safe repair.

Format 2 makes those historical readers reject new archives at their version
gate, before restore. An informational minimum-reader field on format 1 would not
protect already-shipped readers. This boundary is a narrow compatibility change,
not a schema migration or a change to archive payload layout or restore semantics.

## Directional compatibility

| Archive | Historical format-1 reader | Current reader |
| --- | --- | --- |
| Genuine legacy 1, missing revisions | Accepted | Accepted; missing revisions mean 1 |
| Revision-aware 1, matching native 7 / snapshot 7 | Unsafe downgrade path; avoid | Accepted, preserving 7 |
| New 2, matching native 7 / snapshot 7 | Rejected before restore | Accepted, preserving 7; next save advances to 8 |
| Supported format with contradictory revisions | Historical behavior is not safe | Rejected without restore |
| Unknown future 3 or malformed version | Rejected | Rejected without restore |

Missing revision normalization remains unchanged for both supported versions;
positive exact-integer revision validation and native/snapshot equality remain
mandatory. Native-only notes do not require a snapshot. Hashes, ZIP limits,
manifest inventories, reference validation, fresh identities and remote-reference
distrust are unchanged.

Existing archives are **not rewritten**. Previously emitted revision-aware
format 1 archives remain readable by the current reader when internally consistent,
but their old-reader hazard remains. Do not downgrade-import them. For an already
inconsistent restored project, retain the original archive and use an intact,
consistent original with a current reader into fresh identities. In-place salvage
requires separate operator authorization and evidence; this change performs none.

## Regression evidence

`tests/test_v1_portable_roundtrip.py` tests actual exported ZIPs, both supported
reader versions, legacy missing revisions, preserved 7, malformed/future versions,
revision mismatch rejection, and no destination publication/repository commit on
failure. Its small immutable historical-gate fixture documents the exact old
version condition without relying on git history during CI. That fixture models
only the gate: it is not an execution of a historical application.

The opt-in native SurrealDB roundtrip test exports, restores revision 7 and saves
revision 8 using the real repository. Resource/security regression coverage remains
in that suite and `tests/test_portable_zip.py`.
