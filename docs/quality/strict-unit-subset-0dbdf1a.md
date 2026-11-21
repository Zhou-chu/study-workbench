# Reviewed strict-unit stage: 0dbdf1a

77 reviewed Python unit files executed: 1,567 passed, no skipped/failed tests, one existing third-party warning, 78.14s. All 180 production Python paths are present; tracked input hashes and frozen revision stayed stable. The native 90.01 threshold remains unchanged and returns exit 1.

- Lines: 10,404 / 23,902 = 43.5277%.
- Branches: 2,090 / 6,996 = 29.8742%.
- Combined: 12,494 / 30,898 = 40.4363%.
- Existing native exclusions: 56, unchanged.

Relative to 2f68bbf (same source/line/branch denominator), 426 more lines and 94 branches are covered. This includes 18 additional session-rejection and 32 indexing-state cases plus 31 original native-transaction cases isolated without changing their assertions. It is not a formal complete unit selection: mixed test files remain unresolved and shell/unproven mapping boundaries still block the aggregate. No threshold or production source exclusion was relaxed.

Reader split independently passed all 56 original/new cases (22 isolated reader units, 34 retained mixed), 3.44s. The new helper was initially placed inside the production inventory; review caught this before acceptance and moved it into the existing src/test area without changing exclusion rules. Actual legacy-web inventory remains 288 paths and the complete production source digest is unchanged. This is not real browser acceptance or whole frontend coverage.

Evidence: python/reviewed-unit-subset-0dbdf1a/ and node/reader-integrated-0dbdf1a/ in the private evidence archive. Prior mixed-suite coverage, remote CI and Sonar results are not replaced by these diagnostics. No user data, services, migration, deployment or public push were used.
