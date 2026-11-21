# Grounded generation policy units

Base: `2f81790`. New file: `tests/test_grounded_generation_unit.py`.
Target: `open_notebook/graphs/grounded_chat.py`.

## Classification and boundaries

48 pure unit cases exercise actual prompt budgeting, response parsing, generation
admission, model dispatch, cancellation propagation and early request rejection.
The service is constructed with inert explicit store/evidence/retrieval boundaries;
none are called. Model callables and provision/default-model lookup are external I/O
substitutes. No target methods are mocked. asyncio events coordinate in-memory
cancellation, not external locks. There are no collected-test imports, filesystem,
ASGI, databases, model network calls or real ingest/retrieval operations.

Evidence covers UTF-8 byte budget accounting, exact budget equality, complete-block
omission rather than truncation, derived snapshots never represented as independent
support, malformed response rejection, preserving unvalidated citation metadata,
provider admission ordering and denial at every dispatch barrier, exception identity
and rate-limit classification, and cancellation cleanup. Cancellation here is the
non-streaming `_generate` await lifecycle, not a streaming endpoint or durable turn
state claim. Citation parsing does not establish evidence/reference validity.

Existing `test_v1_grounded_chat.py` uses real extraction/files and composed evidence
services. It is not copied or relabelled unit. The remaining turn orchestration and
scope/citation persistence logic remain outside this new unit suite.

## Measurement

48 passed in 3.60 seconds. Ruff check and format pass. Production code, complete
production denominator, manifest, and repository thresholds are unchanged.
The local diagnostic selects the *whole target module*, not only tested methods:
125/257 lines and 44/106 branches covered (169/363 combined). It is not a complete
180-source run or the strict >90 gate. Import-time lines are included by Coverage.py;
not every newly measured line should be described as newly exercised business logic.

Reproduce using the previously prepared Python and tokenizer cache:

```text
<prepared-python> scripts/offline_pytest.py --tiktoken-cache <existing-cache> -- tests/test_grounded_generation_unit.py -q --cov=open_notebook.graphs.grounded_chat --cov-branch --cov-report=json:<external-output>/coverage-final.json --cov-report=term-missing --cov-fail-under=0
<prepared-ruff> check tests/test_grounded_generation_unit.py
<prepared-ruff> format --check tests/test_grounded_generation_unit.py
```

`--cov-fail-under=0` is an explicit local diagnostic-only invocation, not a gate or
threshold configuration change. Initial run had 39 passed/1 failed because a test
incorrectly expected the semantic-answer error for an empty list content payload;
the actual text extractor produces empty text, correctly taking JSON rejection.
That test expectation was corrected and the empty-list refusal retained separately.
This is added characterization coverage, not a production bug RED/GREEN claim.
