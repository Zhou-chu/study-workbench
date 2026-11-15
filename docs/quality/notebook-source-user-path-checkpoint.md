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
