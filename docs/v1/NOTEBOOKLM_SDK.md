# NotebookLM SDK boundary and current verification

Implementation date: 2026-10-18. Dependency: **notebooklm-py==0.8.5**, MIT, installed from the locked Python dependency. Production always constructs `SDKNotebookLMBridge`; no environment switch enables test responses.

## Evidence and important limits

The installed 0.8.5 wheel was inspected with `inspect.signature`, public client namespaces, public types, and the wheel's source. The matching tag references are [client](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/src/notebooklm/client.py), [stability](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/docs/stability.md), [installation](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/docs/installation.md), and [security](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/docs/security.md). No main-branch-only API is assumed.

No Google account was logged in, no live notebook was read or written, no real question was submitted, and no audio generation was requested during development. Passing injected tests does not establish A09, A11, A12, A13-live or A17-live. Google AI Pro remains a personal subscription, not a general model API credential or a guaranteed quota. The API reports unknown quota as null.

Two pinned-version findings constrain delivery:

1. `chat.ask(..., conversation_id=None)` continues the account's current server conversation. It does not establish a new isolated conversation. A safe, non-destructive new-context mechanism has not been live-verified. Production `ask` therefore fails closed with `SCOPE_ISOLATION_UNAVAILABLE` before submitting a question. It never invokes a destructive new-chat shortcut and never silently expands an empty selection.
2. `notebooks.list()` uses the recently-viewed-projects listing. The SDK does not guarantee that every owned notebook is included. The adapter pages the returned list and explicitly returns `listing_complete=false` plus the limitation. It does not claim a complete Google-account backup. Source lists use `strict=True`, with explicit full-pagination checks and duplicate-ID rejection.

## Public SDK mapping

### Published-release recheck (2026-10-18)

