# Session proxy early guards: unit split

Base: `2f81790cede3c1aa0b13a6ad9eb02a810a5da2d7`.

Only the complete `Web BFF request boundary` describe and three complete bounded
parsing tests were moved to `session-proxy.guards.unit.test.ts`. The three are:
malformed/oversized login, non-JSON/length bombs, and chunked JSON/invalid UTF8.
They are 8 static test-call nodes, expanding to 39 cases. The original file
retains 65 nodes / 120 cases and remains mixed. No production code, timeout,
assertion, parameter table, exclusion, classification or denominator changed.

## Actual boundary

`dispatch()` applies cookie and `webBoundary()` validation before entering
session operations. For login parsing, `webAuth()` awaits `authBody()` and
computes `loginInput(body)` before invoking `store.login()`. These selected
malformed bodies fail in those local parsing steps. All selected cases assert
no upstream fetch; the store boundary was additionally read, not inferred just
from mocked HTTP. `createSessionProxy` still constructs its default real
`BffSessionStore`, whose constructor only stores injected native/clock/random
references and initializes in-memory containers. The selected requests never
exercise its login, lookup, confirmation, refresh, lease or revocation protocol.
The independent real-store coordination remains in the old mixed file.

Request/Response/ReadableStream and fake timers are local runtime facilities, not
an HTTP server. Shared helper `frontend/src/test/session-proxy-fixtures.ts` keeps
original synthetic constants, request construction and fake fetch fixture. It
imports neither collected test nor real data. Both suites retain identical
original global beforeEach/afterEach hooks. Helpers are exported without body
changes; the native success fixtures remain available only for original mixed
cases that use them. No real credentials or login occurred.

## Evidence

- TypeScript AST comparison: all original 73 test-call nodes preserved across
  files, hooks unchanged. The entire boundary describe AST is also equal,
  including nested loop input arrays and dynamic titles.
- Native Vitest collection: 159 -> 159 exact expanded names, no missing or duplicate.
- New unit independently: 39 passed, no failures/skips.
- Both files together: 159 passed, no failures/skips.
- ESLint on both tests and helper: zero warnings after removing unused imports.
- Frontend TypeScript `--noEmit --incremental false`: passed with prepared root
  and frontend dependency trees.
- Unmodified `inventory()` and `sourceDigest()` against exact base Git archive:
  all 288 legacy-web production files unchanged, digest
  `317c7cca6faf2327cb0e48f118d8a99f70c0bdb5cea1b2f5077ef2d288d71f38`.

Commands run inside `frontend/` with existing Node 24.19.0:

```text
node node_modules/vitest/vitest.mjs list src/lib/api/session-proxy.test.ts src/lib/api/session-proxy.guards.unit.test.ts --json --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/lib/api/session-proxy.guards.unit.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/lib/api/session-proxy.test.ts src/lib/api/session-proxy.guards.unit.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js src/lib/api/session-proxy.test.ts src/lib/api/session-proxy.guards.unit.test.ts src/test/session-proxy-fixtures.ts --max-warnings=0
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The adjacent map records complete case relocation, hashes and inventory summary.
No deployment, real service, full suite, coverage percentage or CI success is
claimed. The parent independently updates classification after review.
