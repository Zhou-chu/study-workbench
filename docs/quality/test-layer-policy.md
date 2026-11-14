# Test-layer classification, version 1

Incomplete fail-closed inventory, not a unit coverage result. Base cd22592,
fast-forwarded to 3e72ce0. Existing coverage runners and denominators unchanged.

## Boundaries
- unit: one logical production unit per case, external boundaries replaced;
  no real network/DNS, database, browser or subprocess. Static fixtures allowed.
- component-integration: independent UI/provider/router components collaborate.
- api-integration: actual ASGI/HTTP routing stack, even in-process.
- tool-integration: real subprocess or filesystem/build assembly.
- system-browser: actual browser and services.
- static-contract: type-only/source-text/architecture contracts.
- mixed: multiple layers in one file; split before unit selection.
- unclassified: pending review, never eligible based on its name or runner.

Do not infer integration from import/module count. Internal schema validators,
copy/freezing utilities and pure implementation helpers remain within a logical
unit. Standard/runtime libraries are not automatically external application
boundaries. An integration judgment must identify independently owned components
whose collaboration is tested, or actual I/O/process execution. For example,
registry admission plus reconciliation plus settlement/release verifies separate
ownership mechanisms; internal context predicates in a registry transition do not.
Pure computation in a real child process remains tool-integration.

## Manifest and fail-closed interface
scripts/quality/test-layers.json records layer, target(s), reason and reviewed-test
SHA256. Unknown targets are empty deliberately rather than guessed.
All 10 contracts/domain test files have been read, including assertions, fixtures,
and production helper boundaries. The remaining backlog is explicit. Initial review snapshot, 451 files: 400 unclassified, 24 unit,
21 mixed, 3 api-integration, 2 static-contract and 1 tool-integration.

validate_manifest(document, inventory, hashes) refuses unresolved/mixed layers,
duplicate/stale/missing paths, invalid targets/reasons/layers and changed digests.
select_unit_paths(...) returns nothing unless the entire classification validates;
there is no partial whitelist bypass.

CLI: --root ROOT --manifest MANIFEST --inventory TRACKED_NUL.
Inventory is complete NUL-terminated git ls-files -z from the existing
independently provisioned trusted Git. Caller binds it to checkout and preserves
digest; the validator cannot establish completeness from arbitrary supplied lists.
Never use ambient PATH as a replacement for the trusted Git mechanism.
CLI independently hashes test files, checks containment and lstat regular-file
type before reading, and exits 1 on unresolved/error. It executes no tests.
Trusted quiescent checkout custody is required: lstat/read is not advertised as
race-resistant against another writer replacing files between those operations.

Inventory includes Python test_*/ *_test.py under tests and JS/TS test/spec
extensions under apps/packages/frontend/scripts/tests. All current Python test
files are under tests. New naming or runner conventions require policy updates.

## Integration contract (not implemented)
1. Trusted complete inventory and classification validation before execution.
2. Unit file selection only for offline pytest, each Vitest partition and c8.
3. Preserve ALL production source and scripts, API/backend/commands/entrypoints,
   legacy frontend and all 11 Node partition denominators. A partition with no
   unit tests contributes zero-covered production files, not an omitted scope.
   Dynamic audit, not frozen 178/560 totals; this validator joins Python scope.
4. Reports bind layer=unit plus classification/inventory/source digests and
   executed tests. Separate data/output; no combining mixed coverage.
5. Strictly >90 for each required measured metric. Python function coverage N/A;
   Shell gap explicit. Existing mixed percentages cannot become unit percentages.
6. Production/dependency changes require semantic re-review; a test digest alone
   does not guarantee continued isolation.

## Reviewed boundaries and splitting
- Contracts boundaries/workspace-view: parser units with static fixtures.
  consumer/runtime-config: type-only static-contract.
- Domain editor/scope/operation/turn-operations: logical state/parse units.
  embedding-disclosure and turn-reconciliation: mixed direct checks, static types
  and registry interoperability. Split independent collaboration cases.
- cold-return: nine direct units plus one real child-process deadline.
- Artifact loader: fake fetch and internal response classification, unit.
  Studio store: pending precise store/domain/session ownership boundary review.
- Python source projection, response models, connection/error classifiers,
  browser assertion helpers, database URL admission and synthetic credential
  envelope are logical units; no actual services.
- URL validation includes unmocked localhost DNS. Encryption includes HTTP
  endpoint dispatch; chunking uses tokenizer resources; regex deadline starts
  processes; order-by includes TestClient; SSL CA cases inspect real files.
  Those mixed files require splits.
- CLI tests are separate tool-integration; pure validator tests do not execute it.

## Verification
TDD missing-module RED, then 17 passing; missing selection API RED, then 18.
Review regression RED reproduced malformed/unhashable inventory TypeError and
FIFO read blocking, bounded by unchanged two-second child timeout. Type checks
now precede set construction; lstat/S_ISREG precedes file reading.
24 pure validator cases and 8 separate CLI integrations pass (32 total, 0.64s).
CLI covers valid input/digest mutation, incomplete NUL, invalid UTF-8/traversal,
directory/symlink/FIFO rejection. Ruff passed. No full suite/application coverage,
browser or services run. Current incomplete classification intentionally fails.

