# jscpd health: initial local baseline (2026-11-13)

## Status

**Initial: 51.9/100, D (console rounds to 52), not an audited whole-repository
code-smell score.** This is not CodeScene or a universal quality percentage.
No weights, external health inputs, or blanket entry overrides were used.
No source was uploaded or application/browser workflow executed.

Tool: jscpd 5.4.3, MIT, official npm registry, isolated temporary installation
with --ignore-scripts. Repository dependencies unchanged. Primary references:
- https://github.com/kucherenko/jscpd/blob/v5.4.3/docs/rust.md#health-score
- https://github.com/kucherenko/jscpd/blob/v5.4.3/rust/crates/cpd-core/src/health.rs

Stable local evidence: /home/USER/notebook-quality-20261113/health.
Contains initial reports, versioned official source/docs, command-base.json,
merged config.log, independent dead-code and duplication reports, inventory.json
and entry-candidates.json. Working-tree snapshots, not an immutable release;
parallel quality-tool changes were in progress.

## Reproduction

Outside the repository: npm install --prefix /tmp/notebook-jscpd-audit
--ignore-scripts --no-audit --no-fund jscpd@5.4.3 (on one line).

From repository root with Node 24 on PATH:

    /tmp/notebook-jscpd-audit/node_modules/.bin/jscpd api open_notebook commands scripts deploy apps packages frontend/src frontend/scripts frontend/start-server.js frontend/next.config.ts examples run_api.py --format typescript,tsx,javascript,jsx,python,css --ignore '**/node_modules/**,**/dist/**,**/build/**,**/public/pdfjs/**,**/*.test.*,**/*.spec.*,**/test/**,**/tests/**,**/*.d.ts' --min-lines 5 --min-tokens 50 --mode mild --max-size 10mb --max-lines 100000 --workers 1 --no-gitignore --no-colors --no-tips --health --reporters json,console --output /tmp/notebook-jscpd-audit/health

Use the same base command without --health for independent duplicate JSON.
Add --dead-code for reachability; --summary --summary-top 10000 for file inventory;
--health --debug for effective config. No explicit --entry overrides.
min-lines=5, min-tokens=50, mild and health weights are defaults; max-size=10mb
and max-lines=100000 are explicit generous ceilings. workers=1 limits load.
No low-scoring production files were omitted. Exclusions are tests/specs,
test/tests directories, declaration-only .d.ts, generated build/dist,
dependencies, third-party PDF.js. Ancillary tooling, measurement scripts,
examples and both frontends remain included. CSS scanned but not health-scored.

## Formula and native result

| Dimension | Lines | Raw share | Adjusted share | Subscore |
|---|---:|---:|---:|---:|
| duplication | 19502 | 13.9% | 13.8% | 32.5 |
| estimated dead code | 3317 | 2.4% | 2.4% | 80.3 |
| lines in complex files | 63430 | 45.3% | 45.0% | 53.6 |

All weights 1; half-lives 8.5, 7.5, 50. Each share is mixed with 2000 prior lines
at corpus medians 3.5%, 3.1%, 20.9%:
adjusted=(share*total+median*2000)/(total+2000).
Subscore=100*2^(-adjusted/halfLife), internally rounded to one decimal;
total is the weighted geometric mean. Complex means file token-estimated
complexity >=50, NOT function cyclomatic complexity or Ruff C901.

Health: 692 files / 140036 lines. Independent duplication: 701 files /
143884 lines / 21230 duplicated lines. CSS: 9 files / 3848 lines /
1728 duplicated lines. Subtracting CSS exactly reconciles health's denominator
and 19502 duplicated-line numerator.

## Git inventory

git ls-files --cached --others --exclude-standard, narrowed to scan roots and
explicit exclusions: 735 expected files (including current untracked tools).
701 summary files matched uniquely, 0 unexpected and 0 ambiguous matches.
Paths shortened by jscpd were matched by suffix and, where needed, byte size.

