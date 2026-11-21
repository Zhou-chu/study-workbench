# Reviewed-unit subset diagnostic: 24f5fe7

This is a diagnostic lower bound, not the complete strict-unit acceptance run.
59 reviewed Python unit files: **1041 passed**, one warning, 28.89 seconds.
The 90.01 threshold correctly returned exit 1.

| Metric | Covered / total | Percentage |
| --- | --- | --- |
| Lines | 8098 / 23830 | 33.9823751574% |
| Branches | 1251 / 6988 | 17.9021179164% |
| Combined | 9349 / 30818 | 30.3361671750% |

All 179 production Python files were measured, including scripts: zero missing
and zero unexpected paths. The 56 native Protocol/ellipsis exclusions remain
unchanged. Revision, tracked input hashes and clean status matched before/after.

Compared with the earlier reviewed subset, 504 additional lines and 218 branches
executed. The denominator also grew with policy implementation. This is not a
claim of complete unit selection, >90% coverage or Sonar acceptance. Unknown and
mixed classifications still block the formal selector; JavaScript/TypeScript
and other test layers are not represented by this Python-only measurement.

The current Node runner implementation has real exact-file/empty-zero-coverage
fixtures, but final gate consumption, Python orchestration, observed execution
identity and remaining runner families still need completion. Historical mixed
reports must remain separately labelled. No runtime deployment was performed.
