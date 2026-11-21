# Core security decisions and lossless classification checkpoint

Frozen test revision: `13a68d1`. This adds 28 direct middleware decision cases,
retains all 10 original SSL/reader cases while moving seven to reviewed units,
and supplies the real FastAPI application object to two lifespan contexts
instead of passing None. No production behavior or coverage inventory changes.
The three cancellation cases pass before and after; exact-file mypy loses both
argument-type diagnostics and retains four imported SDK optional-handle errors.
No SDK change, ignore, cast, weakened threshold or migration is included.

Independent review approved the direct middleware boundaries, lossless function
AST/parameter/fixture preservation and classification. All 556 manifest entries
have matching hashes and existing targets. There remain 156 mixed files: this
is not a complete strict-unit gate. The 28 middleware cases do not establish
whole-application authentication, proxy handling or credential custody.

## Frozen verification

- Full isolated Python: 5567 passed, 128 skipped, two warnings, seven failures
  in 125.04s. The failures remain the historical database runner's temporary
  parent custody precondition on this cloud host, before database startup.
  Tests: temporary_root_ignores_ambient_path; sigterm_during_readiness_cleans_owned_database;
  sigterm_while_waiting_cleans_test_child_and_database; normal_test_exit_uses_owned_cleanup;
  each_run_has_private_matching_password_without_command_line_leak;
  child_temporary_custody_matrix; real_allocator_and_normal_child_environment_under_permissive_umask.
  All are in `tests/test_historical_database_runner.py`. No host permission or
  safety-policy change was made to conceal them.
- Reviewed Python unit subset: 121 files, 2593 passed, one warning, 111.73s.
  Native execution evidence contains 2593 collected cases and 7779 phases,
  no deselection or collection failure. This subset is NOT complete strict acceptance.
- Full production denominator: exactly 181 files, 24,026 statements, 7,036
  branches and 56 pre-existing excluded lines. Source hashes match before/after.
  Lines 12,663/24,026 = 52.7054%; branches 3,016/7,036 = 42.8653%; native combined
  coverage 50.4765%, retaining exit 1 against 90.01. Compared with the prior
  frozen reviewed subset at d26b3fe, the raw union gains 49 lines and 25 arcs.
  This cumulative change includes earlier revalidation/note units and the
  classification migration; it is not attributed solely to the 28 new cases.
- Full Ruff check/format pass. Full mypy remains exit 1: 211 errors in 37 files,
  470 files checked, down from 213 errors before the lifespan fixture correction.

The preceding public `372e55d` hosted run 43676302360 is completely archived:
mixed succeeded (5546 passed, 128 skipped, 11 JavaScript partitions successful),
static failed on Python types while the previously skipped frontend commands
actually ran and succeeded, and strict failed closed on 158 then-unresolved
mixed files. Those results do not certify this newer candidate. Exact new
hosted CI must be checked separately after publication.

Evidence and reproducible runner are retained outside the checkout. No real
notebook data, deployment, main merge or encryption migration was performed.

Local exact frontend static commands also pass: workspace lint/typecheck and
legacy lint/tsc all exit 0; legacy lint retains seven warnings. No browser or
application service was started.
