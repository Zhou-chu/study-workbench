# Scoped semantic retrieval strict units

Base acc96ce; no production or public-release-tree changes.
36 units target EvidenceRetrievalService._semantic and real internal
_bind_vectors/_disclosure plus dispatch admission. Actual NumPy cosine,
normalization, sorting, threshold filtering, channel truncation and batching run.
The imported _validate_vectors is a pure static validator, not a provider client
or another service executing I/O. Evidence collaborator is an unused placeholder.
Repository status/scoped_vectors/assert_scope and provider resolve_profile/
embed_query are explicit synthetic boundaries. No DB, files, network, real locks,
providers, service startup, migration or deployment.

Successful fixture asserts normalized cosine (stored roundoff and non-unit query),
deterministic tie ordering, removal below threshold, channel cap across batches,
actual cap arguments and scope/operation admission before simulated send.
Negative cases reject namespace/version/notebook/extraction/manifest/epoch/hash/
dimension/preprocessing/invented-ID contamination, duplicate/count mismatch.
Typed stale/not-ready/too-large errors permit documented lexical fallback;
integrity faults and revoked scope propagate. Removed/changed destinations prevent
send. Unknown/unavailable/invalid response maps to typed fallback without retries.
Cancellation from operation admission escapes before simulated send.
Exact boolean remote acknowledgment and local destination behavior are checked.

This is the semantic ranking phase, not complete retrieve()/RRF/final citation
reread integration. Latest a56 coverage already had rrf 100% and is not repeated.
Stub invokes the real admission callback once: it does not prove the actual SDK
invokes it at every required point or simulate worker locks.
Bound vector records are deliberately minimal dictionaries for this phase;
repository payload validation remains a separate contract.
No production defect or RED claimed; first run 36 pass.

## Verification
Standalone 36 pass in 0.79s. Full-denominator diagnostic 36 pass in 8.72s.
All 180 source files: 23902 lines, 6996 arcs, 56 unchanged protocol exclusions.
784 covered lines (3.28%), 52 covered arcs (0.74%), combined 2.71%.
Unchanged 90.01% gate exits 1; this is not full-repository success.
Target module 92/265 lines (34.72%), 20/102 arcs (19.61%), zero exclusions.
Four target function regions total 54/54 lines, 20/20 arcs; native arcs are not
exhaustive boolean-condition coverage and do not replace module denominator.
Relative to reviewed-unit-subset-a56ade8 adds 58 previously unhit module lines
and 20 arcs, a set difference rather than a combined-run claim.

Ruff check/format and git diff checks pass. Shared manifest unchanged.
Evidence prefix <private-evidence>/python/semantic:
-unit.log, -coverage.log, .json, .coverage, .ini.
Config copies scripts/quality/coverage-python.ini with only data_file changed.

Replay:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_semantic_retrieval_unit.py -q
Add --cov --cov-config=<private-evidence>/python/semantic.ini --cov-report=json:<private-evidence>/python/semantic.json for full-source focused diagnostic.

Test SHA256: 1be99d7747ddfe9a07860530205e3360c0eeeb9135b63552ba5000c4813e4105

Independent review accepted this isolated semantic scope. Two additional tests protect inclusive score threshold and canonical evidence/version binding even when both versions are in the snapshot; provider stubs now assert complete disclosure metadata. Final 38 cases pass. Earlier coverage numbers belong to the original36 report, not this final test revision. RRF is not exercised by this batch.
