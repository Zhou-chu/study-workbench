# SPA acceptance preparation and external gates

## Status

This source release supplies **inert tooling and planned cases**, not executed SPA acceptance.
The562-case catalog contains446 individual exact operation anchors plus separate journey,
fault, viewport, locale, theme, device, provider, gateway, image, user and old-tab cases.
Every row starts not_run or blocked. No operation route is promoted to verified.
There is no actual acceptance summary, screenshot index, deployed service or claim of
browser/provider/device success from this work.

Prepare, inspect and stop never import application modules, read dotenv/provider
configuration, start product/service/worker processes, access an API/database, probe or
reserve ports, open a browser, signal processes or delete roots. Only reviewed
environment-minimized Git/Node/Python **pure file verifiers** run.

## Inputs and commands

Use the prepared Linux Python, Node and Git tools. This release approves only the
existing feat/notebook-spa-redesign-20261108 checkout descending from accepted C1
8dacbb3519963f5da0c6deb9f615a0a77327116a. Its exact path is pinned by
APPROVED_SOURCE_ROOT. Relocation or another context needs controller review.
Do not copy helpers to another repository or bypass clean/source checks.

    "$PYTHON" scripts/v1/spa_acceptance.py prepare --run-root /tmp/spa-c2-UNIQUE-NEW-NAME --fixture contracts/v1/fixtures/workspace-view-v1.json --gateway /absolute/explicit/gateway-stage
    "$PYTHON" scripts/v1/spa_acceptance.py inspect --manifest /tmp/spa-c2-UNIQUE-NEW-NAME/manifest.json
    "$PYTHON" scripts/v1/spa_acceptance.py stop --manifest /tmp/spa-c2-UNIQUE-NEW-NAME/manifest.json

Optional --source-root/--web/--bff/--gateway/--contract accept absolute paths.
Defaults: helper repository, apps/web/dist, apps/bff/dist, apps/web/gateway/dist,
contracts/v1/openapi.json. Source override must still select the approved context.
Preserved current artifacts must match that clean context. Contract bytes must equal
reviewed OpenAPI. Mandatory fixture is path/hash-allowlisted synthetic projection data,
not a ready database seed/provider result.

Run root must be a **new direct child of /tmp**. Narrow parent admission avoids
assuming an arbitrary caller-named dataset/profile directory is safe. Reject reused
roots, symlink ancestors, hardlinked/special files and overlap with source/deploy/
artifact/fixture roots. No implicit build/install/discovery/staging. New directories
are0700, files0600. Anchored no-follow descriptors and exclusive atomic publication
retain partial files on uncertainty. This is not a hostile-same-UID sandbox.

C1 interfaces are reused, not copied:

    node apps/web/scripts/build-manifest.mjs --verify WEB
    node apps/bff/scripts/build-manifest.mjs --verify BFF
    "$PYTHON" scripts/v1/check_spa_artifacts.py --web WEB --bff BFF --contract CONTRACT

The reviewed verifyGateway export validates the full explicit retained window and
absolute root PDF union. It returns spa-client-window-v1, not a gateway artifact
manifest; stage bytes are measured separately. The exported verifyArtifact default
source:false is NOT used for current artifacts: actual CLIs/pair gate require clean
source identity. Pinned helper hashes and actual Git/helper/catalog identities precede
execution. No caller-selected script/shell/env override. Unavailable context blocks.

## Private manifest and closure

spa-acceptance-run-v1 records UUID/time, source/API commit, explicit synthetic-preparation
environment and legacy_password auth mode; source path/device/inode/owner/tree; run
path/device/inode/owner/mode; fixture/contract path/SHA256; separate Web/BFF roots/slots/
manifest identities and manifest/inventory/identity FILE hashes; exact gateway current/
retained window and measured whole-stage digest; runtime_started:false and phase
prepared|closed|cleanup_uncertain.

Summary Web/BFF digests are C1 ASSET-array digests, not inventory-file hashes.
Metadata hashes include final LF; canonical array digests do not. No PID/group/session/
start-tick, process-handle, secret, raw input or runtime-health field is accepted.
Saved process metadata never grants signaling authority.

Manifest.json stays the initial private preparation record. Successful source stop
writes a separate atomic closed.json receipt and retains both files and root. Inspect
validates the exact matching receipt. A source stop says only **never-started
preparation closed**. Stale identity, conflicts, partial publication and unknown claims
return nonzero blocked/cleanup_uncertain without signals or cleanup. Closure is not
machine-wide absence, runtime stopped/drained or service health. Inspect is file-only;
stored observations never establish current health.

