# Implementation decisions

1. Native processes replace Docker in this cloud because Docker is absent; same Open Notebook stack, SurrealDB and worker are retained. Official pinned SurrealDB 2.3.10 supports upstream v2 deployment choice
2. V1 metadata uses existing SurrealDB tables prefixed v1_, with app IDs preserved in payloads. No PostgreSQL, Redis or extra SQLite database introduced
3. Project commit barriers use advisory file locks shared across API/worker on the same filesystem. Locks cover short commit/snapshot phases, never remote calls. Multi-host deployment requires redesign; V1 is single-host
4. Production secrets/login remain unprovisioned pending targeted confirmation. Local tests use explicitly nonsecret fixtures and bind only to loopback
5. Superseded after actual browser testing: native PDF iframe behavior can be download-only and produce a blank pane. Pinned PDF.js6.4.299 renders an authenticated original Blob into a bounded selected-page canvas with local worker/assets and an explicit extracted-page-text fallback. Quotes remain separate; no invented PDF bbox or exact PDF text highlighting
6. Unknown external address and Google login are separate blockers; no substitute static architecture or fake production responses

7. Upstream npm lock contained106 mirror URLs. Replaced only registry.npmmirror.com hostname with official registry.npmjs.org, keeping every version/integrity hash; npm ci then succeeded
8. Each exec has distinct PID/network namespaces, verified by /proc/self/ns identifiers. Integration launcher starts DB/API/worker/browser in one process tree; shared project filesystem persists. This does not provide an external delivery URL
9. notebooklm-py0.8.5 current-chat default is not safe fresh context; production strict scope fails closed until verified non-destructive isolation. Remote notebook inventory may be recently-viewed only, explicitly incomplete
10. A portable archive is self-contained but not a signed trusted origin. Hashes and schema validate consistency, not who authored an extraction. Restore retains original bytes, exact historical quotes/locators and archived claim, but downgrades imported verified badges to unverified; every imported extraction/evidence carries a persistent server-controlled `restored_archive` marker. Note edits/search/answer validation do not upgrade it; fresh extraction creates separate evidence IDs. At the 2026-10-18 checkpoint, trusted historical revalidation remained a future acceptance item; the 2026-10-20 decision below supersedes that implementation limitation
11. Security review hardened MIME allowlists for source/artifact downloads, imported page/label/bbox metadata, malformed manifest types, cross-process job completion, local cancellation, unmapped remote references, and canonical note edits
12. Outline requests use an explicit task value and bounded per-source evidence sampling instead of pretending a generic instruction is a successful lexical query. Coverage limits remain visible
13. Existing upstream data root is now configurable via OPEN_NOTEBOOK_DATA_DIR (default unchanged ./data), allowing native checks to isolate original SQLite/uploads from every other run
14. Installed Chromium cannot create a required Unix socket in this sandbox, even with clean temporary profile/config. Official Playwright Firefox with ordinary defaults launches successfully; actual UI checks use Firefox without changing OS security settings
15. Native API port stays at upstream5055 so Next.js build-time rewrite defaults match actual service startup. INTERNAL_API_URL rewrite changes require a matching frontend rebuild; runtime API_URL alone cannot change compiled rewrites

16. Mobile screens hide the upstream fixed sidebar below lg and use a keyboard-accessible navigation drawer; actual 390px tests assert full-width content, no horizontal overflow and a visible 358px PDF canvas

## 2026-10-20 continuation

17. Historical revalidation is explicit and local: parse retained original bytes into a distinct trusted extraction, compare exact historical evidence/locators, and retain the historical identity. Keep archive provenance and discard imported revalidation reports. Neither archive consistency nor an embedded report is a trust root.
18. Reader verification is distinct from frozen turn scope. Preserve explicit invalid/out-of-scope status; only matching restored unverified local references can update their reader-only badge. Do not rewrite stored citation snapshots or equate quote verification with claim truth.
19. Maintenance operations have durable idempotent identities and short polling-driven recovery. Serialize dispatch/execution per job, retain fresh extraction identity through recovery, reject replay of restored jobs, and preserve the prior ready extraction on failed/restarted reparse.
20. Strict remote capability is rechecked inside the call lock, not merely before queueing. The frontend also gates ask on current connection/capability; it never silently changes engines. SDK fresh-history isolation remains unsupported and blocked.
21. A terminal chat job may exist without a turn. The composer observes its matching durable job to leave pending state after cancellation/failure/unknown submission, while preserving honest outcome messaging and no automatic retry.

## 2026-10-21 continuation

22. Frontend design references are reviewed text, not executable dependencies. Retain the existing Quiet Green semantic tokens and reading-first three-panel product, rather than replacing it with a decorative landing page. Anthropic licensed guidance is retained with its license; Vercel references are linked but not redistributed when licensing could not be confirmed.
23. Historical successful SDK calls are retained as evidence, not current admission. Network/auth/schema/profile failures revoke current availability; an audio quota response does not by itself revoke authenticated read-only listing. Safe fresh-history isolation remains unsupported.
24. Native recovery verification kills only a disposable test worker at a controlled parser boundary. Recovery uses production deadlines and normal status polling, not edited timestamps or manual job completion; this demonstrates local API/worker recovery, not host reboot, browser interruption or remote Google recovery.
25. Disposable test subprocesses disable implicit dotenv loading. The native runner first reads its explicit configuration, then disables implicit loading in children, preventing a second repository dotenv file from silently adding settings. Production application dotenv behavior is unchanged.

## 2026-10-21 reliability and publication follow-up

26. Editor identity and editor text revision are separate. Save completion can attach a saved note ID only to its original editor session; outline submission captures both values before any asynchronous work. A changed editor retains its draft, while the generated outline stays available in canonical conversation history.
27. Cancellation ends local waiting, not external execution. A running chat may continue consuming provider resources and may produce a canonical historical turn, but cannot revive a locally cancelled job. SSE prioritizes terminal cancellation. Running CPU maintenance/export is explicitly non-cancellable; queued exports re-read cancellation under the project lock before work.
28. Saved-audio acceptance is independent of remote generation. A synthetic PCM WAV exercises genuine authenticated import, browser decoding/playback, download, durable export and fresh-environment restore, without claiming Google generation or audible speaker quality.
29. Private publication uses a tested tracked commit snapshot, not a raw push to the upstream origin. Offline preparation preserves source bytes/modes and licenses, records documented exclusions, produces incremental additions/modifications/deletions and an expected complete Git tree. Publication advances the verified private branch only after full-tree equality; credentials/runtime data and upstream release workflows are not included.
