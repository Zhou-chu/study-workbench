# Explicit web discovery and snapshot import

This feature is separate from `/api/search`, which searches the local knowledge
base. Search results are previews, **not notebook sources or verified evidence**.
A user selects up to five previews and explicitly imports them into the current
notebook; the dialog dispatches at most two imports concurrently.

## Operator setup and boundaries

- Default mode is `STUDY_WORKBENCH_WEB_SEARCH_MODE=api_key`: configure the existing
  `FIRECRAWL_API_KEY` (or `_FILE` secret mechanism) on the API server.
  Restart after configuration changes. No model key is needed for
  search, import, or lexical evidence extraction.
- Only Firecrawl's cloud origin `https://api.firecrawl.dev` is supported. A
  non-default `FIRECRAWL_API_URL` returns configuration-required instead of sending
  an existing self-hosted credential to the cloud. No automatic mode fallback exists.
- `ready` means local configuration is present, not that credentials, credits,
  or provider availability have been tested. Settings status makes no provider
  request. There are no synthetic/fallback results.
- All API/worker instances must share the configured persistent personal data
  directory and database. It contains snapshot bytes, bounded recovery
  checkpoints, and process-safe locks. Do not delete checkpoints/receipts to retry
  an uncertain paid request.
- No new dependency is required: the adapter uses the project's installed httpx.

### Explicit keyless trial

An operator may explicitly set `STUDY_WORKBENCH_WEB_SEARCH_MODE=keyless_trial`
on the API server to test without an account or key. In this mode the adapter
**never reads or sends an API key**, even if an ambient key/key-file is configured.
It omits Authorization for both search and scrape. Unknown mode values fail
closed; neither errors nor quota exhaustion switch to keyed/paid access.

Firecrawl documents free keyless REST search/scrape access with daily request and
credit caps shared by public IP. Numeric caps are not published; exceeding either
returns 429. This is limited trial availability, not guaranteed capacity. See the
official [introduction](https://docs.firecrawl.dev/introduction) and
[rate limits](https://docs.firecrawl.dev/rate-limits). The UI labels this mode and
discloses that the query/selected URLs leave the server, but notebook contents do
not. Tests use MockTransport only; enabling trial locally is not a live provider
verification.

Status exposes `access_mode: api_key | keyless_trial | null`, `trial_limits`
(`scope: server_ip`, `period: daily`, `numeric_caps_published: false`, or null), and
`automatic_paid_fallback: false`. Null access mode indicates unsupported server
configuration. `ready` is still only a local configuration check.

The query and explicitly selected URLs go to Firecrawl. Notebook contents are not
sent. Queries are not persisted by this feature; result state remains in the
mounted dialog only. Provider retention/billing policies still apply. Search and
scrape may consume provider credits; this feature neither probes billing nor
guarantees a price. See the official [search documentation](https://docs.firecrawl.dev/features/search)
and [scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

## HTTP contract

Root application integration registers `api.routers.web_discovery.router` under
`/api`; browser session mode needs the same exact method/path allowlist entries.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/personal/web-search/status` | Local configuration status; no secret |
| POST | `/api/personal/web-search` | `{query, limit?}`; explicit metadata search |
| POST | `/api/personal/notebooks/{notebook_id}/sources/web-import` | `{url,title,snippet?,provider:'firecrawl',idempotency_key}` |

Contracts live in `api/web_discovery_contracts.py`; unknown request fields are
rejected. Search query ≤500 characters; limit 1–10 (default 6). Search JSON is
bounded to 1 MiB/20 seconds. Import JSON is bounded to 5 MiB/35 seconds; retained
Markdown ≤2 MiB. Connect timeout is five seconds. Neither endpoint retries.
Import returns `queued`, `already_imported`, or `saved` plus immutable source and
version IDs. `saved` carries a warning: bytes exist but extraction was not queued.
Neither `queued` nor `already_imported` means verified/corroborated evidence.
Errors expose stable machine codes, not provider response bodies or credentials.

## Security and provenance

The app never fetches an arbitrary result URL. It POSTs only to fixed provider
`/v2/search` or `/v2/scrape`, with TLS verification, no redirects and no proxy
environment inheritance. Public URL syntax/literals are validated as metadata;
this does not pretend to be DNS-to-connect SSRF protection. Selected URLs are
passed to the external provider, not followed by the application server.

Scrape requests use Markdown only, `proxy: basic`, `parsers: []`,
`skipTlsVerification: false`, `storeInCache: false`, and no actions, browser
instructions, cookies, LLM cleanup, or enhanced-proxy fallback. Unsupported pages
or responses without Markdown are errors, not fabricated text. Provider text is
untrusted data; importing does not activate instructions/tools. No remote images
or favicons load in the search preview.

The retained version has origin `web_snapshot`, evidence kind
`remote_text_snapshot`, and `original_status: missing`: Markdown is a retrieved
representation, **not retained original HTML**. Typed provenance holds canonical
URL, retrieval timestamp, provider, title, and snippet. A plain-text attribution
heading preserves the URL/time in retained bytes. Portable archives keep their
existing conservative structured-URL sanitizer and mark omitted historical URL
metadata explicitly. Snapshot reparse is permitted; original-file revalidation
is not.

## Durable retries and cancellation

Notebook-scoped request and canonical-URL receipts are persisted with unique
CREATE claims before provider dispatch. Reusing a key with changed payload
returns 409. An atomic, fsynced, bounded local checkpoint precedes deterministic
source/version creation. Unknown database acknowledgements retain bytes and can
be reconciled from that checkpoint without refetching. A browser restart can use
a new key to reconcile the **existing local** checkpoint, never scrape again.

Timeouts, ambiguous provider failures, oversized or unusable paid responses leave
an outcome-unknown tombstone. Without a checkpoint, neither old nor new keys can
silently repeat the potentially charged scrape. There is no force-paid-retry
endpoint; operator/provider review is required. Proven configuration/quota
rejections can be retried with a fresh key only after another explicit import
click. Worker enqueue failures can be retried locally; newer running, succeeded,
or locally cancelled job states are preserved. Deleted source/version/membership
targets return `WEB_IMPORTED_SOURCE_UNAVAILABLE`, not false cached success or
silent recreation.

Stop aborts an active search and prevents imports not yet dispatched. Dispatched
imports may still finish; closing the dialog is not server-side cancellation.
Unresolved result/key pairs survive close/reopen while the dialog is mounted.

## Validation

- Provider tests use httpx MockTransport; no live external provider or new key.
- Service tests cover receipt/commit acknowledgement loss, ambiguous billing,
  checkpoint integrity, local-only recovery, deletion replay and job-state races.
- `test_web_discovery_repository.py` is opt-in with `WEB_DISCOVERY_TEST_DB=1` and
  requires a dedicated `ws://127.0.0.1:` SurrealDB test instance. It creates a unique
  database and tests real claims, Source CREATE/relation, evidence extraction and
  portable export. Provider and worker remain mocked.
- Frontend tests cover explicit actions, configuration state, selection/concurrency
  bounds, cancellation, retry-key semantics, and partial-success presentation.

Live Firecrawl credentials, billing, real public-page compatibility, and browser
visual acceptance are not established by these automated tests.
