# Node/TypeScript coverage baseline

Run from repository root with the installed Node 24 toolchain:

- `npm run coverage`: serial partitions; failure/blocked partitions prevent success.
- `npm run coverage -- --only=web` (or contracts, domain, web-transport, bff, node-tools, legacy-web, legacy-node-tools).
- Each Vitest partition run is capped at 1 worker. node:test is capped at concurrency 2.
- Internal libraries are built before measurement. No application service or model endpoint is started.
- Results: `coverage/<partition>/coverage-summary.json`, coverage-final.json, lcov.info; run manifests include exit status and missing-source inventory.

## Denominator and partitions

Five modern runtime partitions explicitly include **all** first-party `src/**/*.{ts,tsx,js,jsx,mjs,cjs}`, including unimported files, browser entrypoints, BFF CLI, locale tables and error handling. Cross-workspace imports currently use package dist exports: package reports are conservative measurements from their own suites, not duplicated dist coverage attributed to the web UI.

Legacy frontend uses its original React/Next aliases and test setup, with the same all-src rule, independently of the SPA. Missing legacy dependencies produce a blocked partition, never a claimed 0%/100% test pass. No large legacy dependency installation is automatic.

Node build/asset/check scripts are measured separately with c8 --all, including subprocess coverage through NODE_V8_COVERAGE. Modern tools: apps/{bff,web}/scripts and scripts/v1. Legacy tools: frontend/scripts plus frontend/start-server.js. Unexecuted scripts remain in the denominator. BFF cli.ts remains in the BFF source denominator even if its child-process execution is not observed by Vitest; this is a limitation, not an exclusion.

## Exclusions with reasons

- *.test.*, *.spec.*: tests themselves, not production.
- *.d.ts: type declarations have no executable JavaScript.
- apps/web/src/test and frontend/src/test: test setup, fixtures and harnesses; web's development-only preview fixture lives here and is not shipped in production.
- node_modules, dist, .next, copied PDF.js/font assets: third-party or generated duplicates, outside explicit first-party source roots.
- Coverage orchestration/configuration under scripts/coverage-* is measured in quality-tooling and quality-configs, not excluded. Existing scripts/v1 production helpers remain included in node-tools.
- CSS, images, font files, JSON data and Python/shell programs are not executable JS/TS; they require appropriate separate validation/coverage. This report is not whole-repository coverage by itself.

No source is excluded merely for low coverage. Empty/type-only modules may have zero executable totals; percentages for those are not evidence of exercised logic. Missing-source audit is required before accepting any report. Test pass rate is not coverage. Four metrics (statements, branches, functions, lines) are retained separately; no averaged percentage is used.

## Known limits

The legacy workspace must have its own compatible dependency installation before legacy-web measurement. c8 and Vitest V8 use different remapping pipelines, so their partitions should not be presented as interchangeable coverage scores. Test failures still yield diagnostic reports when possible, but cannot satisfy a quality gate. A >90% claim requires each agreed metric/partition to exceed 90 and all tests plus source-inventory audits to pass.

## Repository-wide inventory and strict gate

`npm run coverage:scope` audits tracked and untracked nonignored JS/TS against the declared partitions. It writes `coverage/scope-audit.json`. Build/lint/test configuration entrypoints are included across quality-tooling, quality-configs and deployment-config; the three TypeScript config modules use the dedicated c8 runtime harness. `examples/easypanel/index.ts` and `frontend/next.config.ts` are measured in deployment-config. Inclusion alone does not prove their coverage thresholds pass. `apps/web/public/theme-bootstrap.js` is included in node-tools, not discarded as a static asset.

`npm run coverage:gate` requires every partition's last formal wrapper run to pass, have no missing/unexpected files, and match the current source digest. It compares raw integer counts (`10*covered > 9*total`) for all four metrics. Equal-to-90%, zero-total/N/A, malformed counts, missing or stale results fail. `npm run coverage:test` checks these policies and untouched-file inventory behavior.

On this baseline setup the legacy dependencies were installed separately by the coordinator with its own lockfile. Its Vitest/provider lock version is 4.1.9, distinct from modern workspace Vitest/provider 4.1.12; each uses its own matched runtime. No legacy install is performed by the runner.

