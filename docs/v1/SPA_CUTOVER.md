# Notebook SPA cutover dry-run

## Current status and authority

This is a bounded **source-only structural planner**, not a deployment tool or an
acceptance producer. It cannot authenticate supplied observations, grant user
authorization, start services, contact a provider, or switch a route. A successful
unit test is not runtime or production evidence.

The retained native observation at source
`8e0d3af2b9c7623f1671c17246f6bf8eb345d920` and tree
`cb18fead5d07a894893494171d4fddafcf81d7a2` remains a **partial** result:
four native processes, 4/4 readiness requests, 23/23 transactions and seven
mutation admissions. Extraction, deduplication, lexical search, note readbacks
and a public-fixture portable roundtrip were observed. Citation validation was
not run; auxiliary embedding failed because no model was configured. This is
neither a full acceptance summary nor a cold restore of user data. New planner
source does not relabel those artifacts as a later HEAD.

Actual current/retained served source, user-data snapshots and isolated restore,
current owners/custody, browser/device/pixel/IME/zoom, protected HTTPS/Cookie
routing, official images/nginx, providers, citation behavior and the complete
catalog remain separate gates. No production deployment or old-Next retirement
is claimed by this document.

## Invocation and result

Use an already prepared Python 3.11+ environment on a platform with safe POSIX
no-follow directory descriptors. No dependencies are needed by this planner.

```sh
"$PYTHON" -B scripts/v1/spa_cutover_plan.py \
  --candidate /explicit/candidate.json \
  --current /explicit/current.json \
  --acceptance /explicit/acceptance.json
```

The public Python interfaces are
`make_cutover_plan(*, candidate, current, acceptance)`, `load_input(path)`
and `main(argv=None)`. The two pure sibling modules hold exact shapes and
evidence joins; they import no application, C1/C2 or native-runner code.

There is no force, execute, collector, environment discovery or fourth-input
mode. Only the three supplied regular files are read, once each. Referenced
records, backups, artifacts and identifiers are never opened. Unsupported safe
file semantics, symlink ancestors/files, FIFOs, malformed UTF-8/BOM, duplicate
keys (including nested keys), nonfinite JSON and over-limit input fail closed.

Exit codes:

- **0:** a structurally consistent dry-run for the disclosed phase. Not
  authenticated evidence, authorization, readiness, deployment or full
  acceptance.
- **1:** a schema or evidence blocker, with one safe JSON plan. Both action
  arrays are empty.
- **2:** invalid CLI arguments or unsafe/unreadable/malformed input, with
  sanitized stderr and no plan. Help prints usage, not a plan.

Exactly eight top-level output keys exist:

`candidate, current, backups_verified, auth_mode, compatibility, blockers,
ordered_actions, rollback_actions`.

Both identity summaries contain exactly `scope, release_id, phase,
evidence_basis, envelope_sha256, source, full_catalog_complete`. They do not
echo raw inputs, paths, logs, content, credentials or commands.

`compatibility=compatible` means structural compatibility **for this phase**.
Missing proof gives `unavailable`; affirmative incompatibility gives
`blocked`. `backups_verified` refers only to the matched declared snapshot
and isolated restore at their named pre-forward cutoff. It does not cover later
writes. UNIT fixtures always disclose `unit-fixture` evidence basis and may
exercise only synthetic planning, never production.

## Supported profiles

The policy is exactly `spa-cutover-staged-policy-v1`.

- `c2-source-preparation-v1`: normalized never-started preparation, source-only
  planning, forward-entry, null entry IDs. Always incomplete and blocked.
- `c2-native-partial-v1`: the precisely anchored retained native receipt's
  categorical/hash projection. Always source-only, incomplete and blocked.
  It has no invented run ID, environment, full summary or case passes.
- `c3-staged-structural-v1`: the new typed structural contract. It does not
  claim to be an existing C2 export. Genuine assembly, observation custody and
  permission must be reviewed outside this parser.

Preparation/partial profiles have no staged proof index. Their checks can only
be unavailable, or the fixed forward-entry future obligations for
`reverse_owners` and `post_entry_acceptance`. Observed-tagged checks are
invalid there. A changed native receipt or producer needs a separately reviewed
normalization; the pinned adapter is not a general exporter.

The former proposal name `c3-complete-structural-v1` is unsupported.
Final completeness uses the staged profile and `phase=finalize`.

