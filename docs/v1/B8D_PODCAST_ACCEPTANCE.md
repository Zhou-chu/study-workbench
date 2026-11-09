# B8d podcasts and profiles: source and synthetic acceptance

B8d restores exactly43 operations on reviewed/synced BASE c144f0e1289ed78ff7687c1de06f363baea0e387. Aggregate ownerTask remains B8. The four B8 slices total172 source-implemented operations (70 +29 +30 +43); none is browser/runtime/provider verified. Independent controller review and sync remain separate gates. B9 remains outside this slice.

## Mounted operation map

Paths below are relative to apps/web/src/features/library. Tests mount real AppProviders, WorkbenchSession, AppRoutes, the single DraftRegistry/QueryClient/navigation controller and actual same-origin transport against synthetic responses.

| Operation | Mounted synthetic evidence |
| --- | --- |
| `shell.navigate_podcasts` | podcast-profiles.test.tsx :: podcast palette navigation and creation target the working destination without submitting |
| `shell.create_podcast` | podcast-profiles.test.tsx :: podcast palette navigation and creation target the working destination without submitting |
| `podcasts.switch_episodes_templates` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.view_setup_warning` | podcast-profiles.test.tsx :: missing model setup and refresh errors remain visible without claiming an empty list |
| `podcasts.view_template_help` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.list` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.refresh` | podcast-profiles.test.tsx :: missing model setup and refresh errors remain visible without claiming an empty list |
| `podcasts.open_details` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.view_summary` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.view_outline` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.view_transcript` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.view_failed_error` | podcasts.test.tsx :: failed retry preserves original episode/audio, displays retry limits and confirms deletion separately |
| `podcasts.play` | podcasts.test.tsx :: audio uses contained GET only and owns object URLs until close (native controls rendered; actual audible playback/seek C2 NOT_RUN) |
| `podcasts.seek_pause` | podcasts.test.tsx :: audio uses contained GET only and owns object URLs until close (native controls rendered; actual audible playback/seek C2 NOT_RUN) |
| `podcasts.retry_failed` | podcasts.test.tsx :: failed retry preserves original episode/audio, displays retry limits and confirms deletion separately |
| `podcasts.delete_confirm` | podcasts.test.tsx :: failed retry preserves original episode/audio, displays retry limits and confirms deletion separately |
| `podcasts.cancel_delete` | podcasts.test.tsx :: failed retry preserves original episode/audio, displays retry limits and confirms deletion separately |
| `podcasts.open_generate` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.choose_notebooks` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.choose_source_context_modes` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.choose_notes` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.preview_built_context` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.choose_episode_profile` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.set_name` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.set_instructions` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.generate` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `podcasts.cancel_dialog` | podcasts.test.tsx :: explicit source and note context, exact generation request, cancellation and unknown retention; podcast-lifecycle.test.tsx :: partial context, revision, ownership and IME gates |
| `episode_profiles.list` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `episode_profiles.create` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `episode_profiles.edit` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `episode_profiles.duplicate` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `episode_profiles.delete_confirm` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `episode_profiles.cancel_edit` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.list` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.create` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.edit` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.duplicate` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.delete_confirm` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.cancel_edit` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.add_speaker` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `speaker_profiles.remove_speaker` | podcast-profiles.test.tsx :: create, duplicate, delete, cancellation and current ID-usage controls; podcasts.test.tsx :: profile editors preserve null fields and speaker extras |
| `route.podcasts` | podcasts.test.tsx :: mounts podcast route, profiles/help and list details using historical snapshots |
| `podcasts.download` | podcast-lifecycle.test.tsx :: explicit audio download uses a safe filename, separate transient object URL and no HEAD |

## Ownership and producer limits

- Separate podcast-form, podcast-profile-form and immutable podcast-operation records live in the existing LibraryStore. Exact targets, input presence/null, original draft and built request bytes remain retained after pending/accepted/unknown outcomes. No automatic replay, idempotency fiction, new persistence or fake notebook ID.
- Context starts empty and does not borrow personal/classic/global choices. Bulk actions capture loaded IDs. F47 compares actual membership and returned IDs/modes; missing, foreign, duplicate, malformed or unusable contributions block generation until explicit selection revision and fresh preview. No silent subset or fallback. Estimates describe producer context counts, not final billing.
- Generation sends episode profile NAME plus speaker profile ID and trimmed name/instructions. Receipt job_id is not an episode ID. Duplicate profile names cannot be disambiguated by the producer; generation fails closed rather than guessing. Current profile/model metadata is rechecked at dispatch.
- Profile PUT uses create-schema mandatory fields. Optional/null fields and unknown speaker dictionary extras are preserved. Speaker deletion checks current episode-profile ID usage at render and dispatch, including live-cache changes before rerender. Historical episode dictionaries are narrowed, not parsed as live profiles.
- Failed/error-only retry uses current profile resolution and omits original briefing_suffix; old episode/audio remain. Delete and duplicate have explicit captured target confirmations. Late results stay with their own original operation.
- Audio is an exact identity-checked podcast GET, never source HEAD, filesystem paths or external URLs. Playback has native controls, no autoplay, and owned Blob cleanup. Download uses a separate transient Blob and sanitized filename. Actual audible playback/seek/pause and browser behavior are NOT_RUN.
- Episode list polls only running/processing/pending/submitted while mounted; unknown does not poll or authorize retry. Accepted command observation uses the existing app-owned real command endpoint. No job cancel/detail/audioHEAD endpoint was added.
- Preview is deliberately read-only text, not SourceInspection/SourceContent action composition. No reference-reader consent is inferred. Existing RecordReference original-owner admission and all prior global/native/source owners remain unchanged.
- Every new UI message exists in all14 current locales; existing podcast translations supply normal forms. The optional legacy workflow text that incorrectly says speaker profiles bind by name is not displayed.
- No backend, BFF/allowlist, provider/settings, credentials or deployment changes. Tests use synthetic data only.

## External gates

Browser/CUA/Playwright/mobile keyboard, actual media playback/download, live services/database/worker, provider requests, credentials/accounts, deployment, production, old ports and GitHub sync: NOT_RUN by this worker. No entry is marked verified. See task-local report for exact final commands, logs, warnings and source manifest.
