# B8b classic conversations: source and synthetic acceptance

B8b restores 29 operations on the reviewed B8a base `8f3ada4909c906888be047826bbe737596e9100f`. These rows are **implemented**, not browser/runtime/provider verified. The aggregate B8 task is not complete. B8c global search/Ask and B8d podcasts remain pending. No backend protocol was added.

## Mounted operation map

All test paths below are relative to `apps/web/src/features/library/`. The harness mounts the real AppProviders, WorkbenchSession, router, app-lifetime stores and same-origin WebTransport, with synthetic producer-shaped fetch responses. No models/providers/services run.

| Operation | Mounted synthetic evidence |
| --- | --- |
| `notebooks.open_classic` | classic-chat.test.tsx :: notebooks.open_classic enters the actual classic panel directly from the notebook list |
| `conversation.read_classic_history` | classic-reference.test.tsx :: imported legacy history displays role, type, unknown identity and time without adopting or replaying its native-looking ID |
| `classic.context.source_insights` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.source_full` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.source_exclude` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.bulk_source_modes` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.note_include` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.note_exclude` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.context.bulk_notes` | classic-chat.test.tsx :: source modes and bulk target only loaded IDs while note include/exclude maps stay explicit |
| `classic.chat.send` | classic-chat.test.tsx :: sends a synchronous full transcript once and refreshes the exact native session |
| `classic.chat.choose_model` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires |
| `classic.chat.view_context` | classic-chat.test.tsx :: opens classic with explicit empty independent context and native history controls |
| `classic.chat.open_reference` | classic-reference.test.tsx :: opens full typed source, note and insight alias references through supported reads, with detached notes read-only |
| `classic.sessions.list` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires; native-ownership.test.tsx :: late notebook send output cannot replace another selected session or its draft |
| `classic.sessions.create` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires; native-ownership.test.tsx :: late notebook send output cannot replace another selected session or its draft |
| `classic.sessions.select` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires; native-ownership.test.tsx :: late notebook send output cannot replace another selected session or its draft |
| `classic.sessions.rename` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires; native-ownership.test.tsx :: late notebook send output cannot replace another selected session or its draft |
| `classic.sessions.delete_confirm` | classic-chat.test.tsx :: native session create rename model null clear and delete cancel/confirm use exact wires; native-ownership.test.tsx :: late notebook send output cannot replace another selected session or its draft |
| `source_chat.open_from_modal` | classic-chat.test.tsx :: source chat opens from inspected source, streams whole answers and returns to retained origin |
| `source_chat.back_to_origin` | classic-chat.test.tsx :: source chat opens from inspected source, streams whole answers and returns to retained origin |
| `source_chat.send_streaming` | classic-chat.test.tsx :: source chat opens from inspected source, streams whole answers and returns to retained origin |
| `source_chat.choose_model` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `source_chat.list_sessions` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `source_chat.create_session` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `source_chat.select_session` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `source_chat.rename_session` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `source_chat.delete_session_confirm` | classic-chat.test.tsx :: source session controls preserve parent pair and do not pretend null clears model; native-lifecycle.test.tsx :: switching native sessions cancels observation and preserves old unknown across A B A |
| `classic.message.copy` | classic-chat.test.tsx :: copy and explicit AI-note save omit title and keep source-only saves unavailable |
| `classic.message.save_to_note` | classic-reference.test.tsx :: only an explicitly inspected notebook association grants source-message note save, never a return URL; unknown AI-note creation locks duplicate and remounted save with no guessed title or adoption |

## Reviewed shared interfaces consumed and extended

