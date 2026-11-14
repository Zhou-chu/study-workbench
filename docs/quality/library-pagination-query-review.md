# Library pagination query review

Base: `dd9e2c8`. This is a bounded follow-up to the 006831f mixed SPA run, not a replacement full-suite result.

The pagination scenario mounts real React routes, query clients and operation controllers with synthetic transport. It is a component-integration scenario, not a pure unit test. The containing file remains `unclassified` pending whole-file review; the search ownership file retains its existing `component-integration` classification. Only their reviewed-content hashes change.

The original scoped panel query still computed accessible button names across all 31 loaded rows before selecting the first deletion action. A bounded no-coverage run measured this query at 381ms versus 105ms for its click/render. Selecting the original source through its accessible `Paper 0` link and then finding the deletion button inside that list item measured 69ms. These are observations on the same machine, not a controlled performance guarantee. Async query setup timings do not measure the entire awaited render.

The patch preserves 30 initial sources, pagination offset 30, the later source, original-source global deletion rather than unlink, confirmation, request count and parent route assertions. It does not change production code, mock component internals, reduce data, remove assertions, or increase the 5000ms timeout. Temporary timing instrumentation is removed.

The existing search warning helper used an overloaded generic spy return type that left callback parameters implicitly any. Its parameter now describes only the observed mock-call structure as readonly arrays of unknown values. Runtime filtering and assertions are unchanged. The two TS7006 errors are preserved in the diagnostic red log.

Validation evidence is kept under the local quality evidence directory `node/library-pagination-dd9`: timing.log, scoped-timing.log, types-red.log, final-combined.log, final-lint.log and types-green.log. Final verification and its exact outcome are reported with this candidate. A single targeted pass does not establish full-suite timeout stability; a new fixed-source mixed run is still required.

The two selected files passed 33 tests together, with targeted ESLint clean. Default isolated-tree `tsc --noEmit` removed both TS7006 diagnostics but then reported TS2742 in unchanged `src/test/render-app.tsx`: the dependency symlink resolves a Testing Library type through the other worktree. A complete `tsc --noEmit --preserveSymlinks` rerun completed successfully (exit 0, no diagnostics) and is recorded separately in `types-symlink.log`; this is an environment-resolution distinction, not a production workaround.
