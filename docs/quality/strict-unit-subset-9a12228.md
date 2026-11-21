# Reviewed unit subset diagnostic: 9a12228

This is a lower-bound diagnostic, not the complete strict-unit acceptance run.
The reviewed Python-only selection had 50 files and 842 passing tests (37.43 s).
The complete Python production denominator remained 179 files, with no missing
or unexpected files. It includes production scripts.

| Metric | Covered / total | Raw percentage |
| --- | --- | --- |
| Lines | 7594 / 23788 | 31.9236589877% |
| Branches | 1033 / 6976 | 14.8079128440% |
| Combined | 8627 / 30764 | 28.0425172279% |

The 90.01 threshold failed (exit 1). All tests passing is not a coverage pass.
The 56 excluded lines are coverage's native Protocol/ellipsis rules; the three
source-preflight pragma exclusions were removed. Input hashes, clean revision
and production inventory were unchanged before and after this diagnostic.

Unknown and mixed test classifications still block the formal unit selector.
They were not silently accepted as unit tests. This diagnostic did not measure
JavaScript/TypeScript, shell, component, HTTP, CLI or browser acceptance.
Historical combined tests and Sonar coverage must not be called unit coverage.

Next work is classification/splitting and direct isolated tests for uncovered
service, lifecycle and tooling behaviors. High uncovered-line areas include
portable service, SPA cutover evidence/schema, NotebookLM service, native
runtime, evidence indexing/service and source/domain notebook operations.
No production paths may be removed simply to reach a target.

## Selector follow-up

The selector binds the clean revision, full tracked inventory, file hashes,
classification and loaded producer checkout. It rejects cross-checkout
producer use, stale artifacts, modified producer files, unresolved entries
and JSON boolean/float schema versions. This is input binding, not a digital
signature or proof of test semantic quality.

The protocol's 80 Python checks and 13 real tool-integration checks passed
independently; their categories remain separate. Full partition execution and
CI acceptance are not yet implemented by this protocol-only checkpoint.