- `createLibraryApi` retains its captured-context/generation request boundary. New `notebookChat` and `sourceChat` groups expose list/get/create/update/delete of the actual native session endpoints. `notebookChat.execute` returns the synchronous full transcript. `sourceChat.send` returns the unbuffered response for the exact source/session pair. `context` always sends both maps. `metadata.defaults` reads only the real `default_chat_model` field.
- Native DTOs are in `data/native-chat.ts`. Source and notebook parents are distinct discriminants. A source create strips exactly one leading `source:` in the required body field, never the encoded path. All full opaque IDs survive.
- Notebook model PUT sends explicit null to clear. Source model PUT cannot clear with null, so the default choice becomes unavailable once an override exists. Per-send default omits `model_override`; no fabricated model ID, provider, idempotency key or job ID is used.
- `Registry.library` now owns typed `native-chat`, `native-session` and `classic-context` inputs. Reads carry revision/ticket fences; sends acquire the synchronous original token before awaits. Actual create receipts stay with the original owner. Deleted native targets are tombstoned locally. Pending/unknown inputs cannot be unlocked, copied, resent or rebound. Existing B8a fresh/superseded records and consumer leases remain authoritative.
- `useClassicContext` is independent memory-only state with explicit empty maps. `SourceList` supplies only its identified loaded IDs to bulk controls. Newly loaded/imported rows remain off. The existing source pagination/query controller is reused, not duplicated.
- `SourceContent` composes the reviewed SourceAsset, SourceDetails and SourceInsights on both route and inspection surfaces. `InsightContent` reuses the reviewed insight view. `RecordReference` resolves known source/note/insight IDs through those adapters; only `insight:` aliases to `source_insight:`. Malformed paths are never partially fetched. Detached notes remain read-only.
- `LegacyHistory` renders known role/type/content/identity/time and explicit unknowns, preserving order. Imported IDs and replay flags never become native session authority.
- The sole source-stream package change is `packages/web-transport/src/ingress.ts`: admit SSE on the existing exact source-message path. Python `api/routers/source_chat.py:433` and `apps/bff/src/policy.ts:44` already support it. Arbitrary messages routes, HTML and redirects remain rejected; authentication, CSRF, context/retirement and no-replay behavior are unchanged. Future Ask admission is not included.

## G6 note-save custody

`StudioApi.createClassic` accepts an optional title. Existing manual notes still supply their title. Explicit AI-message capture calls `StudioStore.captureClassicMessage` / `captureSourceMessage` and `useStudio.saveClassicMessage` / `saveSourceMessage`, then the existing beginSave/settleSave path. Wire data is exactly `{content,note_type:"ai",notebook_id}`, with title omitted, not guessed. The original notebook remains the request owner. Received note ID/revision and later expected_revision CAS are preserved. An uncertain unkeyed create stays locked across remount and equal-content reads cannot adopt it.

A native notebook session must prove its notebook_id. A source chat may offer save only with the in-memory notebook-origin receipt created by an explicit notebook source inspection and a source detail that still lists that notebook. The source/session pair and captured target/generation are checked. A return URL, source page alone, unrelated open workspace or forged receipt is not authority. Provisional source stream messages can be copied but are not presented as server message identities or saved until exact native history supplies an ID.

A mounted source-origin note save exposed an existing resource-navigation seam: when there is no mounted notebook pane, resource navigation must still consult the existing Studio pending-save guard. `app/drafts.ts` now does so; no second navigation/save controller was introduced and B8a multi-owner capture remains unchanged.

## Stream and lifecycle acceptance

`readSourceStream` decodes split UTF-8 and LF/CRLF frames; user/AI events carry whole messages. Repeated AI events replace the provisional answer instead of concatenating it. Optional context indicators are validated. Only explicit complete finishes observation; complete without AI invents no answer. Malformed events, error, missing body, EOF, interrupted transport and observation stop retain uncertainty and partial output. Aborting cancels/releases only the local reader, not the server graph.

The exact-session post-success read cannot overwrite subsequent edits or another selected session, and a short/empty stale read cannot erase confirmed output. Explicit checks of unknown operations are inspect-only and never unlock resend. Tests cover duplicate clicks, IME/newline Enter, auto-create lost/late receipts, A/B/A session switches, deletion during send, reauthentication, privacy retirement, source-parent mismatch, context revisions and unresolved note saves.

## Verification boundary and remaining gates

- The task report records exact commands, logs, snapshot and final counts.
- Fourteen locales explicitly contain every new label. Existing paper/ink tokens are reused; controls have explicit labels, 44px target rules and semantic status feedback. Synthetic/static assertions are not browser visual acceptance.
- Browser/CUA/Playwright, live runtime/deployment, old service ports, DB/workers, actual data, providers/models/Google and security/network/Cloudflare changes: **NOT_RUN**.
- B8a deferred M1 recent-source return origin, M2 association/command display, M3 eyebrow registration and M4 bundle/performance warnings remain open. The pre-existing SelectedSourceSearch/NotebookPage render warning remains visible in synthetic reauth coverage. B8b's source-inspection return-origin path is tested, not a claim to resolve M1 globally.
