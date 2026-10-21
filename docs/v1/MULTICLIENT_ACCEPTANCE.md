# Multi-client acceptance ledger

Updated 2026-10-21 UTC. Planned work is not accepted functionality.

| Surface | Evidence | Status / remaining gate |
|---|---|---|
| Canonical Git baseline | 07654a46, full history/tree/file hashes and fsck | Verified; two reviewed feature branches published with exact-tree mappings below |
| Backend baseline | 1359 passed, 1 skipped, 2 existing warnings | Passed on canonical baseline |
| Integrated foundations | 1473 passed, 1 skipped, 2 existing warnings; 72.29 seconds | Passed with deterministic external-metadata/DNS fixtures, verified tokenizer cache and credential-free guarded Python runner |
| Frontend baseline | 390 tests / 53 files, types, lint (7 existing warnings), production build | Passed; initial external node_modules symlink rejected by Turbopack, resolved by isolated local dependency copy without code changes |
| Docker deployment | d773de0; 61 final focused tests; independent fix re-review approved | Static PASS. No Docker runtime; build/Compose/restore NOT RUN |
| API contract foundation | 47d0134; 84 regression tests passed / 1 skipped before final test-only addition; final 15 contract tests passed; independent review approved | Integrated locally; current generic response-schema gaps remain explicit |
| Device sessions | Reviewed security design | Not implemented or activated |
| Native private ingress | No verified supported dot tunnel registration/native HTTP path | BLOCKED/UNKNOWN, not declared unsupported |
| Android | No client build | Not started; SDK/device evidence pending |
| iPadOS | No client build | Not started; macOS/Xcode/device evidence pending |
| HarmonyOS 6 | No client build | Not started; SDK/device evidence pending |
| Live AI / Google | Existing offline tests only | Real capability gates remain open |

## Explicit design tradeoffs

- Initial refresh protocol uses strictly one-use random refresh credentials. If a successful refresh response is lost, the user signs in again; protected drafts must survive. This avoids a bespoke recovery cryptographic protocol and never retries an ambiguous resource write.
- Initial sessions invalidate on API restart/full restore. This intentionally favors non-resurrection of revoked sessions over seamless restart login.
- Cookie/Bearer Web migration activates atomically across regular proxy, SSE/events, uploads and downloads; partial activation is forbidden.

## Review closure and publication

- T1 public-Origin and runtime metadata findings: fixed and independently re-reviewed. Foreign-Origin rejection remains tested.
- Publisher lazy-fetch and shallow-parent findings: fixed and re-reviewed; final import guards pass type checks.
- Whole-foundations review: specification PASS and quality/security APPROVED, with the acceptance ledger reconciled here.
- API branch `feat/api-contracts-v1`: remote `0ea2733fbfbb2eabc10cb3cac2b9b21e87a25e9a`, reviewed local `47d01348dd1ae8107f20b11f766d11c97469b817`, tree `ea27e2960b152af6b886bc68224f4ec84b85a320`, 996 files verified.
- Docker branch `feat/docker-deployment`: remote `47fcdf97d908100595dda9e55b78a65c765f4585`, reviewed local `d773de04acb6df53044641ba7294395195e5c138`, tree `250a893f005ec3d7a0c07cfd6787083899a64325`, 995 files verified.
- Both remote branches retain parent `07654a46f70e5a02dc97e9bf4359a734e6bbdcdd`; connector commit metadata differs from local commits. Exact trees and refs were verified. Stable main was not advanced by these branch publications.

## Verification limits and corrected test setup

A fresh-worktree suite was stopped by safety review for an unexpected Azure Blob access; another guarded attempt was blocked on a GitHub update check. Neither attempt is a pass. Static diagnosis identified missing tokenizer cache and unmocked unit-test metadata/DNS dependencies. The public tokenizer cache matches the installed package's SHA-256; tests now use scoped synthetic fixtures without weakening SSRF negative tests.

A local verification-wrapper bug reran pytest inside spawned extraction workers and caused an extraction timeout. Adding the normal main-entry guard resolved it; six extraction-command regressions passed before the final full run. No application extraction timeout was relaxed.

The final Python runner clears ambient credentials/dotenv, reuses the verified cache and rejects external Python DNS/connect. This is a regression tripwire, not a claim of an OS-level network sandbox. Reviewed subprocess paths and exporter isolation remain separate checks. Final full result: **1473 passed, 1 opt-in skipped, 2 existing deprecation warnings**.

No actual Docker build/Compose, native client build/device test, live model/Google acceptance or private Sites publication occurred in this foundation checkpoint. User explicitly requires owner-private ChatGPT Sites publication after completion and acceptance; the supported dot connection and native access gates remain unresolved.
