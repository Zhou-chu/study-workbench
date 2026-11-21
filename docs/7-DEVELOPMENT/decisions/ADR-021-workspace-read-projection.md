# ADR-021: Tolerant workspace reads, explicit action contracts

Status: accepted (code; runtime acceptance remains separate)

## Context

Workspace responses intentionally preserve retained nulls, missing fields, future
values and opaque version/provenance extensions. A full source-version or action
DTO is therefore not an honest type for every workspace record. Strengthening the
server serializer would discard compatibility rather than repair Web consumers.

## Decision

Keep raw workspace selection and version objects in the API response and Query
cache. Pure `workbench-read-model` functions produce separate, limited rendering
views; they do not issue requests, mutate the input, manufacture source metadata,
or replace raw wire objects.

Only the complete null selection receives the existing not-yet-selected empty
view. Missing, null, non-array or mixed-type ID fields inside a retained selection
remain unsupported as a whole; filtering malformed IDs must not authorize the
remaining subset. Engine/origin remain unknown until explicitly recognized. A
reading position requires an explicit nonempty version ID, a nonnegative safe
integer page and, when supplied, a valid evidence-ID string.

Keep selection write DTOs strict and separate. User edits merge into the retained
raw draft, not its lossy rendering view. An engine/origin edit cannot silently
repair another malformed field. Only a supported draft can construct an explicit
selection PATCH; initial rendering and polling never write back. Unknown selection
metadata does not become a new note's source scope; existing note snapshots and
editor ownership/conflict recovery remain unchanged. The adjacent NotebookLM panel
receives only a supported-scope flag alongside its existing typed display props;
connection/listing and explicit repair remain available where the origin is known.
Sync/import/association/audio check support at admission, confirmation and actual
deferred dispatch; an unmounted panel revokes that admission. This narrow extra
integration does not redesign authentication or task recovery.

Versions expose only the nullable fields this UI consumes. Missing identities
cannot be selected/read; missing or invalid dates display unavailable. Automatic
newest-version selection requires valid date ordering, unique valid identities and
an untied newest date. Date-only values are UTC calendar dates; timestamps require
an explicit timezone. Otherwise valid IDs remain manually selectable. No fallback
uses list order, title, hash or fabricated identity.

Provenance is opaque until its explicit kind and the displayed discriminator
fields are understood. Future kinds/authorship are unavailable, not human-derived
or independent evidence. Known fields are checked individually before display;
this is not a complete new provenance schema.

## Boundaries

This is a small Web read boundary, not a server schema migration, a generalized
normalization framework, or an editor/layout rewrite. Existing authentication,
notes, uploads, evidence identity and task-state recovery remain separate. It does
not repair Ask/Outline operation-key recovery after an unknown acknowledgement.
Synthetic shared fixtures verify the response still preserves opaque wire values;
offline component tests prove the read/action guards. Build, browser, database and
provider acceptance must be reported independently.
