# Reviewed Python unit diagnostic: b060e61

Not a complete strict-unit gate: remaining unclassified/mixed files still block formal selection. No integrated/browser cases are counted in this measurement.

- 70 reviewed, SHA-bound unit entrypoints; 1,359 passed, no skips/failures, one existing third-party warning; 82.65 seconds.
- Complete 180/180 tracked production Python files, zero missing/extra paths.
- Lines: 9,634 / 23,902 = 40.3063%.
- Branches: 1,829 / 6,996 = 26.1435%.
- Native combined: 11,463 / 30,898 = 37.0995%.
- Native pytest/coverage exit 1: unchanged 90.01% threshold was NOT met.
- Existing 56 native exclusions unchanged. Full tracked input hashes and HEAD stayed unchanged during measurement.

Relative to b219fcb, the same 180-file and line/branch denominator now includes the AST-preserving cutover planner unit split: 1,146 more covered lines and 444 more covered branches. This is newly isolated measurement of existing assertions, not a claim that 128 new behavioral cases were invented.

Evidence directory: `python/reviewed-unit-subset-b060e61/` in the private quality evidence archive, including argv, raw data/JSON, log, native exit, input hashes and exact inventory audit. No production data, deployment or migration was used. This local diagnostic does not establish CI or Sonar acceptance.
