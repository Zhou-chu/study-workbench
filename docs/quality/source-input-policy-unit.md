# Source form and content-state policy units

Base 4b3a61f. Tests/docs only; no production, manifest, threshold or deployment
changes. Initial free disk 50.20 GiB. Existing portable remap/validator tests were
not duplicated; the selected uncovered logic is in api/routers/sources.py.

31 cases directly execute parse_source_form_data and _build_content_state with
real SourceCreate validation and real _assert_file_supported control flow.
They check explicit boolean spellings (whitespace is not silently normalized),
legacy notebook normalization, typed JSON fields, upload object identity without
reading it, malformed JSON and model errors mapped to specific 422 responses.
Content-state cases check required per-type inputs, exact admitted URL retention,
ValueError-to-400 translation, unchanged unexpected error/cancellation identity,
text preservation, uploaded-path precedence over legacy path, delete intent,
descendant-prefix admission, and unsupported-content rejection before dispatch.

No ASGI/TestClient, database, upload read, command, DNS or disk operation executes.
Only validate_url and check_file_support external probes are AsyncMock substitutes;
Path.resolve is represented by a deterministic mapping of external filesystem
observations. The actual string containment decision remains production code.
This does NOT prove symlink/TOCTOU containment or real DNS/SSRF validation. No model
or business target is mocked. Existing mixed array-limit module is not reclassified:
regression selects only its two pure model test classes, not its ASGI class.

Verification:
- New 31 passed, one dependency warning, 11.36 seconds with native coverage.
- New + seven existing model limits: 38 passed, one warning, 2.09 seconds.
- _build_content_state 26/26 lines, 14/14 branch arcs.
- parse_source_form_data 26/29 lines, 4/4 arcs; unexpected model-construction
  exception fallback is untested. Native function percentages do not prove all
  semantic inputs or replace the complete source denominator.
- Complete sources router: 125/560 lines (22.3214%), 21/162 arcs (12.9630%),
  combined 20.2216%, no exclusions.
- Compared with frozen-e4d4635's missing sets, this focused run covers 53 newly
  observed lines and 18 branch arcs in that router. No percentage addition or
  full-suite result is inferred.
- All 180 tracked production files remain: 2251/23902 lines, 57/6998 arcs,
  combined 7.4693%; native exit 1 retains the required 90.01 gate. 56 existing
  excluded lines unchanged, no missing/extra files; source bytes equal the base.

Ruff check/format and git diff checks passed. No production bug or RED claim.
Private evidence: python/source-input-unit/{command.json,coverage.ini,raw.coverage,
coverage.json,unit.log,regression.log,increment.json,source-audit.json,exit.txt}.
Config changes only the external data_file destination. Replay:

    <prepared-python> scripts/offline_pytest.py --tiktoken-cache <prepared-tokenizer> -- tests/test_source_input_policy_unit.py -q --cov --cov-config=<private-evidence>/coverage.ini --cov-report=json:<private-evidence>/coverage.json --cov-report=

Suggested layer: unit. Target api/routers/sources.py (and its actual SourceCreate
schema in api/models.py). Test SHA256:
afcb6971acf0ab2311376671e9be11c648a4978575b2bafe8397cae43446889a.
Full strict-unit gate and Sonar acceptance remain unmet and separate.
