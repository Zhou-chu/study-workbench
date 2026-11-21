# Reviewed strict Python subset at a56ade8

85 reviewed Python unit files, 1,834 passed, no failures/skips and one existing dependency warning in 78.53 seconds. Complete tracked production denominator remains 180 files, with no missing/extra source; all tracked input hashes and HEAD stayed fixed during execution.

- Lines 11,337 / 23,902 = 47.43%.
- Branches 2,477 / 6,996 = 35.41%.
- Native combined 13,814 / 30,898 = 44.71%.
- Existing exclusions 56 lines, unchanged.
- Native exit 1: the original 90.01 threshold correctly fails.

Compared with 00431bb on identical production source, 397 additional lines and 185 branch arcs were exercised. Added 32 context policy and 19 portable restore/submission cases; separated 85 existing logical embedding/profile cases from 43 installed-SDK and five file-loader cases. The split preserves all 55 original complete function/class ASTs. The unchanged FakeResolver was moved into a non-collected helper with a compatibility re-export after a downstream import audit; the real hybrid integration that uses it remains non-unit.

Independent review accepted logical boundaries. Portable unknown/cancel assertions now check the complete fixed error object, replacing an unexercised secret-string assertion. True citation trust, archive, DB atomicity, installed adapters and real file loading are not falsely claimed by the isolated tests.

Combined targeted regression: 184 passed; after the compatibility adjustment, 179 targeted cases including the original hybrid integration passed. These targeted mixed runs are separate from the 1,834 strict unit measurement.

Classification has 208 unit, 166 mixed, 51 tool-integration, 24 API-integration, 60 component-integration and 8 static-contract files. Only the 166 unresolved mixed errors remain: this is a reviewed-subset diagnostic, not a complete strict selection gate or CI result. Overall >90%, all-language coverage and current Sonar acceptance remain unmet.

Private evidence: python/reviewed-unit-subset-a56ade8 and python/next-integrated-stage. No business source, real data, deployment, migration or main merge changed.

## Public draft assessment

Read-only GitHub verification confirms PR #1 remains OPEN/draft, targeting main from publish/notebook-sanitized-20261114 at d3a3dce. The accumulated testing/classification increment fits that existing draft purpose, but not a ready-to-merge label. At measurement time the increment since its private source baseline touched 92 files. Eight evidence documents still contain 30 local identity-path occurrences; these require placeholder normalization in a separately parented sanitized public candidate, not publication of private ancestors. Pattern checks are preliminary, not a completed secret audit. Keep raw evidence private. No new push was performed in this stage.
