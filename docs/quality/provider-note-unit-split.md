# Compatible provider and note-save isolated units

Base: `a6c4017`. Tests only; no production, denominator, exclusion, threshold or
classification manifest changes. Two reviewed mixed files were split without
changing any complete function/class AST, decorators, parameters or assertions.

- `test_anthropic_compatible_provider_unit.py`: 7 functions / 14 cases. Real
  credential configuration/DTO values and internal model mapping are allowed
  implementation details. Persistence lookup, URL validation/pinning, HTTP
  clients and model factory are doubles. The rejected credential update returns
  before save. The real Esperanto-to-LangChain adapter compatibility case stays
  in `test_anthropic_compatible_provider.py` (1 component-integration case).
- `test_note_save_embed_unit.py`: complete TestNoteSaveEmbedResilience class and
  invalid mutable-field test, 6 cases. Note.save validates and prepares values,
  but update_note and submit_command are doubles. Commit order, durable result
  projection, failure and no-submit semantics are the logical target. No actual
  database, project lock or SDK queue executes. The 3 TestClient endpoint cases
  remain in `test_note_save_embed_resilience.py` (API integration).

No shared helper or collected-test import was introduced. The provider tests
run under the existing offline runner, whose environment allowlist removes
ambient credentials and custom CA paths. In particular, the unmocked
httpx_verify_setting remains its pure default branch rather than isfile(CA).
No real model/provider request occurs; true SDK interoperability remains separate.

## Evidence

- Complete original top-level AST sets: provider 8 -> 7 + 1; note 4 -> 2 + 2
  (classes include their methods). All nodes equal, none missing or duplicated.
- Native pytest collection: 24 -> 24, exact names and parameter IDs preserved.
- New units together: 20 passed, 1 existing Pydantic SDK deprecation warning.
- Original plus new files: 24 passed, 2 existing SDK/TestClient deprecation
  warnings, zero failed/skipped.
- Ruff check and format on the four files; no production format changes.
- All tracked first-party Python scope files compared byte-for-byte against base;
  counts/digests and complete test mapping are in the adjacent JSON evidence.

Commands use the existing prepared Python interpreter and tokenizer cache:

```text
python scripts/offline_pytest.py --tiktoken-cache PREPARED_CACHE -- tests/test_anthropic_compatible_provider_unit.py tests/test_note_save_embed_unit.py -q
python scripts/offline_pytest.py --tiktoken-cache PREPARED_CACHE -- tests/test_anthropic_compatible_provider.py tests/test_anthropic_compatible_provider_unit.py tests/test_note_save_embed_resilience.py tests/test_note_save_embed_unit.py -q
python -m ruff check FOUR_CHANGED_TEST_FILES
python -m ruff format --check FOUR_CHANGED_TEST_FILES
```

Selected against reviewed-unit-subset-913c480 gaps: ai/models.py had 127/186
covered statements and 39/66 branches, domain/notebook.py 284/484 and 55/122.
This split enables strict-unit selection of existing meaningful cases; it is not
itself a new full-project coverage measurement or a >90% claim. No deployment,
real service, database, browser, credential, push or full-suite run performed.
