# Frontend V8 coverage evidence

Measured with the installed Vitest 4.1.9 and coverage-v8 4.1.9 on Node 24.19.0. The final run passed **253 tests in 48 files**. No production code was changed during the coverage follow-up; 16 transport contract tests were added. The last successful production build is retained unchanged; only tests and evidence changed afterward, so no new build was run. No model, Google or external network calls were made by those tests.

## Scope and interpretation

- Explicit include: all production `frontend/src/**/*.{ts,tsx}`, including files not imported by tests. Test files, `src/test/**`, and declarations are excluded. Build scripts, dependencies and browser-worker vendor code are outside this scope.
- Whole-frontend denominator: 233 measured files, upstream plus V1.
- V1 scope is frozen against upstream commit `a0f6f3081ae06328f0a451b3a3ef2959ca25721d`; see `v1-production-files.json`. It counts **entire changed/new files**, not only changed lines. 36 files include locale/type files; the functional subset has 20 files.
- Counts are Istanbul/V8 executable lines/statements/branches, not physical source-file line counts. A 0/0 branch count is not proof that behavior was tested.
- The suite combines unit, React/jsdom component, and local transport-contract tests. React component tests use controlled API responses. The added transport tests exercise the actual shared Axios interceptors, ID encoding, JSON/FormData serialization and response handling, replacing only the final network adapter.
- This is instrumented Vitest coverage only. The separately verified live-browser flows cover some APIs, PDF rasterization and responsive layout but are **not instrumented here**. An initial 0% wrapper measurement did not imply that those browser flows were untested. Coverage does not establish real Google/model compatibility or exhaustive correctness.

## Before and after the bounded transport-test pass

| Scope / metric | Before | After |
| --- | --- | --- |
| Whole frontend lines | 1,337/5,354 (24.97%) | 1,380/5,354 (25.77%) |
| Whole frontend branches | 1,262/4,482 (28.15%) | 1,269/4,482 (28.31%) |
| Whole frontend statements | 1,453/5,816 (24.98%) | 1,497/5,816 (25.73%) |
| V1 whole-file lines | 328/465 (70.54%) | 371/465 (79.78%) |
| V1 whole-file branches | 412/700 (58.86%) | 419/700 (59.86%) |
| V1 whole-file statements | 411/647 (63.52%) | 455/647 (70.32%) |
| V1 functional lines, excluding locales/types | 312/449 (69.49%) | 355/449 (79.06%) |
| V1 functional statements, excluding locales/types | 395/631 (62.60%) | 439/631 (69.57%) |

Raw initial results are preserved in `baseline/`. `comparison.json` and both `v1-file-coverage.json` files contain all numerator/denominator counts and the fixed upstream commit.

## Functional V1 whole-file breakdown