## Independent Python review incorporated
27 Python files were independently read at 71fbefb; each reviewed file's bytes
were compared against this 3e72ce0 tree and all matched. Reasons and targets
are recorded per file, not inferred from folder names. Combined review now
classifies 51 files, including every contracts/domain test file.
Credential service/model discovery/source command direct cases use explicit
boundary doubles and are units. Real TestClient/ASGI files remain API integration.
Migration with a fake repository is not automatically integration merely because
it calls crypto helpers; encryption.py's HTTP and AST cases still make it mixed.
Boundary logging wrapper cases are independent units with external I/O doubles,
not a complete application workflow. Model-discovery unit selection depends on
the existing offline harness stripping provider URL/key environment overrides.
No classification claims that test execution itself enforced a universal sandbox.


## CLI structural-error follow-up
Non-object JSON and non-list entries must return structured errors, never crash
during summary construction. Project CLI also rejects an empty inventory even
with empty manifest entries. This is only a sanity check, not a completeness
proof: a nonempty subset remains untrusted until the caller binds the entire
trusted Git inventory to the checkout. The pure validation API can represent an
empty abstract fixture; it is not an independently trusted project gate.
Regression tests are CLI tool-integration, not added to unit totals.

Follow-up verified: 24 pure validator + 16 CLI integration cases = 40 passed
in 0.66s; Ruff passed. Classification counts and production scope unchanged.

Integration follow-up: the search-render regression adds one reviewed component-integration file. Total 452 files; no unit eligibility or production coverage denominator changed.

## Second classification batch (after merging 89d10e1)
Latest inventory: 452 files; 351 unclassified, 42 unit, 40 mixed,
7 tool-integration, 6 api-integration, 4 component-integration, 2 static-contract.
Thus 101 files have a decided layer. This is not a coverage percentage.
The selected-search-ownership component regression remains included.