| Root | Expected extensions and counts |
|---|---|
| api | .py: 67 |
| apps | .css: 7, .js: 1, .mjs: 4, .py: 3, .ts: 107, .tsx: 104 |
| commands | .py: 8 |
| deploy | .py: 1 |
| examples | .ts: 1 |
| frontend/next.config.ts | .ts: 1 |
| frontend/scripts | .mjs: 3 |
| frontend/src | .css: 2, .ts: 133, .tsx: 155 |
| frontend/start-server.js | .js: 1 |
| open_notebook | .py: 64 |
| packages | .ts: 29 |
| run_api.py | .py: 1 |
| scripts | .mjs: 10, .py: 32, .ts: 1 |

**Denominator limitation:** 34 files are omitted by the default summary.
A separate inventory-only diagnostic at min-lines=1/min-tokens=1 reports
730 files, all nonempty expected files; five empty Python __init__.py account
for the rest. This diagnostic is NOT a replacement score. Default clone thresholds
also filter short nonempty files out of health duplication/complexity metrics.
Therefore 51.9 cannot claim strict all-file coverage.

Default-summary omissions:
- api/__init__.py (0 bytes)
- api/routers/__init__.py (0 bytes)
- api/source_upload_limits.py (297 bytes)
- apps/bff/coverage.config.ts (102 bytes)
- apps/web/coverage.config.ts (200 bytes)
- apps/web/src/app/command-destinations.ts (339 bytes)
- apps/web/src/features/auth/LoginRoute.tsx (263 bytes)
- apps/web/vite.config.ts (518 bytes)
- frontend/src/app/(auth)/login/page.tsx (238 bytes)
- frontend/src/app/(dashboard)/page.tsx (112 bytes)
- frontend/src/app/api/_sse-proxy.ts (256 bytes)
- frontend/src/app/page.tsx (108 bytes)
- frontend/src/components/sources/index.ts (145 bytes)
- frontend/src/lib/api/capabilities.ts (405 bytes)
- frontend/src/lib/theme-script.ts (777 bytes)
- frontend/src/lib/types/notebook-context.ts (303 bytes)
- frontend/src/lib/utils.ts (166 bytes)
- frontend/src/lib/utils/katex-options.ts (1014 bytes)
- frontend/start-server.js (197 bytes)
- open_notebook/__init__.py (0 bytes)
- open_notebook/ai/__init__.py (88 bytes)
- open_notebook/database/note_contract.py (251 bytes)
- open_notebook/domain/__init__.py (143 bytes)
- open_notebook/graphs/tools.py (319 bytes)
- open_notebook/integrations/__init__.py (0 bytes)
- open_notebook/integrations/notebooklm/__init__.py (0 bytes)
- open_notebook/podcasts/__init__.py (84 bytes)
- packages/contracts/coverage.config.ts (108 bytes)
- packages/contracts/src/index.ts (130 bytes)
- packages/contracts/src/runtime-config.ts (293 bytes)
- packages/domain/coverage.config.ts (105 bytes)
- packages/domain/src/index.ts (267 bytes)
- packages/domain/src/navigation.ts (288 bytes)
- packages/web-transport/coverage.config.ts (112 bytes)

## Dead-code and entries

Independent dead-code: 726 files / 140220 lines, 122 inferred entries,
716 reachable files, 0 unparsed files. No unparsedFiles list emitted at zero.
726 equals 735 inventory files minus 9 CSS, including short and empty files.
The dead-code and health clone denominators differ. Findings: 10 unused files
(2384 lines), 37 unused exports (402), 11 unused symbols (520), 11 unused
imports (11): 3317 total estimated dead lines.

Verified anchors: apps/web/index.html loads src/main.tsx and theme-bootstrap.js;
run_api.py invokes api.main:app through uvicorn. BFF package scripts/exports,
package public src/index.ts surfaces and Next app routes provide runtime/public
entry evidence. Do not treat dynamically loaded framework symbols as dead.