A bounded check of the [official PyPI index](https://pypi.org/project/notebooklm-py/#history) and [project releases](https://github.com/teng-lin/notebooklm-py/releases/tag/v0.8.5) found **0.8.5 is still the latest published version**, with no later stable or prerelease in PyPI. There is no published upgrade candidate to evaluate or lock. Machine-readable release metadata, timestamps and distribution hashes are retained in [the release capability check](evidence/notebooklm-release-capability-check.json).

The tagged [public chat contract](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/src/notebooklm/_chat.py#L280-L318) confirms that an omitted/`None` conversation ID continues current server history. Its documented forced-fresh operation deletes that history. The [CLI new-conversation implementation](https://github.com/teng-lin/notebooklm-py/blob/v0.8.5/src/notebooklm/cli/chat_cmd.py#L373-L418) performs the same deletion after confirmation; it is not a non-destructive alternative. `clear_cache()` only clears local cached turns. No supported non-destructive fresh-conversation public API was established by this check.

**T08 and default Google Q&A remain incomplete.** Keep the 0.8.5 dependency/lock and production fail-closed behavior. Do not infer isolation from a fabricated conversation ID, a new client instance, local cache clearing, an unreleased/private API, or a destructive reset. This check made no Google calls and did not change integrated code or dependencies.

### Read-only follow-up (2026-10-21)

The public [upstream release listing](https://github.com/teng-lin/notebooklm-py/releases) still identifies v0.8.5 as latest. Re-reading its tagged public chat contract did not establish a non-destructive fresh-context API. Production Q&A remains fail-closed; no Google login, account access, or remote mutation was attempted. The evidence JSON records this separate recheck and its retrieval limits without re-dating the previous wheel/source hashes.

Capability reporting now distinguishes historical verification from current availability: a missing profile, failed connection verification, expired session, ordinary SDK transport failure, or malformed read response marks remote operations temporarily unavailable, while preserving the historical verification timestamp. Replacing a missing profile file alone does not restore prior availability; successful network verification is required. Fresh worker instances with an existing profile and no failure observation report unverified, allowing the service’s durable admission checks to operate without inventing a disconnected-account failure. Successful network verification restores supported-operation availability. Strict chat remains unsupported throughout; reconnecting never implies history isolation.

### Application mapping

| Application capability | Public 0.8.5 call | Adapter behavior |
| --- | --- | --- |
| Runtime authentication and notebook read | `NotebookLMClient.from_storage(path=..., config=...)`, then `client.notebooks.list()` | A file or local status alone never yields connected; successful network authentication and a typed read are required |
| Notebook list | `client.notebooks.list()` | 50-item application pages; recently-viewed completeness caveat preserved |
| Source list | `client.sources.list(notebook_id, strict=True)` | Typed source IDs/status/revision; metadata does not imply the original PDF is saved |
| Explicit notebook creation | `client.notebooks.create(title)` | One submission, persisted idempotency key and confirmed returned ID |
| Explicit original upload | `client.sources.add_file(notebook_id, file_path, mime_type=..., title=..., wait=False)` | Exact immutable local version and target; returned source ID stored before another call; short polls wait for readiness |
| Text import | `client.sources.get_fulltext(notebook_id, source_id, output_format='text')` | `remote_text_snapshot`, original status `missing`, timestamp and import coverage report |
| Chat | `client.chat.ask(notebook_id, question, source_ids=..., conversation_id=...)` | Signature verified; production disabled until strict history isolation is verified |
| Audio submission | `client.artifacts.generate_audio(notebook_id, source_ids=..., language='zh')` | Exact nonempty IDs and language; no implicit selection or background generation |
| Audio status | `client.artifacts.poll_status(notebook_id, task_id)` | One read per worker invocation; unknown/not-found status stays unresolved, never regenerated |
| Artifact listing and identity | `client.artifacts.list(notebook_id)`, `client.artifacts.get(notebook_id, artifact_id)` | Typed IDs, kind/status; no arbitrary download URL accepted from the browser |
| Audio download | Verified artifact `.url` from public metadata | Bounded signed-asset download; every HTTPS redirect is allowlisted, streamed byte limit, audio-container/MIME checks, SHA-256 and protected local file |

`client.artifacts.download_audio(notebook_id, output_path, artifact_id=...)` exists, but it exposes no per-call byte limit. The application therefore uses the verified public artifact URL with its own bounded streaming downloader. Only signed URLs on Google media hosts are supported; if a URL requires additional authentication, lacks metadata, uses an unsupported host/container, or exceeds the limit, the operation returns an explicit error. This remains **unverified with real account assets**. The application neither forwards session cookies to arbitrary URLs nor silently bypasses these limits.

`ClientConfig(backend=WebBackendConfig(), retry=RetryOptions(rate_limit_max_retries=0, server_error_max_retries=0))` explicitly disables SDK mutation retries. SDK private modules, raw RPCs, master-token authentication, cookie extraction, public CDP endpoints, and CLI commands deleting server history are not used.

## Authentication and operator handoff

The web connect/reconnect endpoints create a persisted, ten-minute, single-account flow. This runtime has no application-managed approved visible persistent Google-login browser. The flow consequently reports **unavailable** and explains the missing browser/profile rather than fabricating an awaiting or connected state. No password, OTP, Cookie or token form is provided.

Once a deployment operator has an approved visible browser on the actual application host, the public Web-login CLI can be used by the user there. This is a remaining manual deployment step, not something performed in development. The installed CLI help verified these supported options:

- `notebooklm login --storage /private/dedicated/storage_state.json --browser chromium --browser-timeout 300`
- `notebooklm auth check --test --passive --json` for a passive network diagnostic in the same dedicated CLI profile

The SDK's CLI initializes its profile directory even for subcommand help. The first help-only invocation could not write the read-only home directory; help was then inspected with an empty temporary `NOTEBOOKLM_HOME`. No login command was executed. Do not reuse that temporary directory for a real deployment.

Set `NOTEBOOKLM_STORAGE_PATH` to the runtime user's dedicated persisted session file, **outside the repository, uploads/static roots and project export data**. The default is `~/.local/share/study-workbench/notebooklm/storage_state.json`; the current read-only cloud home is not an established durable login location. The profile directory and file are restricted to 0700 and 0600 before use. The API process and worker must use the same configured storage path and data root. Never paste or commit the file; never include it in portable exports. Mount it as private runtime storage.

The application's connected state still requires its own real network verification after the operator's login. Disconnect persists a shared admission gate, drains/closes current SDK contexts, and removes only the application-owned storage-state file. It retains local originals and remote-job history and does not delete Google notebooks or revoke every Google-account session.

## Durable job behavior

All remote mutations use existing SurrealDB records and `surreal-commands`. No new queue service is introduced.

- The notebook, operation, bounded request snapshot, request hash and idempotency key are saved before dispatch. Same key/same request returns the original job; changed parameters conflict
- The durable unknown marker is saved before submission. Returned remote IDs, per-version upload mappings or normalized chat response are saved while the account-call slot is still held
- If the response is lost, or a worker stops after intent without a confirmed ID, the job becomes `submission_unknown`. Neither worker retry nor API retry replays it. Similar remote titles/times are not proof of success
- Commands disable their own retry. Safe queued jobs and confirmed polling phases are recovered by a short API dispatcher tick. Waiting on an audio job never holds the account slot or a worker in a sleep loop
- API/worker processes coordinate through advisory locks on the shared data root. The supported deployment is a single shared-filesystem application; separate unshared volumes do not provide this guarantee
- A confirmed audio task is queried by its original ID. On completion the app attempts a bounded download; a failed download keeps the confirmed result and reports `downloaded=false` plus a reason, so an explicit later asset download cannot regenerate audio
- Cancellation before transport blocks submission; cancellation after intent reports that Google may continue. Late responses preserve local cancellation while retaining confirmed IDs
- Restored historical jobs have `replay_allowed=false` and cannot be dispatched or executed
- Local and remotely imported asset downloads validate persisted identity, allowed relative paths, actual file size and SHA-256, including the portable restore layout

## Source and citation truth

A remote text snapshot does not count as an original PDF. Import reports retain requested/imported/skipped/failed/missing-original/unsupported fields and pagination status, including partial failures. Metadata-only imports do not create trusted version mappings.

A fresh upload maps its actual returned source ID to the exact immutable version. Existing remote sources require an explicit user association plus a complete normalized extracted-text match; a matching filename is never sufficient. Known remote revision changes mark mappings stale; disappearance marks them missing. Local originals and historical evidence remain intact.

The chat service takes immutable source-scope snapshots. It validates remote readiness and local mapping freshness again before transport. Remote citations outside the selected IDs are `out_of_scope`; unmatched, repeated or ambiguous passages remain `remote_unmapped`. Local page/paragraph locations are returned only after a unique exact quote match and the evidence service's original/version/scope validation. No guessed pages or bounding boxes are produced.

## Verification commands

```sh
.venv/bin/python -m pytest tests/test_v1_notebooklm* tests/test_v1_artifact_jobs.py -q
.venv/bin/ruff check open_notebook/integrations/notebooklm api/notebooklm_service.py api/routers/notebooklm.py commands/notebooklm_commands.py tests/test_v1_notebooklm* tests/test_v1_artifact_jobs.py tests/v1_notebooklm_helpers.py
.venv/bin/python -m pytest tests/ -q
```

Focused checks cover connection truth, unknown schema, unavailable visible login, explicit injection-only fakes, public call signatures, exact scope, idempotency conflicts, response loss, worker restart, concurrent duplicate delivery, cancellation, single-call audio polling, bounded downloads/redirects, import partial failures, original association, stale revisions, citation ambiguity, restored audio playback and no task replay. Consult PROGRESS.md / ACCEPTANCE.md for the latest full-suite counts and live-versus-simulated acceptance results.