Added 30 Python reviews at f10d0f4 plus 19 newly classified SPA files from a
21-file review (artifact/cold-return were already classified). Every supplied
SHA256 was checked against current bytes. Decisions distinguish internal pure
helpers from independent registry/coordinator lifecycles, API routing, actual
DBs (including mem://), filesystem and parser processes. Tool-integration
includes actual database resource workflows; reasons explicitly say when DB
rather than CLI is exercised.

Python evidence extraction uses a real spawned parser even for text; MemoryStore
does not make these unit tests. Synthetic embedding cases are unit-eligible only
with a prepared tokenizer cache used as a static fixture and network/write
fallback prevented by the offline harness. A missing cache must block execution,
not silently change the layer.

SPA fake transport DTO/parsing and single-component props/callback cases are
units. Actual sessionCoordinator.begin/confirmed/invalidate between asynchronous
adapter settlement steps, or runtime-to-registry completion, are integration.
Some files require splitting within a case, not just selecting case names.
Static provider/router wrappers alone do not imply integration when their state
or lifecycle is not the behavior under test.

Read-only validator check on this merged tracked inventory produced only expected
351 unclassified + 350 missing targets + 40 mixed errors; no stale/missing paths,
target errors or digest mismatches. No application/full suite or coverage rerun.
Production denominator and runner behavior remain unchanged.

## Transport/BFF classification batch (after merging 006831f)
All 8 web-transport and 13 BFF test files were read in full, with production
server/CLI/recovery/session-client and dependency boundaries inspected. Four UI
reviews from the parent were incorporated only after matching supplied SHA256.
The new models-router unit entry and search component entry remain present.

Inventory now 453: 326 unclassified, 52 unit, 49 mixed, 10 API integration,
8 tool integration, 4 component integration, 4 static contract (127 decided).
This is classification, not unit test execution or coverage.

- BFF session-store is one custody unit with nativeCalls doubles/fake clock.
  Runtime crypto, internal state transitions and module-reload singleton lookup
  do not automatically make it integration. CLI listenAddress plus inert-import
  observation starts neither socket nor child process and is unit.
- BFF raw HTTP, streaming and auth-loss suites use actual sockets/listeners, even
  with synthetic upstreams. private-ingress also has direct classifier units.
- handler and proxy-parity exercise actual Request routing/store cooperation;
  handler includes isolated config checks, proxy-parity includes source/package
  architecture checks. policy mixes direct predicates with frontend AST/schema
  parity; route-dispatch includes a static corpus count. All remain mixed.
- Transport client/session-client combine direct guards/adapter tests with actual
  coordinator/context retirement and independent credential/session lifecycles.
  Split these cases, sometimes within one case, before unit admission.
- Recovery is one check-only adapter with fake send and pure parsing/reconcile
  implementation. Its registry call only prepares a capture fixture; the test
  does not settle/release or evolve a registry after the recovery result. This
  differs from runtime-to-registry ownership integration.
- Source-text/compiler architecture tests are static-contract. BFF closure
  fixtures are written/deleted on disk, so build-manifest is tool-integration.
- ConfirmDialog/InlineEdit test single-component controlled behavior.
  ConnectionGuard includes real SessionRecovery/auth-store collaboration, while
  UI semantics mixes component units with a CSS regex contract.

Complete trusted tracked inventory validation: exactly 700 expected errors
(326 unclassified, 325 missing targets, 49 mixed); no stale/missing paths, invalid
production targets or changed test digests. No application tests, network,
browser, full coverage or source/runner changes in this batch.

## Tooling/deployment classification batch
Read 25 additional full test files, including all remaining tests under scripts/
and apps/web/scripts/, the legacy artifact tests and 11 Python QA/runner tests.
Inventory remains 453: 301 unclassified, 57 unit, 63 mixed, 13 tool integration,
10 API integration, 5 static contract, 4 component integration (152 decided).

Five newly unit-classified files test EasyPanel object generation, Next config
values, canonical JSON/hash functions, TypedUnsafeBudget with route doubles, and
_asset_file_operation with a synthetic callback and in-process thread Events.
No deployment commands are executed by generator tests. Threads exercising one
async ownership helper are runtime scheduling, not a subprocess or real file I/O.

Coverage tooling names do not imply units: CLI fixtures execute Node/Git/c8 and
write manifests; config-node runs esbuild and loads generated output. configs
is mixed because importing coverage-quality.config actually scans scripts via
qualityToolingFiles, unlike pure coverageConfig and Next configuration values.
coverageEnvironment creates directories, so its fixture assertions are not pure
allowlist units. Canonical function tests do not invoke artifact inventory/Git.

Python historical runner mocks DB starts, sockets and process cleanup but uses
real scratch files/modes; it is mixed, not live DB acceptance. Browser context,
profile and tokenizer custody tests similarly exercise actual filesystem paths.
Recovered custody starts real synthetic processes/double-forks/subreapers, not
Playwright. Snapshot tests execute Git. SPA artifact tests mix pure predicates,
deployment source contracts and filesystem/parser process verification; neither
Docker images nor nginx/browser acceptance are claimed.

Full tracked inventory/digest validation has exactly 664 expected errors:
301 unclassified + 300 missing targets + 63 mixed. No unexpected path, target,
inventory or digest errors. No application tests or coverage measurement run;
source, denominator and runner remain unchanged.

## Short UI boundary review
Read all 12 proposed short tests plus providers presentation and design-contrast
files in full; inspected AppProviders, SourceDetails, CommonNavigation, its
connection hook/retained inspector, studio-store captureTurn/open and the legacy
NotebookHeader implementation. All current test bytes match recorded digests.

AppProviders replacement with a synthetic child is one context unit. The static
CommonNavigation case neither navigates nor enables a query (no transport,
palette false); wrappers and unused subscriptions do not imply integration.
captureTurn only validates/copies input through internal pure constructors into
a new store; reading coordinator.current supplies a scalar, unlike note-origin,
which actually begins a new session generation and asserts reader retirement.
NotebookHeader's internal InlineEdit does not cross an independent business
workflow; the update hook is replaced. B9 real route mounts remain integration.

14 files added: 9 unit, 2 mixed, 2 component integration, 1 tool integration.
Inventory 453: 287 unclassified, 66 unit, 65 mixed, 14 tool integration, 10 API
integration, 6 component integration, 5 static contract (166 decided). Validator
has exactly 638 expected errors: 287 unclassified, 286 missing targets, 65 mixed;
no unexpected path/target/digest errors. No application tests or coverage rerun.

## Python short/medium batch and next split targets
Read 25 additional Python files in full and inspected actual project_lock
(fcntl/file creation), personal-store key validation and lifespan control flow.
Inventory 453: 262 unclassified, 72 unit, 74 mixed, 19 tool integration, 14 API
integration, 7 component integration, 5 static contract (191 decided).
Validator: exactly 597 expected errors, 262 unclassified + 261 missing targets
+ 74 mixed; no unexpected paths, targets or changed digests. No app tests run.

Direct PasswordAuthMiddleware.dispatch with synthetic Request/call_next is unit,
unlike TestClient/ASGI endpoint files. Direct lifespan cancellation/migration
error paths have external work doubled and no server. Project lock tests really
open/flock disk files. Downloads use HTTP MockTransport but still commit disk
files. Metadata DB tests explicitly require a real disposable DB and migrations.
Synthetic CLI adapters in live_check still run a real child process. Template
checks exercise podcast_creator override-loader/variable compatibility, not a
model. No live service/provider calls were made while reviewing.

Small, concrete next splits (not performed in this classification-only batch):
1. tests/test_v1_personal_store.py: move
   test_store_rejects_unknown_kind_before_database and
   test_record_identity_stable_and_kind_separated to a unit-only file. Leave
   both flock/cancellation cases in filesystem integration.
2. tests/test_recovered_browser_readiness.py: isolate
   test_exact_success_response_rejects_wrong_method_origin_path_and_error; keep
   test_obsolete_ui_contracts_are_not_used as source/static-contract.
3. tests/test_v1_frontend_http.py: isolate first two CLI early guards and
   test_coupled_restart_order_and_fail_closed (including all parameters). Keep
   real static-chunk fixture probe and environment assembly separate.
4. tests/test_cors_credentials.py: move direct _parse_cors_origins and
   _cors_headers cases (TestExplicitWildcardAlsoDisablesCredentials and
   TestCorsHeadersHelperMatchesMiddlewarePolicy); keep registered middleware
   inspection and TestClient response outside unit-only file.
5. tests/test_v1_stream_contracts.py: direct SSE generator nodes
   test_exact_sse_wire and test_job_stages_repeat_and_transition_to_final can be
   isolated from test_transport_schema_has_no_fake_json_success. Preserve
   parametrized static stream fixtures and explicit memory-store/sleep doubles.

A split must move original assertions unchanged, retain collected case identities
via a before/after collection audit (parameter expansion included), update both
manifest digests/layers and tracked inventory, then measure only isolated units
against the unchanged full production denominator. Never duplicate assertions to
claim coverage, drop integration files, or merge old mixed coverage into units.
The global selector remains blocked until remaining unknown/mixed files resolve.

## Legacy short logical-unit review

Read 15 complete test files and their relevant production boundaries. Isolated
TanStack Query hook tests with mocked API/toast and a local library QueryClient
remain logical units; a provider name alone is not evidence of integration.
Source feature tests using actual WorkbenchSession/transport and application
flows remain component integration; the combined sources file remains mixed.
Static configuration regex checks remain static-contract. A CSS evaluator unit
reads an authored static fixture at module load but exercises pure calculations,
not a real browser layout. No tests or coverage were rerun for this review.

Current 460-file inventory: 91 unit, 71 mixed, 247 unclassified, 20 tool,
15 API, 9 component integration and 7 static-contract. Validator reports
564 expected unresolved/missing-target errors and no other defects.


## Python short/mid-size boundary review after 588aaf5

Read all 25 next shortest unclassified Python files and relevant shared fixtures /
production branches. Preserve the newer main classifications and hashes when
merging; no earlier manifest snapshot is substituted. Two files are confirmed
units (podcast selected snapshot and job-status batching); 5 API, 2 tool and 16
mixed files retain their actual independent boundaries. No test was executed
or coverage measured for this classification-only review.

A mocked output Path whose mkdir is a Mock is not filesystem integration.
Likewise, podcast listing uses empty snapshot model IDs and None/absolute audio
values: verified production early returns avoid database lookup and realpath /
exists. In contrast audio-path containment really uses os.path.realpath; ZIP
path input really opens an archive, even though its other cases use BytesIO.

Next low-risk splits with unchanged assertions:
- portable_zip: isolate only test_path_input_and_archive_comment as filesystem;
  retain remaining BytesIO parser cases as unit.
- podcast_path: isolate test_directory_can_be_created; UUID/DTO/config cases use
  no live filesystem or provider.
- error_message_sanitization: extract TestPodcastServiceDoesNotLeakExceptionText
  and TestTruncateErrorHelper, leaving TestClient cases intact.
- v1_source_snapshot_provenance: extract test_evidence_record_limit_is_opt_in_and_never_truncates.
- v1_model_acceptance_contract: keep real_grounded_service_public_fixtures_and_scope_switch
  integrated; direct evaluator policies can use the unchanged static suite.

After this batch: 460 files, 93 unit / 87 mixed / 222 unclassified / 22 tool /
20 API / 9 component / 7 static-contract. The validator remains fail-closed:
530 expected unresolved/missing-target errors, zero additional defects.


## Forty-file SPA and legacy review after the second split

Read the next 40 shortest unknown files completely, including long single-line
cases, and inspect relevant production hooks, transport, dialog, theme and
source-operation implementations. This batch adds 25 unit, 8 component, 6 mixed
and 1 static-contract classifications. No application tests, compilation or
coverage measurement ran during the review.

A local QueryClient and internal query hooks do not by themselves turn one
component or hook into integration: auth-polling has API doubles and synthetic
errors, NotebookLMPanel tests one controlled panel with fake API endpoints.
Conversely the wire-search hook uses actual API/transport composition, the
command observer settles a real independent library store, and source form /
rebuild tests intentionally use the independent document uncertainty latch.
These boundaries, not import counts, explain the different decisions.

Studio editorial tests only render supplied notes/job props: no save/run/observe
admission occurs, no transport is supplied, and no active editor exists. They
are units, unlike studio artifact async-download tests which retire the real
session coordinator during digest/settlement. Theme tests execute the production
bootstrap directly in JSDOM and the same appearance feature with synthetic
children; they do not access a real browser profile or business editor state.

Low-risk future splits (retain all existing cases and assertions):
- setup-navigation: separate safeSetupReturn parameter cases from actual router
  navigation between the two setup link components.
- global-contracts: extract the CSS source assertion into static-contract and
  preserve the full route/locale/search projection checks. One case mixes them.
- studio/artifacts: separate the real coordinator-retirement download/digest
  cases; many direct parsers, fake-transport byte checks and props cases remain
  unit candidates. The oversized-and-generation case needs a within-case split.
- workbench-responsive: separate the read/selection callback case from authored
  CSS evaluator contracts; never relabel CSS evaluation as real layout testing.
- sources/uploads: split generation/retirement and navigation-controller
  collaboration from direct capture/dedup/token/reconciliation tests.
- html-attachment: separate shared transport ingress rejection matrix from
  Studio-to-transport end-to-end byte compatibility cases.

Current isolated inventory: 465 files, 123 unit, 88 mixed, 182 unclassified,
26 tool, 21 API, 17 component and 8 static-contract. Validator reports 451
expected unresolved/missing-target errors and zero additional defects. The
strict full-project selector remains blocked; these counts are not coverage.


## Fourth forty-file follow-up (reviewed at a3877a2)

Reviewed all executable cases and fixture setup in the twenty shortest remaining
Python files and twenty shortest remaining non-Python files. Python AST display
omitted docstrings/comments only where useful; it did not filter test bodies.
Rechecked selected production boundaries: podcast audio None short-circuits disk,
SDK factory is replaced in the retry-options case, NotebookLM account locks use
the injected store, and source-dialog uncertainty hooks are replaced in the local
form test. No production/test code or coverage denominators changed.

Forty formerly unknown files: 11 unit, 17 mixed, 5 tool, 6 component and 1 API.
Current 465-file inventory: 134 unit, 105 mixed, 142 unclassified, 31 tool,
23 component, 22 API, 8 static. Validator emits 388 intentional unresolved/missing
-target errors and zero structural/hash/inventory errors. No application test or
coverage run was performed. These are classification counts, not measured unit
coverage; global selection remains blocked. Later selector tests/new main-tree
entries must be merged and reviewed separately rather than silently omitted.

### Exact low-risk split candidates (not yet moved or retested)

- `test_command_uncertainty_boundaries.py`:
  `test_automatic_note_embedding_still_preserves_saved_content` is direct unit;
  leave actual ASGI/retained-audio cases outside unit.
- `test_migration_integrity.py`: retain
  `test_evidence_vector_migration_is_registered_and_derived_only` outside unit;
  other direct migration cases use the exact production AST and fake DB. Their
  module-import coverage limit must remain explicit.
- `test_anthropic_compatible_provider.py`: retain
  `test_langchain_bridge_forwards_base_url` as SDK interoperability, move only
  the other direct functions with DB/DNS/HTTP/factory doubles.
- `test_v1_personal_enqueue_reconciliation.py`: retain
  `test_unchanged_queued_ack_loss_reports_unknown_without_reenqueue` (both
  acceptance parameters) as ASGI. Remaining service cases use memory/queue doubles;
  `test_store_snapshots_and_create_only_are_independent` tests the fixture itself
  and must never be claimed as new production coverage.
- `test_v1_personal_dispatch_receipt.py`:
  `test_receipt_persistence_error_is_not_a_durable_dispatch_receipt` (both commit
  parameters) can move to unit; OpenAPI/ASGI/archive interoperability remains.
- `test_v1_artifact_jobs.py`: retain
  `test_audio_completion_downloads_verified_asset_without_generating_again` as
  filesystem integration. The other job transitions use a fake bridge and memory
  store/async locks, not a database or file lock.
- `test_v1_notebooklm_sdk.py`:
  `test_pinned_config_disables_hidden_mutation_retries` replaces from_storage;
  actual SDK option DTOs are internal configuration values. Other cases exercise
  real profile-file existence/rewrite/removal and are not unit as a group.
- `test_connection_tester_offline_paths.py`: isolate
  `test_audio_fallback_is_valid_silent_pcm` and
  `test_audio_reads_only_supplied_fixture`. They specifically exercise real open
  failure/success, not merely consume an imported authored fixture. Provider
  status/response/type tests replace HTTP, pinning and provider instances.
- `test_podcast_audio_containment.py`:
  `TestResolveContainedAudioPath.test_empty_and_none_are_rejected` is direct early
  rejection. Do not move the whole class: symlink/custody cases require actual FS.
- `test_v1_launcher_environment.py` exact direct candidates:
  `test_fixture_environment_drops_host_credentials_and_disables_dotenv`,
  `test_readiness_fails_closed_on_timeout_or_process_exit`,
  `test_loopback_validation_rejects_wildcard_listener`,
  `test_http_probe_rejects_errors_and_disables_proxy`,
  `test_port_preflight_supports_restart_but_rejects_occupied_port`.
  Recheck helpers before moving; leave real config/log/chmod/dotenv compatibility
  and opted-in real descendant lifecycle in integration.
- `test_v1_notebooklm_chat.py` exact remote-only unit candidates:
  `test_remote_citation_outside_selected_scope_never_gets_local_locator`,
  `test_lost_chat_reply_never_reasks_on_same_idempotency_key`,
  `test_confirmed_chat_restart_finishes_from_saved_answer_without_reasking`,
  `test_pending_chat_rechecks_strict_capability_before_submission` (all params),
  `test_confirmed_chat_recovery_does_not_require_current_ask_capability`.
  Keep local-scope ingest/extract/mapping cases as file/parser integration.
- `features/studio/note-deletion.test.tsx`: move only
  `does not begin a DELETE after a matching editor became dirty or began saving`;
  real DELETE acknowledgment/controller retirement cases remain integration.
- `features/settings/model-owner.test.ts`: separate first
  `B9e acquires a single current models owner without selecting forms or navigation`
  (actual navigation/controller compatibility) from the three direct configuration
  source/handle transition cases.
- `features/settings/ownership.test.ts` direct candidates:
  `clears each private callback in its original epoch despite another callback throwing`,
  `rejects non-root, login, control, protocol relative and backslash cold-return destinations`,
  `reserves the sole selection writer and invalidates old revisions even through A-B-A`,
  `releases a link reservation only on actual never-dispatched proof, never generic failure`,
  `retains a foreign-epoch reservation without returning it as the new epoch writer`.
  Leave resource-navigation collaboration and parent-registry propagation into
  settings ownership separate. Stable context values are not automatically an
  independent session integration.

A single controlled component can remain unit with presentation children or
QueryClient machinery. AddSourceDialog.uncertainty replaces the mutation hook and
never drives the shared latch, unlike command-submission/RebuildEmbeddings review
cases that deliberately retain owner state across remount. TurnRecoveryPanel is
classified as producer/consumer trust integration here because the fixture creates
and settles a real registry-issued capability and the view checks rehydrated or
forged capability behavior, not just a plain display DTO. This boundary can be
narrowed only by an explicit independent review, not import counting.


## Fifth forty-file follow-up (reviewed at 39935e1)

Read all cases/fixtures of forty remaining frontend files. Dense compressed lines
were read fully; native-store/global-save were reread after output truncation.
Production checks included store reducers, retrieval consent/cache handling,
NotebookSettingsDialog parent/child admission, SSE delegation and setup mocks.

Added 15 unit, 13 mixed, 12 component. Current 465 files: 149 unit, 118 mixed,
102 unknown, 35 component, 31 tool, 22 API, 8 static. Actual validator reports
322 intentional unresolved/missing-target errors, zero other errors. No tests,
coverage or browser ran; production/test bytes and all denominators unchanged.
Pending selector files from another tree are deliberately not imported/classified.

Direct Studio/native-library store cases each control one logical store. Domain
operation/editor reducers and schema helpers are internal pure implementation,
not independent observers/controllers/transports. DraftRegistry only constructs
these stores here. NotebookSettingsDialog instead tests parent scope/unmount into
real NotebookLMPanel deferred admission; NoteEditorDialog.inline-title tests an
independently buffered InlineEdit against parent save settlement, then recovery.
QueryClient/import counts alone do not make integration.

### Exact split candidates (not moved/tested)
- sources/upload-recovery.test.tsx unit:
  `continues only proven-unsent captures after suspension, including an explicitly not-dispatched result`.
- sources/selection-refresh.test.tsx units:
  `rejects a workspace read that began before a new selection intent or before its settlement`;
  `never releases an unknown selection through a background workspace refresh`;
  `blocks transaction admission until an exact post-settlement workspace is accepted, rejecting older and wrong-link projections`.
- settings/advanced.test.ts: separate component case
  `Advanced participates in the existing resource guard without changing notebook SettingsDraft`.
  Other store/fake-send adapter/callback-driven observer/parser/value cases do not
  run store and observer together.
- library/classic-reference.test.tsx direct unit:
  `has explicit translated labels in every supported locale and preserves full opaque reference identity`.
  Final `native controls retain explicit labels, 44px control targets and monochrome tokens`
  itself needs source-CSS and mounted-DOM assertion separation.
- Legacy api/session-races.test.ts direct candidates:
  `review: legacy credential removal in another tab must stop sending the removed password`;
  `review: server supplied export paths must not select unrelated personal resource routes`.
- Legacy api/session-recovery-edges.test.ts token-only candidates:
  `review: a legacy login remains usable in memory if writes fail while reads still work`;
  `volatile legacy authorization is invalidated by another tab and by device purge`;
  `volatile legacy fallback yields to a changed persistent baseline`.
  Storage is isolated JSDOM, not a real user profile.
- RebuildEmbeddings.test.tsx candidate:
  `keeps definite validation failure localized and available for correction`.
  Verify isolated shared-latch setup first; remount/observation cases stay component.
- app/layout.test.tsx synthetic-slot unit cases:
  `keeps slot DOM and draft while reader opens and sections change`;
  `expands reading or answers without remounting live editors, then restores side-by-side`;
  `does not advertise reader focus before any document is open`;
  `reveals a new citation without replacing the draft or reader slots`;
  `isolates the narrow reader and moves background focus inside on resize, restoring prior inert state`.
  Keep source CSS static and renderApp router/provider cases component.
- Legacy font-delivery.test.tsx:
  `emits exactly three real SSR preloads (equivalent prior hints: %s)` (two params)
  can be a component unit after moving unrelated existsSync source guard. Bytes,
  license, layout and CSS remain static delivery contracts.
- app/route-coverage.test.ts direct unit:
  `does not count pending or implemented placeholders as completed coverage`.
  Source-document/table conformance remains static, never browser acceptance.
- Legacy api/evidence.test.ts and api/workbench-contract.test.ts combine wire
  projection, actual context-retirement/browser-adapter cooperation and expectTypeOf
  inside runtime nodes. Separate static types; runtime green does not prove types.
- TurnOperationProvider.test.tsx static:
  `is nested inside I18nProvider and outside ConnectionGuard in the actual root layout`.
  Remaining real provider/registry/context lifecycle stays component; synthetic
  Consumer does not substitute the actual registry.


## Ninth detailed classification batch (40 remaining SPA/legacy files)

Reviewed against parent manifest HEAD 49cc98a in the isolated classification tree.
All 40 complete test bodies, including compressed one-line cases and parameter
matrices, were read. Truncated output was reread before classification. Production
SnapshotPromotionButton/useSourceSnapshot, JobsPanel, PortableControls,
SemanticIndexPanel, useWorkbenchUploads/useNotebookChat, auth-store,
browser-transport and config GET boundaries were traced where necessary.
No application tests, browser, network, coverage run or production change occurred.

This batch is 11 unit, 17 mixed and 12 component-integration files. It leaves
465 files: 160 unit, 135 mixed, 47 component, 31 tool, 22 API, 8 static and 62
unclassified. Full inventory/hash validation has 259 expected unresolved/missing
classification errors and zero unexpected errors. Pure-unit gate remains blocked.
Existing test paths, bytes, production denominator and selector are unchanged.

### Important boundary decisions

- JobsPanel, SnapshotPromotionButton, PortableControls and useNotebookChat are
  logical units with external APIs replaced. Real QueryClient, thin mutation/query
  helpers, pure classifiers and local digest are implementation, not reasons for
  automatic demotion. Snapshot remount recomputes a key; it does not consult a
  separately owned unresolved-operation registry. Portable tests never open ZIPs.
- Config GET is called directly using synthetic NextRequest/env, not an HTTP app.
  Local origin/config predicates do not make it an API integration test.
- personal-transport explicitly verifies API wrappers through the real shared
  Axios interceptors/auth policy/multipart transformation boundary, replacing only
  the final adapter. It is component integration, not actual network/API-server IO.
- Full library/podcast/native-chat/global-search routes use real controller,
  registry, query, transport and navigation collaborations. Mocking fetch does not
  make these pure units. Reader geometry is synthetic, never visual acceptance.
- Merely constructing a library/transformation store via createDraftRegistry or
  making pure domain reducer values does not make a test integration. Explicit
  navigation leases, cross-resource retirement and auth protocol collaboration do.

### Exact mixed split candidates and exclusions

These are review candidates, NOT a node-selector authorization. Preserve original
assertions/parameters and separately re-audit setup before moving cases.

- use-workbench.test.tsx: direct queue/error/polling cases can be units. Keep
  `retires queued dispatch and late acknowledgement after %s changes` privacy,
  target, auth and readiness parameters, plus privacy in
  `does not rebind a retained selection handler after %s changes`, integrated.
  Notebook-only parameters can be separated with the same local hook boundary.
- configuration-contracts.test.ts: isolate
  `B9c both navigation lookups recognize selected configuration resources and stale retained confirmation`;
  remaining direct store/parser/fake-send adapter/locale-value cases are candidates.
- compatibility.test.tsx units:
  `evaluates real BFF and authenticated API evidence independently` and
  `rejects affirmative malformed evidence rather than trusting contract-name strings alone`.
  Keep handshake, readiness events, navigation and UI recovery collaborations.
- browser-transport.test.ts: keep
  `direct SSE sends one private POST with signal, cookie/CSRF and redirect rejection`
  as search-adapter/shared-transport compatibility; also separate
  `a custom AbortSignal reason stays cancellation, not an auth or service outage`
  with its real coordinator subscriber. Direct classifiers/request-policy/error
  branding/token checks are unit candidates; synthetic storage is not a real profile.
- studio/notes.test.tsx: direct store/adapter cases are candidates, but isolate
  `shows conflict and controlled draft without an automatic save or reload` and
  `keeps %s strict despite optional-null equivalence` (all 17 patches), which feed
  independent producer/projection outputs into real consumer components/store.
- locales/index.test.ts: key/placeholder imported-value checks can be unit;
  `all en-US leaf keys should be referenced in source files` stays static.
- reader/reader.test.tsx: isolate
  `retires pending reads on session generation change` and
  `hides already-loaded protected content after session retirement` as actual
  coordinator/context collaboration. Direct navigation predicates and otherwise
  single ReaderPane cases with fake send/geometry remain unit candidates.
- library-state.test.ts direct-store candidates:
  `terminal partial receipts remain immutable and require a separate new editor intent`;
  `canonical resource ownership ignores object property order`;
  `late original acknowledgments stay locked after a readiness uncertainty`;
  `I1 recovery cannot issue a current intent in an explicitly retired epoch`;
  `I1 fresh recovery never unlocks or copies %s operations` (both parameters);
  `I1 fresh ownership rejects late edits to the unchanged retained record`.
  Other cases deliberately test registry/navigation/coordinator cooperation.
- transformation-store.test.ts: isolate
  `registers transformation dirty and unknown state in both navigation lookups without weakening retrieval dirty`;
  other direct transformation-store cases are unit candidates.
- StudyWorkbench.reader-navigation.test.tsx remains component integration; last
  `wraps the full long source identity and quote after following a citation into the reader`
  mixes source-CSS rule assertions with the journey. Move those static assertions
  without dropping the actual reader/selection checks.
- app/navigation.test.tsx direct registry candidates:
  `separates notebook/editor sessions and retires epochs without losing retained File identity`;
  `exposes retired context even when no draft was ever created`.
  Other navigation/controller/registry and real Router dialog cases remain integrated.
- markdown-editor.test.tsx: theme-store/editor and real third-party preview/plugin
  security/feature compatibility remain integrated. The list-marker case also reads
  project/vendor CSS; separate static portions, not a blanket unit approval.
- auth-store.test.ts direct failure-path candidate:
  `does not read/send passwords until config establishes an explicit legacy mode`.
  It exits at mocked config failure, unlike the real auth API/coordinator handshake,
  token retirement and QueryObserver recovery exercised by other cases.
- NoteEditorDialog.test.tsx: earlier direct editor/API-double cases are candidates;
  keep `retains notebook note predecessor and draft for a manual retry after %s`
  (both outcomes) and `retains unknown-save reconciliation after reauthentication instead of silently resubmitting`
  as real SessionRecovery/auth-store/editor collaboration.
- CredentialFormDialog.test.tsx: isolate
  `visibility_action_is_localized (%s)` (14 locales) and
  `language_change_updates_the_visible_and_accessible_action` as actual
  i18next/resources/React compatibility. Other controlled masking/callback cases
  may use a fixed translation environment without testing independent language change.
- SemanticIndexPanel.test.tsx: isolate
  `fences a late submission receipt across privacy invalidation` as actual
  context-subscriber/panel collaboration. Other direct single-panel API-double,
  controlled-cache and props scenarios are unit candidates, not real provider tests.
- SessionRecovery.test.tsx: isolated explanatory label/password/callback views are
  candidates; keep DashboardLayout editor/File preservation, cold navigation and
  cross-dialog focus recovery interactions separate. Do not select the whole file.


## Tenth detailed classification batch (three legacy boundary files)

All three complete test bodies were read, including parameter tables and fixtures; production imports and calls were checked. This bounded batch releases the worker without starting another review or test run. All three remain mixed, not approved unit files. Existing test bytes, inventory and production denominator are unchanged.

Next precise split candidates:

- `frontend/src/lib/config.test.ts`: separate the `turn target config-flight boundary` describe block, particularly `suspends on reset, preserving same-target identity through failure and recovery`, `publishes a changed target before awaiting its readiness and retires A to B to A`, and the four `a superseded A %s flight cannot publish or return usable config after B` variants. These exercise the shared context protocol. The final invalid-target table can stay a configuration unit candidate; do not mechanically move every case just because it shares a describe. Other fake-fetch parser/priority/ingress cases can be reviewed as direct unit behavior.
- `frontend/src/lib/api/session-proxy-policy.test.ts`: move `covers every static current apiClient operation without widening unsupported model GET` to static-contract coverage. In `allows reviewed $method $template as $kind`, preserve every parameter and separate the OpenAPI membership assertion from direct route-policy assertions rather than deleting it. Header, configuration, malformed route and legitimate-ID tables remain direct pure-policy candidates.
- `frontend/src/lib/workbench/turn-reconciliation.test.ts`: move `types retained citation/evidence support metadata as nullable boolean, not corroboration proof` to static-contract checks. Keep the seven `binds a verified %s parent with no canonical turn, making recovery check-only` variants as component integration, or split their direct reconciliation assertions from the real registry settlement/retry assertions without losing either. Other projection cases only consume fixture values; constructing those with a registry does not itself prove an independent workflow collaboration.

Validation: 465 manifest paths and all test hashes preserved; 3 unknown entries became mixed, leaving 59 unknown. Full-inventory validation returned 256 expected unresolved/missing-target blockers and zero unexpected errors. No application tests or coverage were run, and no pure-unit coverage increase is claimed.


## Web discovery provider boundary review

`test_web_discovery_provider.py` is unit: the real adapter's outbound HTTP boundary
is replaced with `httpx.MockTransport`; tests use no ASGI application, listener,
DNS lookup or SDK client interoperability. URL validation is metadata parsing, not
remote resolution. Keyless mode forbids secret lookup, unconfigured mode clears
key/file environment inputs, and configured tests inject synthetic credentials.
The suite exercises production bounded response parsing, fixed-origin policy,
metadata normalization and cancellation rather than testing only mock calls.