## Fail-closed freshness and execution environment

Before any requested partition (including pretest builds), the wrapper atomically replaces that partition's manifest with `pending`. Build failure, interruption, or malformed summaries cannot reuse a previous successful manifest. Completed manifests bind the summary file hash and the digest of all tracked and nonignored first-party inputs, including cross-language helpers and binary fixtures, lockfiles and installed-package receipts. Changed tests, shared packages or configuration invalidate prior success, even when production code is unchanged.

Child processes receive only process-basics from the parent environment plus a temporary HOME/config/cache/application-state tree. Provider credentials, live opt-ins, proxies and inherited NODE_OPTIONS are not forwarded. Vite env-file discovery is disabled in coverage config. This does **not** provide OS-level network isolation: tests that intentionally create loopback fixture servers still can, and a spawned executable could explicitly use the network. The wrapper never modifies the user's environment or real application data.

Next's production `frontend/next.config.ts` is explicitly unmeasured (rather than being treated as a purely declarative testing config), alongside the EasyPanel executable example; these block the whole-JS/TS gate. The other five configuration entrypoints are separately syntax-checked, not counted as exercised application source.

### Deployment configuration entrypoints

`npm run coverage -- --only=deployment-config` measures the real
`examples/easypanel/index.ts` and `frontend/next.config.ts`, including
unexecuted code. Both participate in source inventory and the strict four-metric
gate; they are no longer unmeasured scope exceptions. Vitest uses one worker.
EasyPanel's injected random helpers are mocked with synthetic strings, never real
credentials. Next imports reset modules and restore the isolated child environment.
The test-only Input type mirrors the platform-generated meta.yaml interface via
TypeScript rootDirs; production configuration is unchanged.
Targeted types: `node node_modules/typescript/bin/tsc -p scripts/tests/deployment/tsconfig.json`.

### Quality tooling and separately measured build/test configurations

The original 24-file tooling scope is now split into disjoint inventories:

- `npm run coverage -- --only=quality-tooling`: official Vitest V8, 21 helper,
  CLI and workspace configuration files, one worker. CLI entrypoints that would
  invoke full suites are deliberately not executed; their source remains at zero.
- `npm run coverage -- --only=quality-configs`: official c8 + Node 24 + esbuild,
  three real source files: `apps/web/vite.config.ts`, `frontend/vitest.config.ts`,
  and `scripts/coverage-quality.config.ts`. They are not dropped from the project
  denominator, only moved out of Vitest's unavoidable configuration exclusions.

The Node suite evaluates the real configuration exports, including absent/empty,
valid and malformed artifact identity. It never starts a dev server or deploys.
Esbuild produces CommonJS with unmodified inline source maps under each source
workspace's ignored `coverage/quality-config-runtime` directory, so external
packages resolve from the correct workspace. Tests assert each map resolves to
the original source path and embeds its exact bytes. Stable per-source output
paths plus require-cache invalidation preserve V8 branch accumulation across
multiple environment cases. c8 remaps the actual native V8 counters to the three
source files; neither counts nor maps are manually synthesized. Generated files
are not first-party production source. Final source audits reject missing and
unexpected paths independently for both partitions.

Both partitions retain `--all`/explicit include semantics for unexecuted sources,
strict raw-ratio >90 checks, input/report hashes and persistent diagnostics. No
provider or node_modules patch is used. The old 21/24 missing report and failed
loader probes remain historical evidence; these new reports do not imply that
other partitions were refreshed or that whole-project coverage is >90%.


## Trusted Git prerequisite (S4036)

Git-backed input digests, scope audits and SPA artifact provenance no longer search ambient PATH. See [the trust/provisioning guide](../docs/quality/trusted-git.md). Provision the already-approved Git installation once per POSIX account. The OS account home, not HOME/XDG, locates the private registration, so the coverage runner's isolated temporary HOME does not bypass or lose it. The verified registration identity is included in inputDigest. New security helper/provisioning files remain in the quality-tooling production denominator. Native Windows is deliberately blocked until ACL validation is implemented; use WSL or Linux. No active CI workflow is added by this change.
