# Independent SPA artifact identity (C1 source gate)

C1 is source delivery, not deployment. The target is exactly static Web/nginx gateway, one standalone BFF, API, worker and DB. No Next renderer is a hidden sixth dependency. The old frontend Dockerfile and artifacts remain available; neither their receipts nor their compatibility are replaced by SPA receipts.

## Build and pure checks

Use prepared Linux Node >=24, frozen repository locks and an environment-minimized offline runner. C1 was checked with prepared Node 24.19.0; the recipes pin Node 24.22.2 and nginx 1.30.6. No image was pulled, built or started.

Commit the complete source first. Both independent commands reject a dirty or untracked source checkout:

- npm -w @study/web run build
- npm -w @study/bff run build
- node apps/web/scripts/build-manifest.mjs --verify apps/web/dist
- node apps/bff/scripts/build-manifest.mjs --verify apps/bff/dist
- "$PYTHON" scripts/v1/check_spa_artifacts.py --web apps/web/dist --bff apps/bff/dist --contract contracts/v1/openapi.json

Each builder invalidates the previous dist by moving it to its own ignored build/previous-* directory, allocates an exclusive slot, rebuilds actual transitive workspace compiler inputs, and builds into an isolated candidate. It preserves old bytes instead of deleting them. A source/HEAD drift check runs before success is published. Failed candidates and used slots remain distinguishable; they are not reusable successes. No dependency download is performed. Vite dotenv loading is disabled; public source maps are disabled.

Do not delete old releases because a timer expired. Explicitly stage the current artifact and EVERY artifact in the declared supported client window into a previously nonexistent output:

node apps/web/scripts/build-manifest.mjs --stage-gateway apps/web/gateway/dist apps/web/dist /absolute/path/to/retained-web-dist

The first argument after the output is current. Retained paths are supplied explicitly, not auto-discovered from operator storage. Each release is copied whole under /_spa/releases/<slot>/; original manifest, inventory, index, bootstrap and payload remain exact. The stage records client-window.json only after copies and validates all staged bytes. Reused slots, extra bytes, changed retained copies, content-hashed asset path collisions and different bytes at the same literal PDF version path fail closed. Re-staging requires a fresh output directory. No forced TTL eviction or new durable draft facility is supplied.

The new Dockerfiles are **artifact-first packaging recipes**. Their pinned Node verification stages check the supplied artifacts, then copy only that measured closure into the respective runtime. They do not install packages or compile against an unavailable network at image build time. Web has no Node or Next runtime. BFF contains its measured local ESM package.json and emitted modules, no Next/React/root dependency tree. The selected official base images and accompanying notices are documented in deploy/v1/THIRD_PARTY_NOTICES.md. Image filesystem contents and runtime startup still require C2 authorization and verification.

API and worker remain the identical backend recipe from the SAME final clean checkout that produced both manifests. This includes the accepted B9e graph correction. Exact public OpenAPI byte equality does not establish equal backend behavior. Image builders/operators must record the actual clean context, component image digests, runtime config and served identities during the later authorized gate; a local tag is not that proof.

## Exact manifests and inventory

Each dist has exactly these manifest fields:

SpaArtifactManifest = { schema_version: 'spa-artifact-v1', source_commit, authored_digest, asset_digest, contract_digest, ui_transport_protocol: 1, supported_contracts: ['workspace-view-v1'] }

The inventory schema is spa-inventory-v1 with exact keys kind, release_slot, authored and assets (plus schema_version). Both arrays use sorted unique relative paths; each entry contains path, size in bytes, mode ('0644' or '0755') and SHA-256. Canonical encoding is UTF-8 JSON, recursively key-sorted without whitespace, with a single trailing newline in metadata files. Digests hash the canonical array WITHOUT a trailing newline. Duplicate keys/noncanonical metadata are rejected.

