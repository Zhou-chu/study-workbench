# Save-answer note decisions

Base: `094375e`. Seventeen new cases exercise the real PersonalService.save_note user path with only persistence and embedding write boundaries doubled. Empty content and foreign/missing selected source versions are refused before saving. Creation preserves answer whitespace and scope, supplies the default or truncated title, and embeds after persistence. Updates retain the expected revision and configured write mode without falling back to creation. Unmapped remote references retain their remote identity but cannot smuggle verified local source/locator claims. Repository exceptions/cancellation propagate by identity without embedding or alternate writes; an embedding failure after persistence does not replay the write.

EvidenceService construction and the Note model remain real. No citation validator is mocked, but these tests deliberately exercise the unmapped/no-citation paths; local citation validation continues to need its existing dedicated tests. The fixture does not create/read files, call a database/API/model or access real notebook data. It proves orchestration and contract propagation, not actual repository revision enforcement, durable commit acknowledgement, embedding quality, or browser interaction.

Validation:
- New file: 17 passed, one dependency warning, 0.94s.
- New file plus prior personal-service units: 28 passed, one warning, 9.71s with full-source coverage.
- save_note executes 28 lines and 11 branch arcs; the local validate_citation dispatch remains unexecuted in this batch. Against the frozen reviewed-unit report, five previously missing personal-service lines and five arcs are newly exercised. This is an actual raw-set comparison, not an assumed full-suite union.
- Coverage retains exactly 181 production files, 24,026 statements, 7,036 arcs and 56 pre-existing excluded lines. This limited run covers 1,030 statements/63 arcs, combined 3.5188%; unchanged 90.01 gate exits 1. No overall threshold success is claimed.
- Ruff check/format-check pass. Exact-file mypy was run first and exits 1 solely for four pre-existing imported SDK adapter nullable-handle errors at this frozen base, with no diagnostics in the new test. The raw failure remains visible; no Any/cast/ignore or SDK changes were added to hide it. Integration against the separately corrected SDK must recheck it.

Reproduce via the prepared locked interpreter and scripts/offline_pytest.py with the prepared tokenizer, selecting tests/test_save_answer_note_unit.py and tests/test_v1_personal_service.py. Coverage uses the unchanged scripts/quality/coverage-python.ini copied externally with only data_file relocated. Logs and raw reports are external under notebook-cloud-save-note-results. Production code and the classification manifest are unchanged; independent review must approve strict-unit admission.

Integrated checkpoint fe43593 also includes the independent frontend-static
workflow condition and its structural regression. Full isolated Python run:
5539 passed, 128 skipped, two warnings and the same seven cloud temporary-parent
custody failures. Full locked Ruff/format pass; full mypy remains 213 errors in
38 files (467 checked), with no new diagnostics from the note tests. This is
not a complete pass and does not replace strict-unit coverage measurement.

After installing both checked-in npm lockfiles without user npm credentials,
the exact frontend static commands all exit 0: workspace lint/typecheck and
legacy lint/tsc. Legacy lint reports seven existing warnings, not zero warnings.
Ruff/format and full mypy were repeated after npm installation with identical
results. Node 24.22.1 and npm 11.9.0 were used. Hosted conditional execution is
still separately pending; no application service or browser was started.
