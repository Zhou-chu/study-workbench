# B8c global Search and Ask: source and synthetic acceptance

B8c restores exactly 30 operations on reviewed B8b base `2c66762bcfed17a9c3dd9f36ff803a96597e9c71`. These rows are **implemented**, not browser/runtime/provider verified. B8d's 43 podcast operations remain pending. Aggregate B8 is not complete.

## Mounted operation map

Test paths are relative to `apps/web/src/features/library/`. The mounted tests use real AppProviders, WorkbenchSession, AppRoutes, app-lifetime DraftRegistry, same-origin WebTransport and synthetic fetch responses. No provider, worker, database or real data runs.

| Operation | Mounted synthetic evidence |
| --- | --- |
| `shell.navigate_search` | global-search.test.tsx :: shell Search link and retained global scope do not mutate classic/personal selections or File identity |
| `shell.command_search` | global-search.test.tsx :: command search and Ask navigate real routes without submitting |
| `shell.command_ask` | global-search.test.tsx :: command search and Ask navigate real routes without submitting |
| `global.switch_ask_search` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |
| `global.choose_notebook_scope` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |
| `global.clear_scope_to_whole_library` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |
| `global_search.submit` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.text` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.vector` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.include_sources` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.include_notes` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.open_source` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.open_note` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.open_insight` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.expand_matches` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_search.view_score` | global-search.test.tsx :: search switches dispatch exact independent scope and raw identity results with score and matches; global-lifecycle.test.tsx :: IME and ordinary Enter do not submit |
| `global_ask.submit` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.choose_strategy_model` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.choose_answer_model` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.choose_final_model` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.cancel_models` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.expand_strategy` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.expand_intermediate_answers` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.view_final` | global-ask.test.tsx :: models cancel without provider work; explicit model choices and Ask scope; whole strategy/intermediates/final |
| `global_ask.open_reference` | global-ask.test.tsx :: Ask reference opens the reviewed source consumer without creating sessions or save grants |
| `global_ask.save_to_selected_notebooks` | global-save.test.tsx :: explicit selected notebooks save question-titled AI notes once through Studio; partial save locks; cancel before/during save |
| `global_ask.cancel_save` | global-save.test.tsx :: explicit selected notebooks save question-titled AI notes once through Studio; partial save locks; cancel before/during save |
| `route.search` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |
| `route.search_link` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |
| `route.ask_link` | global-search.test.tsx :: route search/ask prefills only; modes and whole library scope do not submit |

## Producer and shared interfaces

- `createLibraryApi.search.submit` sends only the existing Search DTO: query, text/vector type, source/note switches, limit100, minimum_score0.2 and independent optional notebook_ids. Raw result records retain full IDs, parent_id and unknown/optional fields. Source/note/insight inspection uses the shared RecordReference consumer; a note parent_id is not notebook authority. Scores come only from finite relevance/similarity/score fields.
- `createLibraryApi.search.ask` sends question, three explicit model IDs and notebook_ids. Search switches are not Ask exclusions: the actual Ask graph searches sources and notes. GET models/defaults is configuration only; metadata now projects the existing nullable default_embedding_model. No discovery, model testing or implicit execution.
- URL q/mode only prefill a retained editor. Global scope has its own identified choices and does not alter classic/personal/podcast selection. New provider execution requires explicit confirmation. A consumed local intent cannot submit again; New question creates a distinct blank intent, not a retry of an unknown run.
- LibraryInput adds global-query, global-run and global-save discriminants. Exact captured contexts, generation, original input, revision/token and per-target receipts remain under the existing registry/navigation controller. No native session, job, evidence, backend version, idempotency protocol, disk cache or offline queue is invented.
- Model confirmation is bound to the exact original editor record. Newer edits, navigation, readiness/target changes and privacy retirement cannot rebind it. Stream response/body output stays with the original operation. Abort/navigation/reauth stop local observation only.
- SourcePage accepts internal /search return origins without creating a source notebook grant. References reuse B8a assets and B8b consumers; nullable detached notes show a localized title fallback and actual revision, still read-only.
- The transport admits only the exact /search/ask application SSE path with its established query boundary, in addition to pre-existing events/source-message streams. Adjacent paths remain rejected. Backend/BFF paths were already present. Auth/CSRF/same-origin/retirement/disposal and no-replay behavior are unchanged.

