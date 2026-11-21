# Reviewed unit stage: 2f68bbf

All initially unclassified files have now been reviewed; remaining mixed files still block formal complete unit selection. This is a reviewed subset diagnostic, not full strict gate acceptance.

74 Python unit files: 1,486 passed, no skips/failures, one existing third-party warning (78.95s). Complete 180/180 production sources, zero missing/extra paths, input hashes and frozen HEAD unchanged.
- Lines 9,978 / 23,902 = 41.7455%.
- Branches 1,996 / 6,996 = 28.5306%.
- Native combined 11,974 / 30,898 = 38.7533%.
- Exit 1: unchanged 90.01 threshold correctly fails. Existing 56 native exclusions unchanged.

Compared with b060e61, the same source/line/branch denominator gains 344 covered lines and 167 branches. This combines 103 new portable validation cases (including a Chinese/non-BMP locator boundary), isolated original device/note/RRF assertions, and existing reviewed tests; it does not manufacture coverage by lowering thresholds or omitting code.

Separately, the newly classified in-memory BFF session-store file passed 43/43 on the actual Vitest runner (0.90s). No whole frontend coverage claim follows from that target.

Private native raw/log/argv and scope audit evidence: python/reviewed-unit-subset-2f68bbf/ and node/bff-session-store-unit-2f68bbf/. No services, migration, production state, deploy or publication used. Prior mixed coverage and Sonar results are not updated by this run.
