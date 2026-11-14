# Frozen quality checkpoint: 006831f

This is a mixed-test diagnostic, not a strict unit-coverage acceptance report.
The exact source revision is `006831f0c6ce0c4465eb1709f70507b984795fb9`.
Subsequent test-only or production changes require fresh validation.

## Scope and execution

- Python: 179/179 production files, no missing/unexpected files; 4,484 passed,
  128 skipped, no test failures. Coverage gate exited 1: lines 75.12%, branches
  70.15%, combined 73.99%. Skips require explicitly owned disposable services.
- JavaScript/TypeScript: all 11 partitions completed, 560/560 production files,
  no missing/unexpected files. Every partition source and input digest remained
  unchanged. Eight partitions passed; transport, BFF and SPA each had one
  5-second integration timeout. These failures are retained, not waived.
- SPA: 1,402 passed, one timeout; statements 90.39%, branches 86.20%, functions
  92.64%, lines 91.55%. Legacy frontend: 2,203 passed, statements 65.66%, branches
  67.48%, functions 56.24%, lines 64.88%.
- Reports came from the same frozen revision. LCOV normalization changed only
  source path prefixes; Python XML normalization changed only its source root.
  Original reports and per-file source hashes remain in private audit storage.

## Local Sonar outcome

Scanner exited 0 and compute task completed successfully for this revision.
This means analysis completed, **not** that the quality gate passed.

- Overall maintainability/security/reliability ratings: A / D / D.
- Overall imported mixed coverage: 77.0% (line 76.6%, branch 77.6%).
- Security-impact issues: 9; reliability-impact issues: 34.
- Gate: ERROR. Required overall coverage is 90.01%; security and reliability
  issues must be zero. Three new violations also fail the existing gate.
- No thresholds, profiles or rule settings were relaxed for this scan.

## Remaining acceptance work

Keep pure logical units, component/API/CLI integration and static source checks
separate. The current versioned classification is incomplete and must not be
advertised as a complete strict-unit baseline. All production roots remain in
coverage denominators. Investigate integration timeout costs before changing
budgets; preserve upload payload, EOF, byte equality and failure propagation.
Review flagged filesystem guards independently rather than suppressing them
just to pass. Existing ciphertext compatibility remains required; no v2 rollout
or credential migration was performed. This checkpoint does not authorize
merging or deploying the candidate.
