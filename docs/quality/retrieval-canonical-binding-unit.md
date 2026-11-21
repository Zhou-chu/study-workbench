# Canonical lexical and fresh reread binding units

Base 6a2550d, independent private candidate. No production/main/manifest/public
tree changes, real data, DB, network, migration, deployment or push.

40 strict units execute _lexical and _reread with real _metadata/_checked_record/
_CanonicalReads, strict SourceVersion/Extraction/EvidenceRecord validation,
normalization/lexical scoring, manifest hashes, sorting and final projection.
store.get_many supplies synthetic physical-ID envelopes. EvidenceService
list_evidence and validate_citation are explicit collaborator stubs; neither
real EvidenceService nor repository DB authorization is executed.
Their call arguments/read-view and allowlist are checked. Therefore this is a
single retrieval logical-unit test, not a claim of cross-service integration.

Covered: complete metadata scope binding, strict schema rejection, malformed
membership, physical/canonical identity relationships, source title/hash/kind
binding, exact unique block/page/offset/text match, safe collaborator error
projection, manifest mismatch, supported origin-kind pairs, fresh post-dispatch
reads, immutable origin markers, changed record/title, invented ranked identities,
unverified verdict preservation/channels, zero-hit scope check and final scope
revocation. Expected manifest SHA256 uses independent stdlib JSON/hash operations.
The fake citation verdict is not evidence of actual citation verification; that
service has separate units. No production bug/RED claimed.

Verification: first 34 pass/0.71s; final 40 cases pass with native coverage in 9.02s
and standalone final log. Ruff/format/diff pass.
180 production files, 23902 lines / 6998 arcs, 56 existing protocol exclusions:
822 covered lines (3.44%), 71 arcs (1.01%), combined 2.89%.
Unchanged 90.01% threshold exits 1; no full repository gate success.
Target module 149/265 lines (56.23%), 49/102 arcs (48.04%), no exclusions.
_metadata 22/22 lines,8/8 arcs; _checked_record16/16,6/6;
_lexical25/26,11/12; _reread25/25,12/12.
Remaining lexical duplicate-across-record-map guard at234→235 was not artificially
forced; no assertion of impossibility. Native arcs do not enumerate all boolean
conditions or replace the full-module denominator.

Against frozen-90315ef/unit, same target source bytes, adds 88 lines/37 arcs
(set difference, not a new combined gate run).
Evidence prefix <private-evidence>/python/canonical-binding:
-unit.log, -final.log, -coverage.log, .ini, .json, .coverage.
Coverage config changes only external data_file.

Replay:
    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_retrieval_canonical_binding_unit.py -q
Add --cov --cov-config=<private-evidence>/python/canonical-binding.ini --cov-report=json:<private-evidence>/python/canonical-binding.json for full-source focused diagnosis.

Test SHA256: 974c905559ea517a06398cc5b227b98d9be2376b63b9218c20823347ad58d4a7
