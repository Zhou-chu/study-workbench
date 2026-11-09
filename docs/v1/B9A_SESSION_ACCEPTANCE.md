# B9a session, notebook and connection acceptance

Source implementation only. Exactly 33 operations retain ownerTask B9; all remaining B9b-e operations remain pending. C2 browser/mobile/provider/runtime acceptance is NOT_RUN. No live login, signout, credentials, connection, provider, worker, deployment or security change was used.

The single WorkbenchSession, DraftRegistry, navigation controller and WebTransport remain authoritative. NotebookSettings is a retained overlay. Its enumerated nonsecret resource records retain original context, command, HTTP status, newer edits, uncertainty and matching create receipt. Callback-only private clearing contains no secret values.

One source selection writer reserves link-then-clear synchronously. An unknown link does not clear or replay; a confirmed link plus unknown clear remains visibly partial and uses exact existing selection reconciliation only. Source/reader/import actions never select automatically. Actual returned create-job proof binds notebook, title, key, operation, provider and canonical request hash; only an explicit click observes that exact acknowledged job. A result never silently links a notebook.

Provider metadata is published from the one explicit existing verification response. Capability and page revisions are separate, so reverification cannot renew an old listing. Manual browser unavailability, expiry, unknown quota, incomplete recent lists and strict-isolation ask limits are explicit. No profile, authentication or browser capability is invented.

F48/F49: original retrieval admission is invalidated by control/selection replacement and relevant owner unmount, including lexical default and Google A-B-A. Accepted original observation remains independently fenced, with no expanded GET authority. Same-original-owner Google retry still works when its provider proof is current, regardless of unrelated local model availability. Old captures are never rebound.

| Operation | Mounted implementation | Synthetic evidence |
|---|---|---|
| `shell.navigate_settings` | AppChrome / CommonNavigation / SetupWarning / SettingsLayout | settings.test.tsx shell/setup entry cases; navigation.test.tsx guard |
| `shell.navigate_models_transformations_advanced` | AppChrome / CommonNavigation / SetupWarning / SettingsLayout | settings.test.tsx shell/setup entry cases; navigation.test.tsx guard |
| `shell.view_setup_warning` | AppChrome / CommonNavigation / SetupWarning / SettingsLayout | settings.test.tsx shell/setup entry cases; navigation.test.tsx guard |
| `shell.open_model_setup` | AppChrome / CommonNavigation / SetupWarning / SettingsLayout | settings.test.tsx shell/setup entry cases; navigation.test.tsx guard |
| `shell.open_encryption_docs` | AppChrome / CommonNavigation / SetupWarning / SettingsLayout | settings.test.tsx shell/setup entry cases; navigation.test.tsx guard |
| `auth.safe_return` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |
| `auth.signout` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |
| `auth.finish_signin` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |
| `auth.retry_local_signout` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |
| `auth.close_reauth` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |
| `notebooks.archive` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.unarchive` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.rename` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.edit_description` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.preview_delete` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.keep_exclusive_sources` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.delete_exclusive_sources` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.confirm_delete` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `notebooks.cancel_delete` | NotebookSettings / settings-api / settings-store | settings.test.tsx exact PUT, delete preview/options/confirmation/unknown and retained edits |
| `workspace.open_tools` | NotebookShell / NotebookSettings | settings.test.tsx mounted overlay/tools and exact File/draft retention |
| `workspace.open_settings` | NotebookShell / NotebookSettings | settings.test.tsx mounted overlay/tools and exact File/draft retention |
| `scope.choose_engine` | NotebookSettings / source-operations / useSourceOperations | settings.test.tsx complete engine/origin/unknown; selection-refresh.test.tsx; chat.test.tsx original admission |
| `scope.choose_local_remote` | NotebookSettings / source-operations / useSourceOperations | settings.test.tsx complete engine/origin/unknown; selection-refresh.test.tsx; chat.test.tsx original admission |
| `scope.show_unknown_values` | NotebookSettings / source-operations / useSourceOperations | settings.test.tsx complete engine/origin/unknown; selection-refresh.test.tsx; chat.test.tsx original admission |
| `remote.load_notebooks` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.page_notebooks` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.link_notebook` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.create_notebook` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.connect` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.reconnect` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.refresh_connection_flow` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `remote.disconnect_confirm` | ConnectionsPage / settings-api / SessionController / source-operations | settings.test.tsx explicit verification, flow, listing, create/link/disconnect; contracts.test.ts matching job proof |
| `route.login` | WorkbenchSession / LoginPage / LoginRoute / ReauthLayer / ConnectionState / SessionController | auth.test.tsx cold return, closure, retry and readiness; settings.test.tsx; session-client.test.ts |

## Shared regression and limits

- Auth, navigation, selection-refresh, chat and original transport suites accompany the new settings suites.
- Full web/root synthetic tests, all workspace types, affected lint and production build are recorded in the task evidence, including failures and their fixes.
- Every current locale has explicit B9a text. Existing grayscale tokens and 44px controls are reused; actual pixel/keyboard/mobile browser checks remain C2-owned and NOT_RUN.
- Notebook PUT has no CAS. Delete preview has no lock, restoration guarantee or chat-session count. Only the actual delete receipt confirms completion; 404/list absence never does.
- Unknown/unavailable provider states are non-actionable. A connected listing is not strict-isolation ask proof, account identity or unlimited quota.
- Local signout does not mean account-wide server revocation. Legacy storage-removal failure stays unconfirmed/retryable. Device confirmation follows only the exact local endpoint result or its explicitly supported AUTH_REQUIRED retry.
- Known render-time and bundle warnings are preserved in the task report. Client allowlisting does not fix the retained F29 legacy wire limitation.
