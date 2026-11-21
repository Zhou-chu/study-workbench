# EvidenceReader unit split

Base: `2f68bbf0b67b2d0339777cfc2a9f3a01c0499487`.

This test-only split moves 20 complete test-call AST nodes (22 expanded cases) to
`frontend/src/components/evidence/EvidenceReader.unit.test.tsx`. The remaining
27 nodes (34 cases) stay in the existing mixed file, including maintenance
submission/polling/refetch and authored CSS checks. No production source,
coverage denominator, threshold, timeout, assertion, parameter table, or
classification manifest changes.

The TypeScript compiler parsed and printed each complete original `it` / `it.each`
statement and compared the multisets against both destination files: all 47 are
identical. Vitest collection independently confirms 56 -> 56 expanded case names,
without omissions or duplicates. The accompanying JSON records both mappings.

`frontend/src/test/evidence-reader-fixtures.tsx` is non-collected and contains only the unchanged
render wrapper and synthetic version/citation values. It imports no test file,
maintenance component, CSS inspection helper, service or real data. API, PDF
canvas and translation doubles stay in each collected file. The original
EvidenceReader beforeEach/afterEach hooks are copied unchanged into the unit
suite. The standalone codepoint highlight case remains outside that describe,
retaining its original hook scope. The original maintenance describe and its
hooks remain in the mixed file. Real maintenance actions are not re-labelled unit.

## Verification

Using existing Node 24.19.0 dependencies, from `frontend/`:

- `node node_modules/vitest/vitest.mjs list src/components/evidence/EvidenceReader.test.tsx --json --maxWorkers=1` before splitting: 56 cases.
- Same list command with both original and unit paths after splitting: 56 cases.
- `node node_modules/vitest/vitest.mjs run src/components/evidence/EvidenceReader.unit.test.tsx --maxWorkers=1`: 22 passed.
- Same run command with both paths: 56 passed, no skipped or failed cases.
- ESLint on the three changed TSX files.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`.

No browser, server, database, provider, build or full-repository coverage run was
performed. Passing these tests does not imply the strict project coverage gate
passes. The parent owns classification updates after independent review.

## Inventory correction

The initial helper placement beside components was incorrectly included as production
by the unchanged legacy-web inventory. It is now under the existing `src/test/`
test-support boundary; no exclusion rule was changed. The complete legacy-web
source inventory and source digest are compared with an exact base Git archive,
not merely the changed-file list. Both match: 288 -> 288 files, no added/missing source, SHA-256 source digest
`317c7cca6faf2327cb0e48f118d8a99f70c0bdb5cea1b2f5077ef2d288d71f38`.
The full inventories are preserved in the external verification record; the
committed mapping records the summary and final file hashes.

After the helper move, the 56-case suite and zero-warning lint were rerun. An
initial typecheck lacked the root dependency link and reported TS2307 for
`vitest/config` in `scripts/coverage-config.ts`; that failed log is retained.
Typecheck requires both the prepared frontend and root dependency trees, as in
the original successful check. No dependency package or lockfile was changed.
The repeated typecheck with both prepared dependency trees exited 0.
