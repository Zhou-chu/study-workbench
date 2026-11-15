# Notebook collection and source insight checkpoint

Frozen verification revision: d5911d6. No deployment, migration, real data or
provider operation is part of this checkpoint.

## User-visible reliability and unit boundaries

A red unit proved that a stored notebook lacking an archived key appeared as
unarchived without filtering but disappeared under the unarchived filter. The
one-line fix uses the same missing-key default in both places. Explicit null
behavior is unchanged. The new 26 collection units exercise direct functions,
real request/response models and sort validation, with persistence replaced.
Related pre-integration regression: 56 passed; exact-file mypy and Ruff passed.

Another 21 units exercise source insight generation/read/delete decisions,
replacing persistence and enqueue boundaries. They do not prove durable queue
execution, actual deletion or HTTP authentication. The existing 21 literal
content-detection tests move unchanged out of the tokenizer/splitter file; all
class/helper ASTs and all 34 before/after cases are retained. The remaining 13
cases are component integration, not pure units. See the separate scope notes.

## Frozen full-denominator evidence

- Full offline Python: 5705 passed, 128 skipped, two warnings, seven failures,
  158.34s. The exact seven historical database-runner temporary-parent custody
  failures match the preceding checkpoint. Their names remain recorded in
  core-security-classification-checkpoint.md. No guard/permission bypass.
- Reviewed unit subset: 129 files, 2747 passed, one dependency warning, 136.47s.
  Native receipt contains 2747 cases and 8241 phases, zero deselection and zero
  collection failures. This is not acceptance of the still-incomplete strict
  classification gate.
- Full 181 production Python files: 24,027 statements and 7,036 branches; 56
  unchanged existing excluded lines. Source hashes match before and after.
  Lines 13,003/24,027 = 54.1183%; branches 3,143/7,036 = 44.6703%; native combined
  51.9782%. The unchanged 90.01 gate exits 1. Raw union increases by 146 lines
  and 53 branch arcs against the preceding maintenance-stage subset. No summed
  module percentages or omitted production tooling.
- Full Ruff and format pass. Full mypy remains 201 errors in 36 files, 480
  checked files. No ignore, Any escape or relaxed gate was added.
- Classification: 566 entries, 251 unit, 154 mixed, 69 component integration,
  56 tool integration, 28 API integration and eight static contracts. Every
  manifest file hash was checked before the frozen run.

Original logs, XML/JSON, coverage data, source and execution receipts, and the
reproducible runner are retained outside the checkout. Public exact CI is
revision-specific and must be checked separately before any acceptance claim.

Workspace lint/typecheck and legacy frontend lint/tsc all exit 0 against the
frozen source. Legacy lint retains seven warnings; no browser acceptance is
claimed. Shared UIdesign bytes remain unchanged.

## Follow-on: retrieval and saved results (frozen 0a247b1)

The next batch adds 28 lexical retrieval/original-file decision units and 25
saved-insight/note lifecycle units. Retrieval uses real scoring, ranking and
citation logic with copied synthetic store records; file path, existence and
thread/read boundaries are doubles. Its constructor is bypassed deliberately,
so this is not actual filesystem integrity or constructor acceptance. Notes use
real models/save/read orchestration with query, repository CRUD and enqueue
boundaries replaced. Neither batch changed production behavior or demonstrated
a new defect. They do not establish actual durability, deletion or model calls.

Before integration, focused related regressions passed 80 and 65 cases;
exact-file mypy, Ruff and formatting passed. No previous tests were removed.
After integration:

- Full offline Python: 5758 passed, 128 skipped, two warnings, the same seven
  historical temporary-parent custody failures, 170.76s. Exact failure names
  were compared against the preceding checkpoint; none were hidden or bypassed.
- Reviewed subset: 131 files, 2800 passed, one dependency warning, 143.47s.
  Native receipt: 2800 collected cases, 8400 phases, zero deselection or
  collection failures. Complete strict classification is still unfinished.
