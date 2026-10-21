# Dependency provenance and notices

The original Open Notebook MIT `LICENSE` is retained unchanged. This branch does not remove upstream copyright or redistribute external services under the application's license.

| Component | Fixed version/source | License/use |
|---|---|---|
| Open Notebook | `lfnovo/open-notebook` commit `a0f6f3081ae06328f0a451b3a3ef2959ca25721d` | MIT, repository LICENSE |
| notebooklm-py | PyPI 0.8.5, exact locked artifacts in uv.lock | MIT; unofficial integration, not a Google product or service guarantee |
| pypdf | PyPI 6.10.2, exact locked artifacts in uv.lock | BSD-3-Clause |
| SurrealDB | Official GitHub surrealdb/surrealdb v2.3.10 linux-amd64 | Business Source License 1.1; separate runtime, not bundled in source |
| PDF.js | Official npm pdfjs-dist6.4.299, exact lockfile integrity | Apache-2.0; local worker/CMaps/fonts/WASM, license copied with build assets |
| Next.js/React and existing frontend dependencies | npmjs.org, versions/integrity in frontend/package-lock.json | Retained upstream dependency licenses |
| Playwright/Firefox test runtime | Official Playwright installer, Firefox build 1538 (153.0) | Test tooling only, not bundled; retain vendor notices if redistributed |
| ReportLab | Existing cloud installation, fixture generation only | BSD-style license; generated public sample PDFs committed, library not bundled |

Registries: Python dependencies came from the official PyPI service. Upstream npm lockfile had 106 npmmirror artifact URLs; only their registry hostname was normalized to registry.npmjs.org, preserving package versions and integrity hashes. No unknown mirror code was executed as a fallback.

Useful upstream license locations:
- https://github.com/lfnovo/open-notebook/blob/main/LICENSE
- https://github.com/teng-lin/notebooklm-py/blob/main/LICENSE
- https://github.com/py-pdf/pypdf/blob/main/LICENSE
- https://github.com/surrealdb/surrealdb/blob/v2.3.10/LICENSE
- https://github.com/microsoft/playwright/blob/main/LICENSE
- https://github.com/mozilla/pdf.js/blob/master/LICENSE

This inventory highlights added/pinned dependencies and is not a legal opinion or exhaustive transitive license audit. Lockfiles are authoritative for the complete dependency inventory. No vendor account agreement was accepted or paid service purchased during implementation.
