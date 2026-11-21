# Maintenance recovery, portable history and design navigation checkpoint

Frozen test revision: 9862e33. Adds 25 maintenance run/dispatch units and eight
portable visible-history units. The real decision logic is retained; storage,
locks, queue/parser, graph and thread boundaries are replaced. History units
explicitly replace the config module to prevent cold-import mkdir; they do not
rely on a warm cache or prove real SQLite/background-thread behavior. Independent
review accepted both unit boundaries. No production implementation changed.

The user-requested root UIdesign.md is a complete byte copy of the existing
shared-ui.md, SHA256 03be3db35fc583ce7fa3a4d13d046aa970c240da3c9602d1d10cfa33792125ad.
Two filesystem documentation contracts prevent copy drift and retain honest
navigation. They are tool integration, not unit or visual acceptance. DESIGN
only clarifies canonical links and the full-page/body glass prohibition versus
controlled overlay treatment. CURRENT_STATUS links existing inventories and
historical acceptance without creating a parallel feature ledger or declaring
runtime success. All ten local status links were independently checked.

## Frozen verification

- Full offline Python: 5658 passed, 128 skipped, two warnings, seven failures,
  156.06s. Exact failed test identities match the preceding snapshot checkpoint's
  historical database runner temporary-parent custody precondition failures.
  Their full names are listed in core-security-classification-checkpoint.md.
  No permission bypass, weakened guard, deletion or missing-source exclusion.
- Reviewed Python unit subset: 126 files, 2679 passed, one warning, 134.44s.
  Native receipt: 2679 collected cases, 8037 phases, no deselection or collection
  failures. Complete strict acceptance is still blocked, not inferred here.
- Full production scope: 181 files, 24,027 statements, 7,036 branches and 56
  unchanged existing excluded lines. Source hashes stable before/after.
  Lines 12,857/24,027 = 53.5106%; branches 3,090/7,036 = 43.9170%; native combined
  51.3376%. The unchanged 90.01 gate exits 1. Raw union gains 90 lines and
  36 arcs versus the preceding source-snapshot subset; no module-percent summing.
- Full Ruff/format pass. Full mypy remains 201 errors in 36 files, 477 checked.
  Manifest 563 entries: 248 unit, 155 mixed, 68 component, 56 tool, 28 API,
  8 static. All hashes/targets were independently verified before measurement.

Prior exact public b2c7a5d CI (43680508749) is fully archived: mixed succeeded
with 5630 Python passes/128 skipped and 11 complete JS partitions, static failed
on 201 mypy errors while its frontend step passed, strict failed on 155 mixed
files without running coverage children. This is previous-revision evidence;
new published CI must be checked separately.

Logs, original XML/JSON, raw coverage sets, source/selection/execution receipts
and reproducible runner are kept outside the checkout. No main merge,
deployment, user data mutation or encryption migration was performed.

Exact workspace lint/typecheck and legacy frontend lint/tsc also exit 0 locally;
legacy lint retains seven warnings. No browser or application service started.