- Unchanged 181-source denominator: 24,027 statements, 7,036 branches and 56
  existing excluded lines. Source hashes stable before/after. Lines
  13,073/24,027 = 54.4096%; branches 3,178/7,036 = 45.1677%; native combined
  52.3163%. Unchanged 90.01 gate exits 1. Raw union gains 70 lines and 35 arcs
  against the preceding notebook/source checkpoint, not a sum of module rates.
- Full Ruff/format pass. Full mypy remains 201 errors in 36 files, 482 checked.
  Manifest 568 entries: 253 unit, 154 mixed, 69 component, 56 tool, 28 API,
  eight static. All file hashes checked before measurement.

These results are kept with original coverage/receipt/log data outside the
checkout. They do not turn the earlier or next public CI into a passing strict
quality gate. No main merge, deployment, real data or encryption migration.

The follow-on workspace lint/typecheck and legacy frontend lint/tsc also exit 0;
legacy lint still has seven warnings. No browser or product service was started.

## Follow-on: source creation and archive import (frozen 4de0458)

Adds 25 source-creation helper units and 25 portable import/project-read units.
Real Source/Asset/command request/response models, remapping and record assembly
remain. Persistence, queue binding, thread execution and virtual file/staging
boundaries are replaced. The source tests establish intent and sequencing, not
actual durability. Command-module bootstrap performs existing registration and
environment setup; isolated helper calls do not prove arbitrary cold-import
side-effect freedom. Portable cases distinguish confirmed failure cleanup from
unknown commit retention without claiming real disk or transaction acceptance.
No production behavior changed and no new business defect was demonstrated.

Before integration, related regressions passed 71 and 273 cases (the latter has
one existing skip). Exact portable-test mypy passed; source-test mypy retained
only four existing imported SDK errors. Ruff and format passed for both.

Frozen aggregate results: full offline Python 5808 passed, 128 skipped, two
warnings and the exact same seven historical temporary-parent custody failures,
170.62s. Reviewed unit subset: 133 files, 2850 passed, one dependency warning,
149.01s. Native receipt has 2850 cases/8550 phases, zero deselection or collection
failures. The complete strict-classification gate remains unfinished.

All 181 production files remain included: 24,027 statements, 7,036 branches,
56 unchanged existing excluded lines, stable before/after source hashes.
Lines 13,154/24,027 = 54.7467%; branches 3,198/7,036 = 45.4520%; native combined
52.6414%; original 90.01 gate exits 1. The measured union gains 81 lines/20 arcs
against the preceding retrieval/saved-result subset, not summed module coverage.
Full Ruff/format pass; mypy remains 201 errors in 36 files, 484 checked.
Manifest 570 entries: 255 unit, 154 mixed, 69 component, 56 tool, 28 API, eight
static; all hashes validated before the run. Raw logs/coverage/receipts remain
outside the checkout. No main merge, deployment, real-data mutation or migration.
Workspace lint/typecheck and legacy frontend lint/tsc also pass for this frozen
source; seven legacy lint warnings remain. No browser acceptance was executed.

## Follow-on: grounded answering and source lifecycle (frozen 15f1197)

Adds 26 grounded-turn and 28 source-lifecycle units. Real turn construction,
message budgeting, injected-model generation handling and response decisions
remain. External evidence/retrieval services, storage and project locks are
replaced. Cases exercise scope/receipt reuse, follow-up clarification, empty
retrieval, bounded outlines, invalid citations and cancellation/failure results.
They do not prove actual retrieval quality, LLM accuracy or durable transactions.
The final scope-check error is deliberately reconstructed by production; tests
assert domain rejection there, not false exception-identity preservation.

Source cases retain real retry/status/model logic, replacing persistence,
attempt ownership protocol, queue, status methods and file-support checks. They
verify original input reuse, unresolved/active task refusal, uncertain submission
identity and cancellation; no actual file, queue or worker-termination acceptance.
No production behavior changed or new reproducible defect was demonstrated.
Focused related suites passed 74 and 108 cases; exact-file mypy/Ruff/format pass.

Aggregate evidence: full offline Python 5862 passed, 128 skipped, two warnings,
the same seven historical temporary-parent custody failures, 149.93s. Reviewed
subset: 135 files, 2904 passed, one warning, 133.65s; 2904 collected cases and
8712 native phases, no deselection or collection failures. Whole strict
classification remains unfinished and no integration cases were relabeled.

