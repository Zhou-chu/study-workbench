# ES-only compilation integration budget

Candidate base: `78114b9`. The test in `packages/web-transport/src/boundaries.test.ts` is a whole-program static compiler integration check. Its existing manifest classification remains `static-contract`; it is not pure runtime unit coverage or a product performance benchmark.

## Evidence and scope

The fixed 006831f mixed run completed this case in 5276.72ms and failed Vitest's default 5000ms deadline. The package and coverage configs do not specify a product compiler latency requirement. The later bounded V8-covered diagnostic recorded approximately 1.9ms source enumeration, 675ms `createProgram`, and 3427ms `getPreEmitDiagnostics`. Most measured cost was real compiler diagnostics, not redundant repeated construction: the original case creates exactly one program. These observations do not establish a worst-case bound or prove a machine-load cause.

No compiler work is removed, cached across runs, moved to hooks, split into partial programs, or replaced with mocks. The same complete contracts/domain source list, existing combined program, ES2022-only lib, empty platform types, strict compiler options and full pre-emit diagnostics assertion remain intact. The API/export architecture case is unchanged.

## Change

Give only the compiler case an explicit 10000ms Vitest test budget. This is approximately twice the observed failing duration, allowing compiler integration overhead without raising unit defaults or other test budgets. It does not assert the compiler now meets the old 5000ms boundary, optimize business behavior, or establish full-suite stability. If this budget becomes inadequate, collect new evidence instead of raising it automatically.

The compiler runs synchronously inside the test worker. Vitest's timeout is a runner failure budget, not an OS-enforced preemptive CPU kill: a blocked synchronous compiler cannot be interrupted by its JavaScript timer. No separate compiler subprocess is created or left alive. A hard wall-clock kill guarantee would require a separately owned worker/process and cleanup design; this small change does not claim one.

The historical failing run is the existing red evidence; avoid recreating expensive cold failures solely for TDD. Candidate validation must run this entire two-case file with the same real compiler, preserving the second case assertions. Validation: the complete file passed 2/2 with single-worker Vitest, without coverage; package `tsc --noEmit`, targeted ESLint and diff checks passed. Logs are retained in the quality evidence directory under `node/compiler-budget-781`. This was functional verification during another project's packaging window, not an isolated performance benchmark. No full-suite stability claim follows from it.