Future runtime needs a separately reviewed still-live original foreground owner:
actual waitable OwnedProcess handles, same-namespace listener custody, partial-launch/
signal handling, registered-group cleanup/reap and actual receipts. Saved IDs cannot
reconstruct handles. Cross-process IPC, runtime launch and browser driver are absent.

## Catalog and evidence

SPA_BROWSER_CASES.json is a committed plan. Primary IDs are
C2-<ownerTask>-<exact-operation-id>--<condition>--browser, preserving all446 IDs,172 B8,
129 B9 and145 others. Provider-capable actions also have real-provider rows. Each case
contains concrete preconditions/actions/assertions, operation links, layer, mandatory,
viewport/locale/theme/input/device/zoom, evidence kinds and initial status/reason.
J/R/V/I/P cases remain separate. Group execution still needs an individually located
assertion for every operation; route opening or representative screenshot is insufficient.

F56 corrected the whole-ID fingerprint to
b9fe7af28a5e85aaf628afa49b142b451aa4f985bc5de36c2e2796d3946936f6:
sorted exact IDs joined LF plus final LF, UTF-8,11102 bytes.
The earlier112ac27a… value was the route-coverage.ts FILE hash, not the ID-set hash.
No operation was added, removed or renamed by the correction.

Mandatory conditions: all28 widths360/390/768/1024/1280/1440/1920×zh-CN/en-US×light/dark;
all14 locales at390/1440; system-first/change, override, refresh, denied storage,
retained draft/File/PDF page; actual keyboard, coarse touch, Chinese IME, phone soft
keyboard, tablet split-view and125%/200% browser zoom. Media keeps original colors,
not global grayscale/invert.

spa-case-evidence-v1 exact fields: version, run_id, case_id, layer, identities,
conditions, evidence_type, outcome, files. Identity binds source/API, Web/BFF asset
digests/slots, contract/fixture/catalog/gateway hashes. File entries are exactly
relative_path,size,sha256. References must resolve to owned0600 nonlinked regular
bytes inside private0700 root; absolute/traversal/symlink/foreign/changed paths fail.

validate_evidence validates **structure and identity only**, not truth/provenance of
caller-written JSON. summarize_cases(manifest,results) loads exact committed catalog
through pinned clean context; rejects unknown/duplicate IDs/statuses and conflicting
producer outcomes; fills omitted rows with honest initial not_run/blocked. Failed,
blocked and not_run are retained. Claimed passed needs all evidence kinds, then is
refused for this never-started schema: **no reviewed external observation producer is
released here**. Caller complete/shortened catalog/optional replacement or synthetic
JSON cannot confer acceptance.

Return fields preserve source_commit,web_digest,bff_digest,api_commit,contract_digest,
auth_mode,environment,cases,limitations plus helper-derived complete, false for this
source-only preparation. It is not persisted as an actual acceptance summary.
Future runtime schema/producer trust needs explicit review. No receipt/index/cancel/
model/session/note reducer is duplicated in summary code.

## Unrun gates and source freeze

1. Genuine owned five-service runtime/fault-provider observations, exact admitted
   request counts, original-owner uncertainty and cleanup.
2. Supported browser/upload/pixel/input and actual phone/tablet/zoom. Unit/jsdom/
   viewport emulation cannot pass those rows.
3. Specific real provider/account/model/endpoint/public data/currency budget;
   actual quality/cost and requested-versus-executed model identity.
4. Actual protected ingress, image contents, served-byte/loaded-bundle evidence.
5. Explicit user experience decision, independent production/rollback release,
   owner-observed SAVE/RECONCILE/EXIT in BOTH old->new and new->old directions.
   Otherwise DEFER. Retained files, hidden Next bridge, forced reload, method-only
   fence or timed-safe unseen tab never establish live-tab safety.

Commit final source first; build fresh separate Web/BFF artifacts and slots from the
actual clean commit; explicitly stage a fresh gateway retaining all selected releases
unchanged. Never relabel C1 bytes as C2. Freeze source/API/worker including B9e graph,
contract/artifacts/stage and observations. Later evidence/docs may report older frozen
identity but cannot claim current-HEAD/source:true verification against it. Exact
approved clean verifier context must remain available, otherwise block. No extra
worktree/branch, image run, deployment, access change or push is implied.

## Tooling checks

Temporary synthetic unit files/fake verifier boundaries never become observations.
Tests cover inert import/lifecycle, minimized environment, root/fixture/schema/evidence
custody, stale/unknown PID refusal with zero signal/delete, partial publication
retention and incomplete summaries. Final checks: root npm unit/types/lint; affected
Python lint/format/mypy/tests; exact catalog/operation parity; separate clean-source
Web/BFF builds/manifest/pair/gateway file gates. Historical full Python/legacy results
remain historical unless actually rerun.
