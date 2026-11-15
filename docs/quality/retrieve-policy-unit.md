# Retrieve coordinator policy units

Base cd9c387, isolated private tree. 23 units directly execute retrieve plus real
_limit, _disclosure, EmbeddingProfile, ScopeSnapshot, RetrievalResult and RRF.
_lexical/_semantic/_reread are explicit INTERNAL phase collaborator substitutes,
not external-I/O-only stubs. This defines a coordinator-unit boundary, not a full
retrieval pipeline or a claim that all internal behavior ran. Those phase methods
have separate real-implementation unit suites. Repository capture and profile
lookup are external stubs. No actual DB/provider/network/file/service work.

Two policy groups:
- Preflight rejects invalid limit/mode/disclosure combination, blank/non-string/
  oversized/non-UTF8 query and empty selection before repository/content/admission.
  Scope capture rejection stops content. Admission runs after scope capture and
  after final reread; cancellation at either point prevents subsequent work/result.
- Lexical scores/order are preserved with limit; hybrid executes real RRF with
  independently computed expected reciprocal ranks, not raw semantic scores.
  Profile missing/feature disabled/UTF8-prefixed byte overrun fall back explicitly;
  exact byte budget is accepted and one byte less rejects. Disabled feature cannot
  bypass stale disclosure. Unknown embedding outcome alone adds its warning.
  Selected/indexed counts, requested/effective method, profile, channels and
  supplied canonical phase inputs are asserted.

Initial run 21 pass/2 fail: test fixtures changed profile byte budget without
updating disclosed fingerprint. The implementation correctly refused stale consent.
First fixture edit missed one formatted location (22 pass/1 fail). Both corrected,
without changing production. No production RED/fix claim.
Final 23 pass in 8.80s with native complete-source coverage. Config changes only
external data_file; all 180 source files, 23902 lines,6998 arcs,56 prior protocol
exclusions retained: 769 lines (3.22%),52 arcs (0.74%),combined2.66%.
Native exit1 reflects unchanged90.01% gate, not a full repository pass.
Target module95/265lines (35.85%),31/102arcs (30.39%); retrieve45/45lines,22/22arcs.
Function-native arcs do not imply every boolean condition or full-module coverage.
Relative to frozen-a84cbfb/unit:46 new target lines/23arcs (set difference, no new
combined gate claim). No production/manifest/main/public changes or push/deploy.

Evidence prefix <private-evidence>/python/retrieve-policy:
-unit.log initial failure, -coverage.log first incomplete fixture correction,
-final.log/.json/.ini/.coverage final passing tests and threshold failure.
Ruff check/format and diff checks pass.

Replay:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_retrieve_policy_unit.py -q
Add --cov --cov-config=<private-evidence>/python/retrieve-policy-final.ini --cov-report=json:<private-evidence>/python/retrieve-policy-final.json for native full denominator diagnosis.

Test SHA256: e93a806adda711f5222933bb0ddcc4d768c958170a3628a5b021867005c76359