- source_commit is the real clean committed HEAD used before and after building, not a user-provided label.
- authored_digest covers actual tracked app sources/public files/scripts/config, transitive workspace sources/manifests, root package/lock/tsconfig, selected OpenAPI and relevant deployment/verification scripts. The exact list is stored. Generated slot input is excluded from authored files.
- asset_digest covers every packaged regular payload file, including artifact-identity.json, actual PDF assets, fonts/licenses and local BFF package metadata. Only the two top-level manifest/inventory files are excluded to break cycles. Undeclared extra bytes and missing bytes both fail.
- contract_digest is SHA-256 of the exact selected contracts/v1/openapi.json bytes. The independent Python gate checks both manifests against the same contract and source checkout.
- Generated PDF assets are checked against the pinned installed PDF package, including its own full inventory and license, before build, and measured as payload. A literal /pdfjs/6.4.299/ path is not a content hash.

Paths are bounded and reject traversal, symlinks (including ancestors), special files, unsafe/private names and private sentinels before accepting bytes. BFF verification audits the actual emitted ESM closure, permits only Node builtins/local emitted modules, rejects dynamic dependency loading and rejects unexpected payload types. This is a measured closure and source association, not a reproducible-build, artifact signature, registry availability or API-availability proof.

## Running bundle association

Before asset hashing, each bundle embeds its own slot, source/authored/contract digests and protocol/contract expectations. It reads only its fixed same-origin /_spa/releases/<slot>/spa-artifact-manifest.json and verifies those expectations. It never substitutes a mutable latest manifest. The asset digest is completed afterward and is not injected into the payload it hashes. Missing metadata is unavailable; mismatched metadata is blocked. This association is not an auth token or a new API protocol and does not authenticate a malicious server.

## One compatibility/readiness owner

createSessionController remains the sole owner. AppProviders supplies one app-lifetime immutable artifact identity reader, not another auth store. evaluateCompatibility(localManifest, runtimeConfig, apiCapabilities) returns compatible, blocked or unavailable. BFF /config cannot substitute for the authenticated existing /api/personal/client-capabilities read.

Explicit recheck and recovery from hidden/offline pages single-flight on the current ticket/coordinator. Evidence is stale after 60 seconds. A request encountering stale evidence starts revalidation and returns not-dispatched; it is never continued or replayed after the async check. The final native-fetch admission fence stays synchronous. Late evidence cannot revive a newer suspended context.

Compatibility loss suspends readiness, not identity or privacy. It does not sign out, clear server data, retire drafts, change original File/operation captures or discard confirmed-delete text. The retained workspace is inert, not interactive read-only. The explicit Update action uses the same navigation owner and checks every registry participant, unresolved editor state and navigation capture synchronously. Route-retain does not permit document reload. If any draft/File/pending/unknown obligation remains, updating is refused and the original content stays in memory.

## Gateway and open acceptance gates

Only web declares host 127.0.0.1:8502 -> nonprivileged port 8080. BFF binds 0.0.0.0 internally with no host port; native default stays 127.0.0.1. Its socket host accepts only those two literals and never changes trust. Production HTTPS, legacy_password, exact configured public origin, single BFF and API/worker shared roots/file locks remain unchanged.

The gateway preserves raw API/config targets to the existing exact gate; rejects ambiguous path encodings/normalization; never lets those namespaces become SPA HTML. Only known document routes get index. Unknown documents and missing assets/manifests get non-HTML 404. Bootstrap/index/config/API/auth/private streams/downloads are no-store. Only content-hashed assets are immutable; literal PDF version files revalidate. Fixed upstream/Host, real Origin/Fetch Metadata/CSRF and Cookie boundaries, range/multipart, multiple Set-Cookie, streaming abort/backpressure and no replay/buffering/caching remain required.

Static source tests cannot prove actual nginx normalization or proxy behavior. Docker build/startup, official image contents/licenses, Node 24.22.2 execution, five-service synthetic runtime, served bytes, uploads/downloads/SSE through real nginx, browser/accessibility/current pixels and production are NOT_RUN in C1.

F10 remains owner-observed save/reconcile/exit in BOTH directions, otherwise defer. An unseen/offline old tab is not safe because time passed. Legacy Next has a broad legacy_password fallback: absent allowlist entries alone do not prove rejection. Actual cached targets, Next navigation, old producers, component/schema/data compatibility, backup/restore and unknown operation custody remain live evidence gates. No bridge, force refresh, method-only write fence, provider action, browser workaround, C2/C3 execution, push or deployment is authorized by this document.