Unchanged 181-source denominator: 24,027 statements/7,036 branches, 56 existing
excluded lines, matching source hashes before/after. Lines 13,303/24,027 =
55.3669%; branches 3,259/7,036 = 46.3189%; native combined 53.3175%; unchanged
90.01 threshold exits 1. Actual union gains 149 lines/61 arcs over the prior
source/import subset. Full Ruff/format pass; mypy remains 201 errors in 36 files,
486 checked. Manifest 572 entries: 257 unit, 154 mixed, 69 component, 56 tool,
28 API and eight static; all hashes checked. Original reports are external.
No main merge, desktop access attempt, deployment, real-data change or migration.
The frozen workspace lint/typecheck and legacy frontend lint/tsc also exit 0;
legacy lint retains seven warnings. No browser or live application was started.

## Follow-on: actual reader contracts and QA failure handling (frozen f7d598f)

Three new API/file/parser integration scenarios cover a revised source with exact
historical Unicode citation/reader output, and a missing or same-length-corrupted
original. Downloads reject unavailable originals; retained extracted text is
still independently readable. Restoring original bytes and extracting again
preserves the older citation. These run real ingest/extract/HTTP logic with
synthetic temporary files and memory persistence. They are not strict units or
browser/PDF-rendering acceptance. Two initial test failures reflected an incorrect
expectation that extract swallowed its error; corrected tests assert the actual
exception and retained failed-extraction record, not a manufactured product fix.
The whole evidence-route file passes 52 cases.

The model-setup QA helper had a real owned-process cleanup contract gap: tar
failure/interruption bypassed archive pipe closure/reaping. Four original red
cases became green after extracting an owned-handle helper, checking the pipe
and replacing an assert-only exit check with a runtime error. Independent review
then found that cleanup failures could mask the original error. Six additional
poll/kill/wait failure cases were red before the correction and green after it.
Only the owned Popen is stopped; exception cleanup waits at most 15 seconds and
preserves the original exception with a fixed, non-sensitive note when cleanup
cannot be confirmed. Normal tar execution and successful-producer wait still
have no new timeout; this is not universal hang recovery. No real subprocess or
browser is launched by these tests. Seventeen AST/file-based tool-integration
cases exercise exact helper/response definitions; related regression passes 58.
The synthetic response-body Mapping/Sequence annotation leaves its executable
AST unchanged. No Any/ignore or quality-gate relaxation was introduced.

Final full offline Python: 5882 passed, 128 skipped, two warnings, the same seven
historical temporary-parent custody failures, 162.95s. Reviewed pure-unit subset
is deliberately unchanged at 135 files and 2904 passed, one warning, 168.20s.
Native receipt: 2904 collected cases/8712 phases, no deselection or collection
failure. None of the 20 new integration cases contribute to this strict subset.

Full production scope remains 181 files. Actual helper growth increases the
denominator to 24,045 statements and 7,042 branches; 56 existing exclusions are
unchanged and before/after source hashes match. Lines 13,303/24,045 = 55.3254%;
branches 3,259/7,042 = 46.2795%; native combined 53.2763%, original 90.01 gate
exits 1. Coverage percentages decrease slightly because new integration-tested
helper code remains in the strict denominator. No scope was removed to hide it.

Full Ruff/format pass; full mypy improves from 201 to 199 errors in 36 files,
487 checked. The QA tool itself improves from 75 to 73; unrelated global-name
and historical issues remain visible. SDK optional-handle diagnostics are
unchanged because that work overlaps protected private progress. Manifest 573
entries: 257 unit, 154 mixed, 69 component, 57 tool, 28 API, eight static; all
hashes validated. Initial and corrected full-run evidence are both preserved
externally. No main merge, deployment, real-data mutation or desktop attach.
The final workspace lint/typecheck and legacy frontend lint/tsc also exit 0;
seven existing legacy lint warnings remain. Shared UI specification bytes are
unchanged. Live application/browser acceptance was not executed in this batch.
