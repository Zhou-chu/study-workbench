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
