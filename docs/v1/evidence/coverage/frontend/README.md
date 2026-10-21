# Frontend V8 coverage evidence

Final verification: **266 tests passed in 48 files**, TypeScript passed, full ESLint passed with 7 unchanged upstream warnings, and a fresh production build passed. Tool versions: installed Vitest 4.1.9, coverage-v8 4.1.9, Node 24.19.0. Runs use the local Node entrypoint; no dependencies were installed for coverage.

## Scope and interpretation

- Explicit include: all production `frontend/src/**/*.{ts,tsx}`, including files not imported by tests. Test files, `src/test/**`, and declarations are excluded. Build scripts, dependencies and PDF.js vendor-worker code are outside this scope.
- Whole-frontend denominator: 233 measured files, upstream plus V1.
- V1 scope is frozen against upstream commit `a0f6f3081ae06328f0a451b3a3ef2959ca25721d`; see `v1-production-files.json`. It counts **entire changed/new files**, not only changed lines. 36 files include locale/type files; the functional subset has 20 files.
- Counts are executable V8/Istanbul lines/statements/branches, not physical source-file line counts. A 0/0 branch count is not proof that behavior was tested.
- The suite combines unit, React/jsdom component and transport-contract tests. Components use controlled API responses. The 16 added transport tests use the actual shared Axios interceptors, ID encoding, JSON/FormData serialization and response handling, replacing only the final network adapter. They perform no network/account/model actions.
- These are **instrumented Vitest measurements only**. Separately verified live-browser flows cover some APIs, PDF rasterization and responsive layout but are not instrumented here. Initial 0% wrapper coverage did not mean those browser flows were untested. Coverage does not establish real Google/model compatibility or exhaustive correctness.

## Three preserved measurements

1. `baseline/`: initial 237-test coverage snapshot, before the bounded transport-contract pass.
2. `transport-pass/`: 253 tests, after adding 16 transport tests. No production code changed in this phase.
3. Current directory: 266 tests. A subsequently reported real correctness bug required a small production fix: restored exact subquotes previously failed full-quote equality and opened page 1. The shared validator now checks canonical evidence identity and exact bounded Unicode offsets, deriving page/block identity from canonical evidence while retaining the unverified label. Thirteen additional regressions cover restored physical page 2, Unicode offsets, mismatched identities and invalid bounds. Focused regressions went red→green; production was rebuilt afterward.

The final denominators change because of that justified production fix. No arbitrary coverage target was used, and unrelated UI was not expanded. `comparison.json` preserves all numerator/denominator counts and the upstream base commit.

| Scope / metric | Initial | Transport tests only | Final, with subquote fix |
| --- | --- | --- | --- |
| Whole frontend: lines | 1,337/5,354 (24.97%) | 1,380/5,354 (25.77%) | 1,393/5,366 (25.95%) |
| Whole frontend: branches | 1,262/4,482 (28.15%) | 1,269/4,482 (28.31%) | 1,296/4,506 (28.76%) |
| Whole frontend: statements | 1,453/5,816 (24.98%) | 1,497/5,816 (25.73%) | 1,516/5,833 (25.99%) |
| V1 whole files: lines | 328/465 (70.54%) | 371/465 (79.78%) | 384/477 (80.50%) |
| V1 whole files: branches | 412/700 (58.86%) | 419/700 (59.86%) | 446/724 (61.60%) |
| V1 whole files: statements | 411/647 (63.52%) | 455/647 (70.32%) | 474/664 (71.39%) |
| V1 functional: lines | 312/449 (69.49%) | 355/449 (79.06%) | 368/461 (79.83%) |
| V1 functional: branches | 412/700 (58.86%) | 419/700 (59.86%) | 446/724 (61.60%) |
| V1 functional: statements | 395/631 (62.60%) | 439/631 (69.57%) | 458/648 (70.68%) |

## Final functional V1 whole-file breakdown