| File | Lines | Branches | Statements |
| --- | --- | --- | --- |
| `src/app/(dashboard)/notebooks/[id]/study/page.tsx` | 4/4 (100%) | 0/0 (no instrumented branches) | 5/5 (100%) |
| `src/app/(dashboard)/notebooks/components/NotebookHeader.tsx` | 10/14 (71.42%) | 4/12 (33.33%) | 10/16 (62.5%) |
| `src/components/evidence/EvidenceReader.tsx` | 42/52 (80.76%) | 80/110 (72.72%) | 49/68 (72.05%) |
| `src/components/evidence/PdfCanvas.tsx` | 44/44 (100%) | 26/34 (76.47%) | 53/55 (96.36%) |
| `src/components/integrations/NotebookLMPanel.tsx` | 42/68 (61.76%) | 82/146 (56.16%) | 51/103 (49.51%) |
| `src/components/layout/AppShell.tsx` | 4/4 (100%) | 1/2 (50%) | 5/5 (100%) |
| `src/components/workbench/JobsPanel.tsx` | 13/19 (68.42%) | 29/63 (46.03%) | 17/31 (54.83%) |
| `src/components/workbench/PortableControls.tsx` | 7/8 (87.5%) | 9/22 (40.9%) | 12/17 (70.58%) |
| `src/components/workbench/StudyWorkbench.tsx` | 83/97 (85.56%) | 124/209 (59.33%) | 121/169 (71.59%) |
| `src/components/workbench/TurnCoverage.tsx` | 6/6 (100%) | 14/14 (100%) | 7/7 (100%) |
| `src/lib/api/client.ts` | 26/26 (100%) | 17/24 (70.83%) | 26/26 (100%) |
| `src/lib/api/evidence.ts` | 7/7 (100%) | 0/0 (no instrumented branches) | 7/7 (100%) |
| `src/lib/api/notebooklm.ts` | 17/17 (100%) | 3/3 (100%) | 17/17 (100%) |
| `src/lib/api/portable.ts` | 4/14 (28.57%) | 7/7 (100%) | 5/16 (31.25%) |
| `src/lib/api/query-client.ts` | 6/17 (35.29%) | 0/2 (0%) | 6/17 (35.29%) |
| `src/lib/api/workbench.ts` | 16/16 (100%) | 2/2 (100%) | 17/17 (100%) |
| `src/lib/hooks/use-notebooklm.ts` | 6/6 (100%) | 5/12 (41.66%) | 7/13 (53.84%) |
| `src/lib/hooks/use-workbench.ts` | 9/16 (56.25%) | 5/9 (55.55%) | 12/20 (60%) |
| `src/lib/utils/evidence.ts` | 5/5 (100%) | 9/9 (100%) | 7/7 (100%) |
| `src/lib/utils/workbench.ts` | 4/9 (44.44%) | 2/20 (10%) | 5/15 (33.33%) |

## Remaining consequential gaps

NotebookLMPanel has 42/68 executable lines and 82/146 branches covered; its remaining connection/pagination/artifact/error UI branches are not exhaustive. StudyWorkbench is 83/97 lines but 124/209 branches, so history/loading/error combinations remain incompletely measured. JobsPanel is 13/19 lines and 29/63 branches; polling, cancellation and playback failure permutations remain partial. Portable API wrapper lines remain 4/14 despite separately verified real-browser export/restore workflows; this bounded follow-up did not expand into all UI or portability cases. Shared query-client configuration is measured as a whole modified file and includes upstream code unrelated to V1.

The low whole-frontend percentage also reflects large uninstrumented upstream source-editor, podcast, navigation/state and model-configuration areas; it should not be presented as V1-only coverage.

No arbitrary percentage target was used. The new tests address exact scope/identity, authentication, idempotency and accidental replay, rather than adding execution-only tests for data modules. All 16 tests passed against the existing implementation, so no production fix was required.

## Reproduction and files

Run from `frontend/`, using the already installed local Node entrypoint (no npm update check or registry access):

```sh
node ./node_modules/vitest/vitest.mjs run --coverage --coverage.include='src/**/*.{ts,tsx}' --coverage.exclude='src/**/*.test.{ts,tsx}' --coverage.exclude='src/test/**' --coverage.exclude='src/**/*.d.ts' --coverage.reporter=text --coverage.reporter=json --coverage.reporter=json-summary --coverage.reportsDirectory=../docs/v1/evidence/coverage/frontend --coverage.clean=false --reporter=default --reporter=json --outputFile.json=../docs/v1/evidence/coverage/frontend/tests.json
```

The exact command/version record is `command.txt`. `run.txt` contains the full test and text coverage output; `tests.json` is the machine-readable test result; `coverage-final.json` is the detailed Istanbul coverage map; `coverage-summary.json` is the full frontend summary. `transport-tests.txt`, `types.txt`, and `lint.txt` record the focused new-test checks. The full frontend ESLint pass also succeeded with the same 7 existing warnings; its output is in `../../frontend-lint.txt`. Top-level `../../frontend-tests.json` and `../../frontend-tests.txt` now contain this final 253-test instrumented run, rather than the earlier 237-test result.