## Fixed phases and catalog hold

All 615 exact membership rows and all 615 case-result rows remain present.
Membership includes conditions, operation IDs, layers, mandatory flags and
required evidence kinds. Case IDs, kind sets, conditions, references, outcomes
and compact evidence records join exactly; a caller boolean cannot create
completeness.

The only non-finalize temporal exception is the literal
`C2-R11-old-tab-window` row with `status=blocked, evidence=[]`. It permits
614 other passing cases and 1467 exact evidence slots for a staged evaluation.
All other missing/failed cases still block. Finalize requires actual complete
615/1470 evidence, including the unchanged atomic both-direction R11 requirement.
The user-experience row requires an explicit user decision about the observed
exact UI, not inferred satisfaction from technical tests or a deployment request.

1. **forward-entry:** current baseline plus exact source-matched synthetic
   candidate observations; actual forward owners, schema/custody/work and
   production-data backup/restore when planning production. Reverse owners and
   actual candidate post-entry flows are fixed future obligations.
2. **forward-verification:** actual candidate serving/auth/ingress/transport
   and seven post-entry flows are due, with the observed forward entry and
   current epoch. Reverse owners remain a future reverse-time obligation.
3. **reverse-entry:** exact retained code and source-matched rehearsal plus
   fresh actual candidate-era owners, schema/content and custody/work. The
   restored-current post-entry verification is a future obligation.
4. **reverse-verification:** actual restored-current observations and retained
   candidate-era content, bound to the observed reverse entry.
5. **finalize:** complete catalog and applicable actual latest-target facts.
   Historical both-direction evidence remains history when a later fresh
   forward entry becomes the selected target. It cannot replace fresh due
   owner/schema/custody observations.

Keep old Next available throughout provisional rollout. Do not perform an
unnecessary live rollback merely to make R11 green. Any future catalog revision
splitting that atomic requirement must be separately reviewed. Entry readiness
does not release full acceptance or retirement.

## Fifteen typed checks

All successful results have closed key sets and exact enums; there is no generic
approved/result bag or caller-selected required-check list.

1. `artifact_association`: selected Web/BFF, explicit gateway and every ordered
   retained association; current and rollback identity are the same exact
   selected current release. Legacy Next retains its distinct verifier shape.
2. `served_identity`: Web/BFF/API/worker/DB for SPA, or legacy-Next/API/worker/DB
   for legacy. Both backend sources and actual execution/config association
   matter; equal OpenAPI or BFF config alone is insufficient.
3. `auth_runtime`: actual API capability and config evidence. First cutover
   remains unchanged `legacy_password`. Device activation and coordinated
   BFF/API restart require a separate task and acceptance.
4. `ingress_topology`: protected-origin association, one BFF, internal backend,
   shared storage/lock custody and categorical writer roles `['api','worker']`.
   These role names do not establish live quiescence.
5. `cookie_upload`: two patch associations and login/config/JSON/upload/SSE/
   download for the release's actual client. Historical Cookie provenance
   `8ab9e7d0bcc9f5d0052635e10a0cf2fce7fc9020` is not current served presence.
   Today's missing upload mapping remains missing. Browser Cookie retention and
   BFF Cookie stripping are distinct behaviors.
6. `forward_owners`: actual old-to-new SAVE/RECONCILE/EXIT.
7. `reverse_owners`: actual new-to-old SAVE/RECONCILE/EXIT when reversing.
8. `schema_content`: current baseline, exact target/rollback readability,
   no downgrade and retention of current content.
9. `backup_snapshot`: complete consistent all-writer-quiescent snapshot of
   DB, personal content, checkpoints, uploads, podcasts, runtime config and
   authorized secret-custody records. Never embed secret contents or hashes.
10. `isolated_restore`: the same snapshot/cutoff/backend/schema/inventory,
    verified integrity/readable originals and a distinct isolated target.
11. `operation_custody`: exact original owners and inert handles. Pending or
    unknown outcomes require compatible original-owner retention and
    check-only/original-wait disposition; settled counts cannot erase them.
12. `user_work`: actual saved obligations, same directional inventory/window,
    zero unsaved/discarded work and explicit owner action.
13. `catalog_acceptance`: completeness derived from all fixed case/evidence
    joins, including actual user and production-row families.
14. `rollback_drill`: isolated source-matched both-direction rehearsal,
    retaining note/edit/upload content created after candidate admission.
