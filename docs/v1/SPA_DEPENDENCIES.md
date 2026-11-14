# SPA foundation dependencies

A1 introduces npm workspaces for `apps/*` and `packages/*`. The legacy `frontend/`
remains independent; its manifest, lock and prepared deployment dependencies are
unchanged. This is contract infrastructure, not a UI or production cutover.

## Exact versions and provenance

The root lock reuses the existing frontend lock's exact registry URLs and integrity
metadata. Direct foundation tools are TypeScript 5.8.3, Vitest 4.1.9, Vite 7.3.5,
ESLint 9.31.0, @typescript-eslint/parser and eslint-plugin 8.37.0, and @types/node
20.19.9. `@study/contracts` uses Zod 4.6.5 for runtime decoding. There is no temporary
`npx` resolution. Existing security overrides are retained in the new root manifest.

Node 24 is required by the workspace; validation uses prepared Node 24.19.0. It
satisfies Vite's >=22.12 and Vitest's >=24 ranges. The TypeScript ESLint tools support
TypeScript >=4.8.4 <5.9.0, including the locked 5.8.3. No global tool was upgraded.

The complete root lock contains registry integrity for every non-workspace entry,
including optional platform binaries. A clean `npm ci --ignore-scripts --no-audit
--no-fund` of the exact A1 closure was validated against the official npm registry
with an isolated local cache. It installed 167 Linux packages without lifecycle
scripts or lock drift. The actual worktree then passed the same clean install
with `--offline` using that local cache. The first offline probe had failed because
the old cache lacked the Zod 4.6.5 tarball; copied prepared modules alone were not
presented as clean-install proof. Registry retrieval added no new dependency version.

## Deferred UI packages

The prepared legacy lock already contains React and React DOM 19.3.0. A1 has no
React runtime, router, UI or bundler feature needing them, so they are not added as
unused root dependencies. React Router is absent from the prepared environment.
Its latest stable 7.x version and Node/React peers must be checked against the
official registry when the actual UI workspace is introduced, then locked there.
No unverified patch version is recorded as fact or installed by A1. This deferral
avoids an unrelated UI dependency installation while leaving A1 reproducible.

## Commands

From the repository root, `npm ci --ignore-scripts`, followed by `npm run test`,
`npm run typecheck`, `npm run lint`, and `npm run build`. Each command dispatches to
registered workspaces. The contracts package also supports all four commands via
`npm -w @study/contracts run <command>`. Typecheck includes consumer compile tests;
build emits only package sources to `dist/`. ESLint config and build tsconfig are
checked in. No source-path import into the legacy frontend is used.