## Ask stream semantics

The dedicated reader validates strategy, whole intermediate answers, whole final_answer, complete.final_answer string|null and error.message. Split UTF-8, LF/CRLF, incomplete/invalid frames, EOF, late responses, abort and reader release are covered. A byte-idle watchdog defaults to600000ms; public Vite build option VITE_API_TIMEOUT_MS accepts a finite nonnegative value, with0 disabling it. Invalid/missing values use the default. No environment or deployment configuration was changed.

F44: valid current-owner complete:null is known terminal no-answer. It ends observation and retains partial text, but never authorizes final-answer Save. Empty completed text likewise yields no answer. Nonempty explicit completion is answer success; explicit error is known failure; invalid terminal/EOF/observation loss remains unknown. A provisional final followed by null remains unconfirmed, never savable.

## Explicit selected-notebook saves

GlobalSaveDialog captures the original completed question as title, exact answer, independent selected verified notebooks and each existing Studio owner ID before dispatch. It calls Studio.open in classic/ai mode with a distinct local origin and uses each target's existing awaitable useStudio.save(id). The shared dispatcher sends title/content/note_type ai/notebook_id, with no native session, personal turn or citation metadata. Native message captures still omit titles.

The batch waits for the exact Studio save result and actual saved note identity before advancing. command_id:null remains a valid editorial save. Rejection, definite non-dispatch, unknown, cancellation or owner loss stops further targets. Saved/unknown/unsent targets and their original IDs remain visible; reopen/reauth cannot resume or duplicate creates. Existing Studio/navigation guards remain authoritative off-notebook.

## Verification limits

The task report records final exact commands, logs, receipts and hashes. Global fixture/decoder/contract tests cover all14 explicit locale shapes, accessible names,44px controls and semantic status text; token contrast/static checks are not browser visual acceptance. Existing source/classic/Studio/navigation regressions are included in the final web aggregate.

Three notebook navigation fixture assumptions were updated because /search now performs legitimate GET notebook/model/default reads. Assertions still forbid implicit POST/provider execution; original creation, Back/Forward and uncertainty checks remain intact.

Browser/CUA/Playwright, live services/deployment, old production ports, backend/DB/workers, providers/models/Google, real data/credentials and access/network/Cloudflare changes: **NOT_RUN**. Existing B8a M1-M4, B8b M1/M2, SelectedSourceSearch render warning and bundle warnings remain controller review items. No podcast or B9 feature is implemented here.

## Review correction 1: original inspection, availability and save status

- I1: Global Search results and Ask intermediate/final references pass their original LibraryDraft to the existing shared reference consumer. Its optional owner admission checks the retained record, context, generation, retirement and supersession at click time and synchronously at the reader render boundary. An invalid owner unmounts the inspector before a replacement scope can enable its query. Original output text remains visible with a 14-locale read-only explanation; it is not a new reference or notebook/session grant. Existing B8a/B8b callers without this optional seam keep their current-owner behavior.
- I2: useGlobalSearch.canSubmit is shared by button/form/keyboard intent, model-dialog readiness and final dispatch. Vector/Ask require a successful, idle current defaults query with a nonempty embedding model. The final gate reads live query state, so a stale confirmation callback cannot consume an intent after metadata changes. Text Search remains explicit and available without embedding metadata; malformed scope, IME and consumed-intent fences remain intact.
- I3: Per-target inspection also reads the exact original Studio editor. Unknown/pending original creates without a batch receipt cannot be called unsent; untouched later targets remain unsent. Actual receipts take priority. No save dispatcher, retry or completion authority changes.

Mounted correction evidence: global-lifecycle.test.tsx contains all 36 Search/Ask × source/note/insight × target A→B→A/privacy/successful reauthentication × previously open/closed cases. It asserts inspector disposal (including hidden mounted dialogs), no replacement-owner reference GET, retained output and no note/session grant or replay. global-search.test.tsx covers both Ctrl/Cmd Enter plus form submit under null/loading/error embedding states for vector/Ask and text fallback chosen explicitly; malformed scope stays blocked. global-ask.test.tsx covers already-open model dialogs and cache changes before stale confirmation callbacks run. global-save.test.tsx inspects the retained batch before its first dispatched create settles and again after a late response, preserving exact Studio IDs, unknown/unsent distinction and disabled Save.
