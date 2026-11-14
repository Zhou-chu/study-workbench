# Frontend acceptance artifact identity

This gate establishes **source/artifact association and freshness**, not a
reproducible build, hermetic dependency closure, signature, hostile same-UID
sandbox, deployment approval, or completed browser acceptance.

## Isolated candidate workflow

Use a disposable checkout with installed dependencies, the repository's public
`contracts/v1/openapi.json`, and no dotenv/private/runtime inputs. Never run this
build in a serving preview's checkout: Next still writes candidate `.next` and
PDF preparation replaces candidate `public/pdfjs`.

```sh
cd frontend
npm run build
# JSON includes the newly created /tmp/sw-frontend-artifact-* directory.
node scripts/build-artifact.mjs --verify /tmp/sw-frontend-artifact-REPLACE
```

The output is a new private directory containing standalone server/dependencies,
`.next/static`, `public`, and `artifact-manifest.json`. Existing artifacts are never
updated in place. Preserve that directory for the acceptance run; temporary
storage is not a durable release registry. Ordinary `npm start` remains a legacy
standalone entrypoint, **not** the verified acceptance path.

For separately authorized HTTP-only acceptance against fresh owned loopback
services and public fixtures (no browser):

```sh
python scripts/v1/local_check.py --frontend-http --artifact /tmp/sw-frontend-artifact-REPLACE
```

This mode requires a verified artifact before allocating ports/storage. It checks
`/config`, exact packaged JavaScript static bytes, and anonymous/authenticated API
proxy access using a random ephemeral fixture password. The frontend receives
routing settings and private HOME, not database credentials or encryption keys.
It then stops and restarts only its owned database/API/worker/frontend against the
same temporary data/config and checks original bytes, notes and full saved
selection through the frontend proxy. Artifact identity is checked before each
frontend start, after HTTP phases and after cleanup; runtime artifact writes fail
the gate rather than being excluded or hidden. Restart logs are retained, and all
three fixture listener ports must be released. This is **not cold restore, durable
hosting, browser acceptance or Docker acceptance**. No operator configuration or
real account/provider is needed. Browser mode remains independent and opt-in.

Only when separately authorized to start a disposable database/API/worker and
browser, use the repository's prepared Python environment:

```sh
python scripts/v1/local_check.py --browser --artifact /tmp/sw-frontend-artifact-REPLACE
```

`local_check` verifies before ports/storage/services, again before frontend
startup, and after acceptance/cleanup. It binds the browser child to a private
one-run context/token, live parent identity, exact owned database/API/frontend
listeners, fixture notebook, and manifest. `browser_check.py` is import-safe and
accepts only that parent context; arbitrary output/URL/notebook CLI targeting is
removed. Browser network routes are restricted to its exact fixture frontend
origin, with owned-instance checks before requests. Missing/stale identity fails
before browser import/actions. API-only checks can omit the frontend artifact.
Native launcher remote backends remain a separate, non-isolated mode.

## Inventory and failure boundaries

- Authored inputs: bounded frontend `src`, `public` (except generated `pdfjs`),
  `scripts`, `app`, `pages`, `components`, `styles`, `lib`, `e2e`, and `design-skills`;
  root code/config/lock/assets; exact external public OpenAPI contract. The latter
  is imported by a TypeScript test included in production typechecking.
- Generated PDF.js files have a separate inventory. Preparation validates public
  dependency inputs and replaces only the nominated candidate generated subtree.
  Generated `next-env.d.ts`/TypeScript build metadata are not authored identity.
- `.git`, `.next`, and installed `node_modules` are not recursively inventoried as
  authored source. Served standalone dependencies **are** digested. Installed
  dependency equivalence, registry trust, compiler/network/font determinism, and
  arbitrary dynamic build inputs are not proven by the source hash.
- Unknown source/output directories fail closed. Existing `test-results` may
  contain only the regular `.last-run.json` runner metadata file: names/types are
  checked shallowly, contents are not read. Other runtime output rejects the build.
- Loadable dotenv/private names, source symlinks, special files, and escaping
  artifact symlinks are rejected without reading their content. Artifact links
  are allowed only when relative and resolving inside packaged `node_modules`.
  JSON metadata uses bounded no-follow, nonblocking regular-file reads.
- Source identity is compared before preparation, before compilation, after
  compilation and packaging; generated/served files are independently checked.
  Verification repeats source/generated/served/receipt/manifest observations.
  These are drift checks, not an atomic filesystem snapshot against hostile writers.
- An exclusive `.acceptance-build.lock` serializes candidate builds. Verification
  refuses active/stale locks. Interrupted builds leave a fail-closed lock; an
  operator must establish no candidate build is still alive before removing it.
  Never remove a live build's lock automatically.
- `.next/acceptance-build.json` invalidates earlier success before compilation;
  failures leave no usable new manifest. Only the latest successful build receipt
  accepts its matching manifest, even when source content has returned to an old
  value. Changing source/scripts requires rebuilding, not copying a manifest.

The build subprocess receives an allowlisted environment and temporary HOME.
Production compilation explicitly uses Next's supported `next build --webpack`
option. The installed Turbopack compiler rejects Google font virtual imports when
real font URLs contain multiple query parameters; Webpack builds those same fonts
without changing typography or mocking responses. This compiler selection does
not bypass preparation, typechecking, packaging, or any artifact identity check.
Existing platform proxy/CA transport can support public Google Fonts; its values
are neither logged nor hashed. TLS verification is not disabled. Child build
output is intentionally suppressed to prevent accidental transport credential
exposure; a failed production build needs separately authorized, sanitized
investigation, never a weaker gate. Runtime local probes ignore ambient proxies.

## Offline gate tests

```sh
node --test frontend/scripts/artifact-identity.test.mjs
PYTHON_DOTENV_DISABLED=1 python -m pytest -q \
  tests/test_v1_artifact_identity.py tests/test_v1_browser_context.py \
  tests/test_v1_frontend_http.py
```

The frontend default `npm test` runs the Node artifact suite and then Vitest.
`npm test -- <filter>` forwards the filter to Vitest after the Node checks;
`npm run test:unit -- <filter>` and `npm run test:artifact` run each separately.
Only this exact Node suite is excluded from Vitest discovery; other source/e2e
policy tests retain the normal discovery rules. `npm run test:coverage` runs the
Node checks separately before Vitest V8 coverage; its coverage report does not
claim to measure the Node artifact suite. Watch/UI commands remain Vitest-only.

These use synthetic trees/fake builds and mocked runtime identities, not an app
stack or browser. The FIFO test creates only a disposable filesystem FIFO and a
bounded verifier subprocess. Lifecycle's two real dummy listener/descendant tests
remain opt-in via `STUDY_WORKBENCH_DISPOSABLE_LIFECYCLE=1`.

A successful production compile/manifest check does **not** validate browser
interaction, database behavior, Docker, or deployment. Those acceptance gates
remain separate and require explicit disposable-environment authorization.

In particular, real browser timeout/crash descendant cleanup (including detached
browser subprocesses) and service-worker request interception have not been
runtime-validated by these mocked checks. Do not treat the routed-request guard
as evidence that every possible browser network mechanism has been exercised.