Tool JSON gives only entry count, not all inferred entry paths. The independent
source-side candidate list below is NOT a verification of every one of the 122
tool-selected entries, and was not passed as blanket --entry:
- api/__init__.py: Python package initialization (tool convention)
- api/main.py: runtime bootstrap (verify launch/HTML/package references)
- api/routers/__init__.py: Python package initialization (tool convention)
- apps/bff/src/cli.ts: runtime bootstrap (verify launch/HTML/package references)
- apps/web/public/theme-bootstrap.js: runtime bootstrap (verify launch/HTML/package references)
- apps/web/src/main.tsx: runtime bootstrap (verify launch/HTML/package references)
- commands/__init__.py: Python package initialization (tool convention)
- frontend/src/app/(auth)/login/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/advanced/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/layout.tsx: Next app route convention
- frontend/src/app/(dashboard)/notebooks/[id]/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/notebooks/[id]/study/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/notebooks/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/podcasts/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/search/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/settings/models/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/settings/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/sources/[id]/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/sources/page.tsx: Next app route convention
- frontend/src/app/(dashboard)/transformations/page.tsx: Next app route convention
- frontend/src/app/api/[...path]/route.ts: Next app route convention
- frontend/src/app/api/auth/[...path]/route.ts: Next app route convention
- frontend/src/app/api/personal/imports/portable/route.ts: Next app route convention
- frontend/src/app/api/search/ask/route.ts: Next app route convention
- frontend/src/app/api/sources/[sourceId]/chat/sessions/[sessionId]/messages/route.ts: Next app route convention
- frontend/src/app/config/route.ts: Next app route convention
- frontend/src/app/dev/design/page.tsx: Next app route convention
- frontend/src/app/layout.tsx: Next app route convention
- frontend/src/app/page.tsx: Next app route convention
- frontend/start-server.js: runtime bootstrap (verify launch/HTML/package references)
- open_notebook/__init__.py: Python package initialization (tool convention)
- open_notebook/ai/__init__.py: Python package initialization (tool convention)
- open_notebook/domain/__init__.py: Python package initialization (tool convention)
- open_notebook/integrations/__init__.py: Python package initialization (tool convention)
- open_notebook/integrations/notebooklm/__init__.py: Python package initialization (tool convention)
- open_notebook/podcasts/__init__.py: Python package initialization (tool convention)
- open_notebook/utils/__init__.py: Python package initialization (tool convention)
- packages/contracts/src/index.ts: package export source
- packages/domain/src/index.ts: package export source
- packages/web-transport/src/index.ts: package export source
- run_api.py: runtime bootstrap (verify launch/HTML/package references)
- deploy/v1/entrypoint.py: Python main guard
- scripts/check_md_links.py: Python main guard
- scripts/export_docs.py: Python main guard
- scripts/historical_database_pytest.py: Python main guard
- scripts/offline_pytest.py: Python main guard
- scripts/v1/audio_playback_check.py: Python main guard
- scripts/v1/browser_check.py: Python main guard
- scripts/v1/check_spa_artifacts.py: Python main guard
- scripts/v1/container_check.py: Python main guard
- scripts/v1/export_contract.py: Python main guard
- scripts/v1/export_delivery_check.py: Python main guard
- scripts/v1/live_check.py: Python main guard
- scripts/v1/local_check.py: Python main guard
- scripts/v1/maintenance_crash_check.py: Python main guard
- scripts/v1/model_acceptance_check.py: Python main guard
- scripts/v1/portable_limits_check.py: Python main guard
- scripts/v1/prepare_canonical_publication.py: Python main guard
- scripts/v1/prepare_private_snapshot.py: Python main guard
- scripts/v1/run_native.py: Python main guard
- scripts/v1/spa_acceptance.py: Python main guard
- scripts/v1/spa_cutover_plan.py: Python main guard
- scripts/v1/spa_native_runtime.py: Python main guard
- scripts/v1/ux_recovery_check.py: Python main guard

Dynamic Python imports, getattr, plugin registration, decorators and string
module references can confuse reachability. Default confidence floor is 60;
the tool reduces confidence for ambiguous evidence. Zero parser failures is not
proof of complete reachability. Each dead-code finding needs review before
deletion. No dead-code removals were made.

## Other scope

Shell/PowerShell/batch excluded by the format selection:
- dev-init.sh
- scripts/docker-entrypoint.sh
- scripts/release-test/rc-stack.sh
- scripts/release-test/release-image-test.sh
- scripts/wait-for-api.sh

HTML/templates, CSS health, config/data, binary assets, runtime provider behavior,
security and tests/coverage are not measured by this single score. Keep Ruff
function complexity separate from jscpd file-token complexity. Scope reconciliation
does not certify inferred entries or establish cross-project comparability.