| File | Lines | Branches | Statements |
| --- | --- | --- | --- |
| `src/app/(dashboard)/notebooks/[id]/study/page.tsx` | 4/4 (100.00%) | 0/0 (not applicable) | 5/5 (100.00%) |
| `src/app/(dashboard)/notebooks/components/NotebookHeader.tsx` | 10/14 (71.42%) | 4/12 (33.33%) | 10/16 (62.50%) |
| `src/components/evidence/EvidenceReader.tsx` | 44/53 (83.01%) | 86/113 (76.10%) | 52/69 (75.36%) |
| `src/components/evidence/PdfCanvas.tsx` | 44/44 (100.00%) | 26/34 (76.47%) | 53/55 (96.36%) |
| `src/components/integrations/NotebookLMPanel.tsx` | 42/68 (61.76%) | 82/146 (56.16%) | 51/103 (49.51%) |
| `src/components/layout/AppShell.tsx` | 4/4 (100.00%) | 1/2 (50.00%) | 5/5 (100.00%) |
| `src/components/workbench/JobsPanel.tsx` | 13/19 (68.42%) | 29/63 (46.03%) | 17/31 (54.83%) |
| `src/components/workbench/PortableControls.tsx` | 7/8 (87.50%) | 9/22 (40.90%) | 12/17 (70.58%) |
| `src/components/workbench/StudyWorkbench.tsx` | 84/98 (85.71%) | 122/207 (58.93%) | 122/170 (71.76%) |
| `src/components/workbench/TurnCoverage.tsx` | 6/6 (100.00%) | 14/14 (100.00%) | 7/7 (100.00%) |
| `src/lib/api/client.ts` | 26/26 (100.00%) | 17/24 (70.83%) | 26/26 (100.00%) |
| `src/lib/api/evidence.ts` | 7/7 (100.00%) | 0/0 (not applicable) | 7/7 (100.00%) |
| `src/lib/api/notebooklm.ts` | 17/17 (100.00%) | 3/3 (100.00%) | 17/17 (100.00%) |
| `src/lib/api/portable.ts` | 4/14 (28.57%) | 7/7 (100.00%) | 5/16 (31.25%) |
| `src/lib/api/query-client.ts` | 6/17 (35.29%) | 0/2 (0.00%) | 6/17 (35.29%) |
| `src/lib/api/workbench.ts` | 16/16 (100.00%) | 2/2 (100.00%) | 17/17 (100.00%) |
| `src/lib/hooks/use-notebooklm.ts` | 6/6 (100.00%) | 5/12 (41.66%) | 7/13 (53.84%) |
| `src/lib/hooks/use-workbench.ts` | 9/16 (56.25%) | 5/9 (55.55%) | 12/20 (60.00%) |
| `src/lib/utils/evidence.ts` | 15/15 (100.00%) | 32/32 (100.00%) | 22/22 (100.00%) |
| `src/lib/utils/workbench.ts` | 4/9 (44.44%) | 2/20 (10.00%) | 5/15 (33.33%) |

## Remaining gaps

NotebookLMPanel remains 42/68 executable lines and 82/146 branches; connection, pagination, artifact and error-state permutations are not exhaustive. StudyWorkbench has high line coverage but substantially lower branch coverage, so history/loading/error combinations remain partially measured. JobsPanel remains 13/19 lines and 29/63 branches; polling, cancellation and playback error permutations are partial. Portable API lines remain 4/14 despite separately verified real-browser export/restore workflows. Shared query-client configuration is measured as a whole modified file and includes upstream code unrelated to V1.

The whole-frontend result is also lowered by large upstream uninstrumented areas: GeneratePodcastDialog (0/198 lines), AddSourceDialog (0/186), sources page (0/161), source-references (0/150) and use-podcasts (0/124). It must not be presented as V1-only coverage.

Evidence/workbench/NotebookLM transport wrappers are now line-covered by explicit contract tests, including exact scope/identity, application authentication, idempotency and no automatic replay. Line coverage still does not imply all remote failure modes or payload combinations are tested.

## Reproduction

Run from `frontend/`, using the already installed local entrypoint:

```sh
node ./node_modules/vitest/vitest.mjs run --coverage --coverage.include='src/**/*.{ts,tsx}' --coverage.exclude='src/**/*.test.{ts,tsx}' --coverage.exclude='src/test/**' --coverage.exclude='src/**/*.d.ts' --coverage.reporter=text --coverage.reporter=json --coverage.reporter=json-summary --coverage.reportsDirectory=../docs/v1/evidence/coverage/frontend --coverage.clean=false --reporter=default --reporter=json --outputFile.json=../docs/v1/evidence/coverage/frontend/tests.json
```

`command.txt` records exact tool versions and command. `run.txt` contains the complete final test/text coverage output. `tests.json` is the machine-readable test result; `coverage-final.json` is the detailed Istanbul map; `coverage-summary.json` covers the whole frontend; `v1-file-coverage.json` contains the frozen V1 file metrics. `transport-tests.txt`, `subquote-red.txt`, and `subquote-focused.txt` preserve focused regression evidence.

Final typecheck: `node ./node_modules/typescript/bin/tsc --noEmit` (exit 0).
Final lint: `node ./node_modules/eslint/bin/eslint.js src/` (exit 0, 7 existing warnings).
Final build: `node scripts/prepare-pdf-assets.mjs` followed by `NEXT_TELEMETRY_DISABLED=1 node ./node_modules/next/dist/bin/next build` (exit 0).

Top-level `../../frontend-tests.json` and `../../frontend-tests.txt` are updated to this final 266-test instrumented run. Latest build/type/lint evidence is in the sibling top-level evidence files. No commits or external account calls were made by this frontend task.