15. `post_entry_acceptance`: login, upload, question-answer, citation, note,
    export and access protection on the actual selected target after entry.

A due unavailable, unknown, failed, blocked or obligation-only check empties
**both** action arrays. A future obligation never counts as a passed observation.

## Identity, proofs and bounds

Canonical fingerprints are recursively key-sorted compact UTF-8 JSON,
`ensure_ascii=False`, `allow_nan=False`, without LF. They are consistency
hashes, not signatures. Existing C1 metadata files retain their canonical LF
and their separate file/asset/inventory hashes.

An identity hashes exactly
`{source,auth_mode,components,backend,data_boundary}`. A pair identity hashes
`{candidate:<candidate identity hash>,current:<current identity hash>}`, in
those roles, and is separate from the full-envelope fingerprint pair.
Backend identity hashes the exact backend object. A patch component hash selects
only its observed subject's SPA component identity, legacy artifact object or
backend group. Patch source commit is provenance, not a required equality to
build HEAD or an ancestry proof.

Each primary proof binds family/producer, its nonempty record, own observation
scope/phase, subject identity, envelope pair, explicit observation time,
transition and bounded predecessor IDs. Its claim hash covers the proof without
its claim hash plus derived uses: sorted `checks` containing check ID/result,
`transition_roles`, `case_context_ids` and `successor_proof_ids`. There is no
trusted caller-authored uses map. Predecessors must resolve, be acyclic and not
occur later than their dependent record or explicit `as_of`. The planner reads
no clock and adds no TTL-based owner-drain inference.

Source and genuine synthetic records can support their proper production
planning roles without becoming production observations. Source-only,
native-partial and supplemental logs satisfy no full-gate primaries. A nonempty
normalization wrapper around an empty log is still not a genuine primary;
external record review is essential.

All limits apply together:

- Raw JSON: 1 MiB per file, three inputs, depth 16, general strings 512 UTF-8
  bytes, safe IDs 96 ASCII characters.
- Candidate/current canonical JSON: 64 KiB each.
- Partial profile: 16 KiB; partial acceptance envelope: 128 KiB.
- Staged acceptance: 896 KiB; case projection: 800 KiB;
  checks plus proof descriptors: 64 KiB; remaining projection: 32 KiB.
- 615 members/results, up to 1470 evidence slots, up to 16 shared contexts,
  48 primary descriptors, 16 supplemental descriptors, 16 proof IDs per check,
  four predecessors per proof, 32 retained slots and 16 limitations.
- At most two observations per runtime/auth/ingress/transport check; exact
  fixed-flow cardinalities; at most 256 owners, operations or work items.
- Primary record sizes 1..32 MiB; supplemental sizes 0..32 MiB.
  Backup/restore payload **metadata** is a positive integer up to 2^63-1;
  the record limit does not cap backed-up user data.

Overflow means DEFER for reviewed bounded aggregation or policy revision, never
truncation, dropping owners or automatic cap expansion. Exact field/type
validation rejects booleans used as integers.

## Later operational procedure, not executed here

Before either direction, independently verify exact authorization and original
observation custody, then immediately revalidate source/artifact identity,
protected ingress, data/schema epoch, actual owners and original-operation
custody. Unknown/unseen owners or unsaved draft/File work mean **DEFER**. Retained
files, a timer, a method-only fence, a hidden renderer or a handshake cannot
retrofit already loaded legacy Next tabs.

After authorized entry, collect actual target counterparts of checks 2-5 and all
seven post-entry flows. A provider-free lexical note roundtrip is not Q&A or
citation validation. Resolve an uncertain entry outcome before repeating it.
Before any reverse, evaluate a new reverse-entry plan using actual candidate-era
owners and current schema/content/custody. Never automatically roll back merely
because the forward procedure mentions rollback.

Reverse compatible **code/routing only**, retaining current user content and
original operation handles. No routine old-snapshot restore, schema downgrade,
forced reload, restart-to-clear-unknown, dispatch-capable polling, new key or
request replay. The original snapshot remains insurance at its stated cutoff,
not a fresh backup of candidate-era writes.

No service configuration, production route, authentication activation, legacy
entry declaration, AGENTS, ENTRYPOINTS or RUNBOOK state is changed by this source
slice. Those must describe actual separately authorized operations if and when
they occur.
