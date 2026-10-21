# Local evidence and independent answering

## Verification scope

The focused run is preserved verbatim in [evidence/evidence-local-tests.txt](evidence/evidence-local-tests.txt). It covers the local evidence service, extraction command, scoped lexical retrieval and independent answer pipeline. The mypy invocation is deliberately scoped to four new modules and skips imported modules; it is not a whole-repository type-check result.

- **Real local parser execution:** UTF-8 Markdown/TXT bytes and valid, programmatically generated PDF bytes are saved, hashed, parsed by the pinned pypdf dependency in disposable CPU processes, retrieved and checked against their retained original extraction text
- **Gold retrieval fixture:** 20 predefined Chinese questions across five documents assert both the expected first-hit source and the expected original paragraph; this is a small lexical regression corpus, not a general retrieval-quality benchmark
- **Locator fixture:** ten PDF physical pages assert the expected zero-based page index and exact original text slice. Additional tests separate identical phrases in different PDFs and exercise non-BMP Unicode text offsets
- **Fake-model contract verification:** injected asynchronous model callables verify selected-source snapshots, citation rejection, prompt-data boundaries, history rebuilding, no-evidence responses, idempotency, model-configuration errors and provider-error classification. These tests do not establish real independent model availability or semantic correctness
- **Storage boundary:** focused tests use an in-memory repository implementing the shared storage contract. They do not by themselves establish SurrealDB persistence, authenticated HTTP delivery, live worker startup, browser behavior or export restoration; integration verification is recorded separately by the main implementation
- No independent provider credentials, paid model calls or Google calls were used for this test scope

## Storage and reference rules

`SourceVersion` keeps original bytes, SHA-256, byte length, MIME, relative file path, origin and original-availability status. New bytes create a new version. Re-extraction creates a new extraction when explicitly forced; old extraction blocks and evidence remain readable. Repeated default extraction is serialized across workers by a per-version file lock, with deterministic evidence IDs inside the extraction.

Text offsets are Unicode codepoints into `extraction.blocks[].text`, identified by `locator.block_id`. The original extraction text is never replaced with normalized search text. A browser must use `Array.from(text)` when slicing these offsets. PDF locators use physical `page_index`, starting at zero; the UI displays index plus one. No bounding boxes or printed page labels are invented.

A verified reference proves that its evidence identity, source version, current turn selection and exact quote match the retained extraction. It does **not** prove the semantic correctness of every answer sentence. Malformed, unknown, omitted-from-prompt and out-of-scope references never become verified. Ambiguous repeated substrings do not receive invented precise offsets.

Extraction statuses are `queued`, `extracting`, `ready`, `partial`, `needs_ocr`, `empty` or `failed` at the version level. Mixed PDFs retain successful pages and OCR warnings. Scanned pages do not receive fabricated text. Malformed/encrypted PDFs and configured limits produce explicit errors. UTF-8 decoding failures are rejected before a version is stored.

## Execution boundaries

The extraction worker is registered as `extract_evidence` with `EvidenceExtractionInput(source_version_id, extraction_id=None, job_id=None)`. It updates the durable job when supplied and updates the native Source text without embedding. A late job for an old version cannot overwrite the latest Source text. The parser process is terminated when its time limit expires; the project export/write barrier is held only for short metadata commits, not CPU parsing.

`GroundedChatService.turn(notebook_id, chat_session_id, request)` accepts only explicit local selections and the independent engine. It rejects cross-project versions and empty selections. All retrieval occurs inside that version whitelist. Same-key simultaneous submissions return the existing turn; an interrupted running turn is not silently sent to the model again. Old model answer bodies are never treated as evidence. Scope changes remove prior questions and answers from model context, and ambiguous scope-changing follow-ups request clarification.

Production model calls use the existing `provision_langchain_model` path only after a configured chat model is found. No fallback provider is chosen. Source content is supplied as untrusted JSON data; this pipeline exposes no tool execution surface. Structured citations are checked after generation and before the final record is saved.

## Configurable bounds

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `STUDY_WORKBENCH_DATA_DIR` | `data/personal` | Managed original/evidence files |
| `STUDY_WORKBENCH_MAX_FILE_MB` | `50` | Original size limit in MiB |
| `STUDY_WORKBENCH_MAX_PDF_PAGES` | `300` | PDF physical page limit |
| `STUDY_WORKBENCH_EXTRACT_TIMEOUT_SECONDS` | `30` | Hard parser-process time limit |
| `STUDY_WORKBENCH_MAX_TEXT_CODEPOINTS` | `5000000` | Extracted text limit |
| `STUDY_WORKBENCH_EXTRACT_CONCURRENCY` | `2` | Parser concurrency per application process |
| `STUDY_WORKBENCH_MAX_SELECTED_SOURCES` | `20` | Explicit source selection limit |
| `STUDY_WORKBENCH_CONTEXT_TOKENS` | `8192` | Deployment-supplied model context budget, capped at 100000 |
| `STUDY_WORKBENCH_OUTPUT_TOKENS` | `2048` | Reserved answer/output budget |
| `STUDY_WORKBENCH_MODEL_TIMEOUT_SECONDS` | `90` | Model request timeout |

The upstream model record has no context-window field, so the deployment context setting must match the chosen model. The pipeline conservatively counts UTF-8 bytes as an input-token upper bound and reports this estimator in `turn.budget`; it does not claim exact token counting. Complete evidence blocks are selected to fit, and omitted evidence/source coverage is explicitly recorded in warnings and coverage metrics. The default retrieval cap is twelve evidence blocks.
