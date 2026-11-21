# Web session browser acceptance — scoped evidence

Date: 2026-10-21 UTC. This is local functional acceptance, **not production activation or Sites deployment approval**.

## Frozen sources and outcome

- Broad browser evidence: `656fb667e2a7e413645a7070b0a1142bd9f2fb11`.
- Final Source Chat correction: `89b4232bdab40650430ffd70c5cb575391daca49`; integrated frontend bytes are identical at `bb0fb5ea87be8a0e914046f3b95de930b1166b34`.
- Final frontend aggregate: **1100 tests / 71 files**, production build including TypeScript, full lint **0 errors / 7 preexisting warnings**. Independent correction review: **72 checks** with production query-cache defaults.
- Backend/deployment-launcher aggregate remains **1627 passed / 37 gated skips**, from the separately reviewed password-file correction. The Source Chat fix changes no backend, BFF, auth policy or dependency files.
- No confirmed new defect remains in the completed targeted checks below. This statement does not turn unrun cases into passes.

## Runtime and fixture boundaries

The test stack used real SurrealDB 2.3.10, FastAPI native authentication/resources, and one stable Next development request process with actual Firefox. All credentials, files and records were synthetic. Requests used explicit loopback HTTP; normal fallback fonts were observed. This does **not** establish production HTTPS, Secure `__Host` cookies, real Sites access, native-client connectivity, standalone process topology or Docker lifecycle.

Public version metadata was a narrow fixture to avoid the backend's external update lookup. Inference streams and exceptional loss/delay controls were provider-free HTTP fixtures, explicitly separate from real model quality or remote-job cancellation. No provider request, account login, installation, TLS bypass or real runtime configuration was used.

## Established local behavior

| Area | Evidence |
|---|---|
| Authentication and custody | Correct/wrong-password login, pending confirmation, two tabs/reload, opaque stable HttpOnly/Strict cookie, DOM/storage/bundle checks, legacy-storage removal, and rejection of mixed/forged/obsolete credentials. Actual cross-origin browser request rejected before native mutation. |
| Loss and races | Browser acknowledgement loss after known rotation recovers without another rotation; unknown API commit/ack loss retires the handle without replaying an old token. Pruned-access and terminal-deadline fixtures remain explicitly accelerated, not real-lifetime evidence. Ordering/revocation races preserve newer authority. |
| Outage signout | Local signout returned in 0.278 seconds while its exact native cleanup DELETE was held. Retained work stayed locked; native revocation remained unconfirmed. Subsequent stale handle rejection, explicit fresh login and no replay passed. Best-effort cleanup is allowed and is not a prerequisite for local retirement. |
| Editing and recovery | Real buffered InlineEdit/body/newer draft retained; same modal and file selection survive reauthentication. Actual stale-revision comparison/cancel/discard and committed-save/lost-response unknown state passed. Recovery is reachable by pointer and reverse keyboard within the note dialog. |
| Navigation | A delayed save does not replace newer navigation or create duplicate notes; real Back/Forward passed. Read-like POST context requests were classified separately from note mutations. |
| Uploads and downloads | Real browser multipart and ZIP restore bytes/hashes, explicit dispatch counts, source/history/artifact/podcast/export downloads, ranges and conditional behavior. Required Vary tokens survive framework-added tokens; native conditional 200 is not claimed as 304 support. |
| Streaming and reading | Real stored-turn SSE, provider-free GET/two-POST stream parsing/first-chunk/UTF-8/abort checks, actual Ask consumer, real local CPU extraction, and nonblank historical PDF page rasters. Hostile returned artifact/audio URLs do not trigger credentialed external fallback. |
| Responsive/localized UX | Tested en-US and zh-CN at 1440×1000 and 390×844: in-viewport controls, modal pointer/keyboard access, Escape/reopen and retained file. Not all locales or devices. |
| Resource bounds | Eight admissions and excess busy, owner plus 32 refresh followers with one rotation, bounded four-owner cleanup and reuse. Real pending expiry observed for 67.334 seconds. Unknown native create remains live after 61.175 seconds despite a browser failure; no false disappearance claim. |
| Negative restart control | Exactly 32 live native sessions remain cap-limited after frontend-only restart with unchanged API. Old handles fail and new issuance stays limited. This proves why coupled restart is needed, not that production recovery is implemented. |

