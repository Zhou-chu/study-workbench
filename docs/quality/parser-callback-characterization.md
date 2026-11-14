# Explicit parser callbacks: preventive maintenance

Baseline 006831f0c6ce0c4465eb1709f70507b984795fb9. parseSourceVersionView and
parseTurnView each accept one argument and call their schema with that argument
only. Array.map's index was NOT being forwarded to Zod. This is not a demonstrated
behavioral bug or a bug-red/green fix. Explicit lambdas make this boundary clear
and robust against a future parser signature change.

Added real-schema adapter characterization: a two-version response preserves
identity/order and strips private extras; canonical recovery succeeds with the
matching turn in each of three positions among unrelated valid history rows.
The network boundary is replaced, not the parser or reconciliation implementation.

These tests passed on the old production implementation before the two lambda
changes, then passed again after. Existing BFF and legacy session-store tests also
passed unchanged. Final counts: {"bff": {"numFailedTests": 0, "numPassedTests": 43, "numTotalTests": 43, "success": true}, "legacy": {"numFailedTests": 0, "numPassedTests": 43, "numTotalTests": 43, "success": true}, "transport": {"numFailedTests": 0, "numPassedTests": 18, "numTotalTests": 18, "success": true}, "web": {"numFailedTests": 0, "numPassedTests": 6, "numTotalTests": 6, "success": true}}.
All runs used maxWorkers=1, source aliases pointing into this isolated tree, and no
coverage exclusion changes. No full suite, typecheck/build or Sonar scan was run.

Initial test-authoring corrections are disclosed: the first recovery fixture added
an unknown property to history and incorrectly expected success; the real schema
correctly preserved unsafe projection and reconciliation refused completion.
The fixture was corrected to valid rows before the old-version green baseline.
The first legacy harness omitted Vitest globals and failed during setup; restoring
the repository's globals setting resolved it. Neither failure was a production bug.
Original failed logs and successful reports remain in external review evidence.

The two S4822 issue dispositions remain unchanged; see the separate review.
