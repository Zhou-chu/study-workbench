# Standalone BFF A2 parity ledger

Date: 2026-11-08. Scope: the isolated SPA/BFF foundation only, not deployment approval.

## Preserved

- The independently checked-in 153 reviewed method/path/kind entries plus only A1 GET workspace-view and GET client-capabilities. Public BFF metadata declares its own support, not actual authenticated API capabilities.
- Legacy password Bearer, original status/probe shapes, credential-free fresh backend mode checks before every dispatch and upload, fixed internal upstream and upstream Cookie stripping. A no-Origin listed legacy GET with ingress Cookie and Bearer remains usable.
- Device session custody, bounded auth/list JSON (8 KiB/256 KiB), exact Origin plus CSRF and mixed-credential rules, refresh/admission/revocation algorithms and sanitized errors. Explicit native passthrough remains false by default.
- Encoded colon/Unicode IDs and query bytes; original multipart boundaries/chunked bytes, protected download Range/validators, both POST SSE routes and GET event streams; cancellation, backpressure and no redirect following.
- Existing FastAPI/Next source and tests, independent frontend lock, data, production processes, configuration, ports, access allowlist and private native-ingress gates.

## Intentional approved differences

The binding [A2 security/origin addendum](2026-11-08-notebook-bff-A2-addendum.md) supersedes a literal legacy fallback extraction.

1. The old legacy Next dispatcher fabricates a policy for unknown/unlisted routes and can reconstruct a destination from legacyPath. The new BFF validates the original raw method/target before body, credentials or readiness in both modes. No fallback, alias, arbitrary upstream or runtime OpenAPI expansion exists.
2. The old success regression for GET /api/commands/registry/debug (session-proxy.test.ts, original lines 743-754) is intentionally split in the new package: listed GET /api/notebooks proves password Bearer/Cookie compatibility, while debug is a local 404 without any upstream call. The original reference test is unchanged.
3. Legacy now requires an explicit valid STUDY_WORKBENCH_WEB_ORIGIN too. Missing/empty/nonexact origin rejects handler/server/CLI configuration before readiness, with a fixed AUTH_UNAVAILABLE error and no rejected value logging. Host and forwarding fields never provide authority. HTTPS is normal; insecure literal loopback remains explicitly gated in the environment loader and forbidden in production.
4. Safe allowed GET/HEAD may omit Origin in both modes; supplied Origin must exactly match and invalid/cross-site Fetch Metadata is rejected. Unlisted HEAD/wrong methods are local 405, unknown/noncanonical targets local 404. OPTIONS is local for a recognized path and valid requested method, with no upstream call.
5. Legacy browser writes require the exact configured Origin, without adding device CSRF. No-Origin writes require explicit nativePassthrough=true, no browser sec-fetch metadata, no app/obsolete credential cookies and existing explicit Bearer. Only synthetic fixtures enable it; no runtime mode/ingress has been enabled.
6. Canonical device-session auth remains legacy-unavailable (503) before body reads. Encoded auth aliases are route-policy refusals (404), not an obligation to mimic the old broad fallback's 503.
7. The reference Next rewrite-configuration assertion is framework-specific and stays in its original test. The new package substitutes an explicit no-framework/browser/legacy-import dependency boundary assertion. The store/proxy algorithm tests are otherwise migrated, with the documented new-package origin/method expectations only.

## Public interfaces and use

- @study/bff exports createBffHandler(config: BffConfig, options?: ProxyOptions): (request: Request) => Promise<Response>, createBffServer(config: BffConfig): node:http.Server, getWebSessionConfig(), and BffConfig/BffHandler types. The optional options argument is a deterministic Fetch/store test seam, not client configuration.
- Factories do not listen. Only the compiled CLI calls listen; it owns only its created server and closes that server on SIGINT/SIGTERM. No process-name kills or service management are used.
- BffConfig migrates mode, publicOrigin, internalOrigin, cookieName, secure, nativePassthrough and webSessionProtocol. Known environment names are unchanged: STUDY_WORKBENCH_AUTH_MODE, STUDY_WORKBENCH_WEB_ORIGIN, STUDY_WORKBENCH_AUTH_ORIGINS (device mode), STUDY_WORKBENCH_WEB_NATIVE_PASSTHROUGH, STUDY_WORKBENCH_WEB_ALLOW_INSECURE_LOOPBACK, INTERNAL_API_URL and NODE_ENV. CLI PORT defaults to 3000 and binds loopback; this CLI was not activated against real services.
- contracts exports RuntimeConfig = { apiUrl: ''; auth_mode: 'legacy_password'|'device_sessions'; web_session_protocol: 'bff-memory-v1'|null; client_contracts: readonly string[]; ui_transport_protocol: 1 }. GET /config emits the exact same-origin wire fields and client_contracts: ['workspace-view-v1'].
- The package prebuild/pretypecheck scripts build its contracts declaration dependency. No legacy source import, Next/server-only/React/browser server dependency, or frontend lock replacement is introduced.

## Evidence and remaining gates

The A2 execution report contains full commands and output for RED/GREEN and final checks. Independent handler tests exercise all 155 entries in both modes, explicitly treating auth entries as mode/transport appropriate. Raw native HTTP tests exercise malformed/encoded targets, wrong methods, duplicate authority fields and fixed-upstream routing before Request normalization. Local integration uses only synthetic fixed upstreams and ephemeral owned Node servers, including real device protocol fixtures without enabling runtime device mode.

This foundation is dormant. Browser deployment, API/database/worker/provider acceptance, real private ingress/device activation, old-loaded-tab cutover compatibility, production config and release remain separate later gates. No production or public deployment was performed.