## Genuine default lifetime

Native issuance was `2026-10-21T21:37:23.613566Z`; access deadline was `2026-10-21T21:52:23.613566Z`, exactly **900 seconds**. The observed setup-to-recovery interval was 910.113 seconds, with unchanged request process throughout.

Two actual dirty study tabs each selected one real restored source. Both selection PATCH acknowledgements completed before the observation baseline. After actual expiry:

- title/body/question values and DOM nodes, nonempty source selection and scope survived;
- deliberate expired saves dispatched **zero native resource writes**;
- two explicit browser recovery actions produced **one native rotation**, generation +1;
- no password prompt or automatic save/upload replay appeared;
- stable cookie value, attributes and absolute expiry were unchanged;
- the terminal route inventory contains only the two intended selection setup writes plus auth operations, not hidden context POSTs.

No clock hook, shortened TTL or accelerated substitute was used. Historical citations were tested separately; **citation preservation across expiry itself was not tested**.

## Source Chat defect and correction

The original actual UI parser test passed, but same-document Back to Sources navigation left its stream open: cancellation remained false 6.001 seconds after navigation and 12.641 seconds after send, before the fixture's 15-second watchdog. The hook's missing signal/cleanup existed in earlier source; no baseline browser run establishes the exact behavioral introduction date.

The first correction (`a7e4f28b`) passed unit checks but failed browser verification: its purported fresh session fetch inherited the production five-minute cache and returned cached empty messages without a new GET. That approval was withdrawn. Follow-up `89b4232b` forces a fresh captured-session read, tests the real production cache defaults, and preserves cancellation/generation fences around old reads and delayed results.

The **byte-identical actual RED test** passes on final `89b4232b`: first-chunk and split UTF-8/JSON parsing, genuine fresh selected-session GET, then navigation abort before fixture release. Cancellation was observed by navigation completion, 3.754 seconds after send versus the 15-second watchdog; one stream request, zero extra session creation, zero native provider dispatch. This establishes **local consumer/proxy abort only**, not termination of an already-started remote model job.

## Remaining product and verification work

- Existing Markdown Tab indentation can trap forward traversal inside the body. Recovery remains reachable by reverse Tab from the title and by pointer; clearer keyboard-exit guidance is a separate accessibility improvement.
- Escape from the body deliberately dismisses the editor under existing behavior. Better unsaved-draft dismissal guidance remains a PM follow-up, not passive authentication-induced draft loss.
- AddSource processing copy could distinguish local parsing from optional AI more clearly.
- Not run here: all 14 locales, every citation location, citation-across-expiry, 100 MiB limit, 30-day lifetime, committed-upload-loss and streaming-outcome-after-reauth analogues. Selected-file recovery and raw abort do not substitute for those cases.
- The real native cap of 32 prevents this integration from establishing 64 simultaneously live native-backed BFF records; separate state-machine tests cover their own scope only.
- Actual Docker images/mounts, production HTTPS/trust, owner/non-owner Sites access, native private ingress, coupled lifecycle and native applications remain unverified/unimplemented as documented in the acceptance ledger.

## Evidence provenance and cleanup

Initial UI failures through an HTTP-only outer ingress were a Next development-HMR fixture incompatibility; direct matched-origin Next resolved them. Several selector/count/persistence-fixture assumptions were corrected and retained as superseded attempts, not reported as product regressions. The genuine lifetime and final Source Chat harnesses were frozen and archived before execution; product sources remained unchanged.

The initial interrupted namespace has unverified descendant cleanup and is not claimed clean. Later final phases recorded owned process termination, all owned listener ports gone, unchanged source, and no observed external browser request or credential-boundary violation. Next required escalation after its bounded graceful wait; no unrelated/name-based process kill occurred. Log hygiene checks concern retained sanitized artifacts, not proof about inaccessible raw process memory.
