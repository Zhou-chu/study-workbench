# Research workspace v2 — reviewed implementation plan

Date: 2026-10-22 UTC. Status: implementation in progress; this document is not a completion or deployment claim.

## User outcome

The ordinary product should feel like a learning workspace rather than an operations console. The user requested a frontend redesign, separation of backend configuration into settings, web discovery with selected results becoming notebook materials, and a quick way to reuse saved notes/results as sources in the same notebook. The user authorized plan self-review followed by implementation without waiting for another design review.

## Decisions and boundaries

1. Evolve the existing StudyWorkbench, retaining its authentication recovery, note concurrency, selected File objects, streaming cancellation and uncertain-operation handling.
2. Default notebook navigation opens the study workspace. Keep the classic notebook route as an explicit compatibility option: legacy sources/history are not all represented by the evidence workspace. No implicit data migration or destructive redirect.
3. Use compact Sources, Chat/Reader and Notes/Studio areas, neutral reading surfaces, existing semantic color tokens, responsive layouts and keyboard-accessible controls. Technical identifiers appear in details, not as the primary content.
4. Global configuration lives in Settings. Notebook-specific engine, scope, Google linking and diagnostics live in a dedicated settings dialog; preserve the mounted workspace beneath it so drafts are not discarded. Contextual configuration messages remain when a requested action cannot run.
5. Web discovery is distinct from searching the existing library. Search is submitted explicitly, results have title/domain/snippet previews, and the user explicitly selects imports. Results are not full-text evidence. Importing or promoting a source never automatically selects it for subsequent questions.
6. Use Firecrawl through fixed official API endpoints, with bounded requests/responses, sanitized failures and no automatic provider retries. Default API-key mode with missing credentials means `configuration_required`, not fake results. The user subsequently approved explicitly enabling keyless trial mode for testing: it sends no Authorization header even if an ambient key exists, has shared server-IP daily limits, and never falls back to a paid mode. Search sends the explicit query; selected import sends the selected public URL, not notebook contents. Offline tests do not establish live provider availability.
7. Import fetched Markdown as a web snapshot, not the original page. The application server must not fetch arbitrary search-result URLs. Fixed-provider scraping avoids turning import into an internal-network fetch endpoint; still reject unsafe URL forms and retain original URL, retrieval time and provider provenance.
8. Saved-note and completed answer/outline promotion creates an immutable, model-free text snapshot. The server reads authoritative content, checks notebook membership and note revision, and atomically records source/version/evidence plus a durable idempotency receipt. Do not auto-save dirty editors. Audio, arbitrary binaries and PDF result conversion are not included in this iteration.
9. Derived sources remain visibly derived. Do not infer human authorship from a note lacking metadata; do not treat an AI answer citing its own inputs as independent corroboration. Preserve direct lineage without recursively expanding it. Archive restore must not promote historical/unverified evidence into trusted original evidence.
10. Preserve Docker deployment definitions. The current dot-cloud preview is a temporary native-process test environment, not Docker or Sites hosting. Do not modify its data, credentials or running processes during isolated development.

## Parallel ownership

| Branch | Ownership |
| --- | --- |
| `feat/learning-ui-v2` | Navigation, settings hub, workspace composition, source/reader presentation, locale integration, frontend regression tests |
| `feat/web-discovery-v2` | New discovery/import service and routes, provider adapter, standalone discovery UI/API module and focused tests |
| `feat/promote-source-v2` | Snapshot transaction, shared provenance models/evidence plumbing, portable validation, standalone promotion UI/API module and focused tests |
| `feat/research-workspace-v2` | Reviewed integration, router registration, changelog, aggregate verification and release evidence |

Shared models are owned by the promotion branch and coordinated with discovery. One owner integrates locale keys; translation work must not overwrite another worker's concurrent edits. No direct main publication is authorized by this plan.

## Acceptance gates

- Search: no requests while typing, absent-key state, provider failure versus genuine zero results, sanitized errors, result bounds, explicit selection, partial/uncertain import outcomes and retained idempotency keys.
- Import: fixed API origin, no redirects or environment proxy surprises, no TLS bypass, unsafe URL rejection, bounded content, correct source/version/job linkage and snapshot provenance.
- Promotion: same-notebook access, revision conflicts, incomplete turn rejection, exact text snapshot, duplicate delivery, key/request mismatch, rollback and unknown commit, preserved note revision, no model/embedding call, derived citation semantics and portable round trips.
- Workspace: dirty note/question/file retention through settings, tab switches and authentication recovery; historical scope retained; source reading is separate from selection; classic links remain usable.
- Presentation: English and Chinese, long labels, light/dark, 390×844, 768×1024 and desktop widths; no horizontal document overflow; dialog focus restoration and meaningful labels.
- Regression: relevant backend/frontend suites, locale parity, TypeScript, lint and production build. Record failed and unrun stages separately; narrow tests are not an aggregate pass.
- Preview update: preserve the current user's data and authentication; verify the new frontend/backend together before handing over an updated working interface. Do not claim live web search or model quality from fixtures.

## Review corrections already incorporated

- Rejected an unconditional legacy-route redirect because it could hide existing material and history.
- Rejected ordinary upload of generated Markdown as locally verified original evidence because that would lose derived provenance.
- Rejected arbitrary app-server URL retrieval and check-then-resolve DNS validation as sufficient SSRF protection.
- Rejected automatic save-and-promote, automatic source selection, silent provider switching and automatic mutation replay.
- Preserved uncertainty and rollback distinctions rather than treating browser cancellation as proof that no source was created.
- Keep derived snapshots out of legacy `Source.full_text` for this iteration: classic source chat does not preserve derived provenance. Their complete reading/retrieval path is the study evidence workspace. This is a scoped compatibility limitation, not a claim that all V1 material is absent from legacy search; successfully extracted web imports are copied into `full_text` by the evidence worker and are searchable there.
- Retain staged deterministic snapshot bytes on transaction failure rather than risk removing another writer's committed artifact. Receipt reconciliation, not a transport error, determines whether a snapshot exists.

## Provider references

- [Firecrawl search API](https://docs.firecrawl.dev/api-reference/endpoint/search)
- [Firecrawl search behavior](https://docs.firecrawl.dev/features/search)
- [Firecrawl scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape)

These references describe provider behavior, not credentials, current user entitlement, successful live calls or billing acceptance.
