# Evidence citation authenticity pure units

Base a0f39ad; independent candidate, not automatically part of the public release.
Only tests/docs change. 34 units execute real EvidenceService.validate_citation
and _matches_fresh, including the real EvidenceCitation DTO and SHA256 hashing.
Only store.get uses an in-memory copy-on-read AsyncMock. The constructor is
bypassed to avoid unrelated root/filesystem setup. No target method mock, parser,
real archive/file/DB read, network, lock, service startup or migration occurs.

## Behaviors protected
- Physical lookup ID must match payload identity; selected source and supplied
  evidence allowlist are separate restrictions; model metadata cannot override.
- Exact retained block text and quote hash bind citations. Subquote offsets use
  original Unicode codepoint positions; repeated quote matches stay invalid.
- Archive self-consistency is not fresh verification. Retained revalidation
  report requires an existing independently-originated fresh extraction, exact
  version/page/block/text, supported locator and valid integer offsets.
- Missing original version still prevents verification after a matching report.
- Derived evidence explicitly has no independent support; remote kind and
  provenance metadata remain distinct from local evidence.
- Explicit read view never falls back to the ordinary store; cancellation escapes.

The compound rejection parametrization includes three direct matcher cases for
bool/negative/out-of-range offsets. Those cases intentionally do not pass malformed
stored offsets through the citation slicer, so they do not claim that the full
citation endpoint itself validates those malformed offsets.
The fixture tests retained metadata authenticity, not actual parsing of original
bytes or authorization/router behavior. No production defect/RED claimed.

## Native evidence
Standalone 34 pass in 0.22s. Full-source diagnostic 34 pass in 6.63s.
180 production files preserved: 23902 lines, 6996 arcs, 56 protocol exclusions.
This batch hits 225 lines (0.94%) and 26 arcs (0.37%); combined 0.81%, exit 1 from
the unchanged 90.01% requirement. This is not a passing repository quality gate.
Target evidence_service: 96/424 lines (22.64%), 26/168 arcs (15.48%), no exclusions.
Function regions validate_citation 41/41 lines, 24/24 arcs; _matches_fresh 5/5 lines,
2/2 arcs. Native branch coverage does not enumerate every boolean subcondition.
Relative to reviewed-unit-subset-0dbdf1a this file adds 46 lines/26 arcs in the
unchanged target module (set difference, not a new combined execution).

Ruff check/format and git diff checks pass. No shared manifest change.
Evidence prefix: <private-evidence>/python/citation-verdict
(-unit.log, -coverage.log, .json, .ini, .coverage).
Configuration copies scripts/quality/coverage-python.ini changing only data_file.

Replay from this tree:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_evidence_citation_verdict_unit.py -q
Add --cov --cov-config=<private-evidence>/python/citation-verdict.ini --cov-report=json:<private-evidence>/python/citation-verdict.json
for complete-source diagnostic (expected threshold failure).

Test SHA256: 990cb75d0fe3e72d901e8168c0074a47c38d6a007c5eecb02cb1c27f39765057

## Independent-review follow-up
Eight additional cases: five non-integer end_offset values (True, False, float,
string and None), bad quote_hash with otherwise exact matching text/location,
partial fresh extraction positive verification, and extraction-only restored
marker without any evidence marker. Exact ordered persistence call arguments
are asserted in local success, fresh partial success and extraction-only downgrade.
These add semantic condition checks even though the prior native branch metric
was already 100% for these two functions. No production change, no fabricated RED.
Final 42 pass in 0.21s; Ruff check/format pass. Log:
python/citation-verdict-review.log. Prior 34-case coverage remains historical;
no claim of rerunning the 180-source coverage for this follow-up.

Final 42-case test SHA256: b25acc8400cde1ef74e4e321d4d7de952b241204bfe876413e00aaf276cb5685
