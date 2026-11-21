# Python reviewed-unit and mixed regression at 90315ef

## Scope and changes

Added 21 canonical read-cache units, 10 portable snapshot units and 26 restore transaction units. Moved 85 existing enqueue/projection cases into isolated unit files without changing their assertions, parameters or test ASTs; downstream imports were audited and retained ASGI/file workflows were tested separately. The only production change rejects malformed transaction acknowledgments as unknown before interpreting any explicit ERR as rollback. Fifteen failing synthetic ACK tests established the bug; two added actual archive import/file-boundary cases establish restored originals remain after unknown acknowledgment. This does not prove real SQL commit/rollback or completeness of a truncated all-OK response. Independent reviews accepted the new units and minimal fix.

## Reviewed logical unit diagnostic

100 selected Python unit files: 2200 passed, no failures/skips, one existing dependency warning, 80.98 seconds. All 180 tracked production Python files included, no missing/extra sources, 56 existing excluded lines unchanged. Lines 12003/23902 = 50.2176%; branches 2755/6998 = 39.3684%; combined 14758/30900 = 47.7605%. Native exit 1 preserves the unmet 90.01 threshold. Relative to a04a6a5, covered lines +193 and branch arcs +98; the minimal ACK guard adds two statements/two branch arcs to the complete denominator.

This is explicitly a reviewed subset diagnostic, not the formal complete all-project gate. Classification retains 164 unresolved mixed files; the initial external orchestration stopped on those errors, then permitted only that exact known category for this diagnostic. No production gate or threshold was relaxed.

## Full mixed Python suite

5275 passed, 128 skipped, no failures, two existing dependency warnings, 189.84 seconds. Database/runtime opt-in was not enabled; skipped cases are not passing evidence. Lines 18155/23902 = 75.9560%; branches 5047/6998 = 72.1206%; combined 23202/30900 = 75.0874%. Native exit 1 is the coverage failure. These mixed values must not be substituted for unit coverage.

Both runs were serial and retained original commands, logs, native exits, coverage data and before/after tracked-input hashes in private evidence under python/frozen-90315ef. Frozen HEAD and all tracked inputs remained unchanged. No deployment, migration, real user data, public push, Sonar pass or CI pass is claimed.
