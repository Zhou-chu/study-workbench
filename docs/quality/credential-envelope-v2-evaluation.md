# Credential envelope v2: unwired evaluation

Status: candidate implementation for explicit synthetic evaluation, NOT enabled. `open_notebook/utils/encryption.py`, its API callers, existing migration endpoint, deployment and data are unchanged. The live fixed-salt S2053 finding remains OPEN. This module adds one first-party source file and must remain in the full source/coverage denominator; it is not an exclusion or accepted-risk workaround.

## API and format

`open_notebook.utils.credential_envelope_v2` exposes only explicit `encrypt_candidate(value, passphrase=...)` and `decrypt_candidate(...)` entrypoints. Neither reads an environment key nor writes storage; no production module imports it. The candidate writer uses `secrets.token_bytes(16)`, PBKDF2-HMAC-SHA256 at 600000 iterations, 32 derived bytes, and Fernet authenticated encryption. The public salt is stored as canonical padded base64url in `pbkdf2v2:<salt>:<token>`. The PBKDF2 salt input is the exact domain prefix `b"open-notebook-credential-v2\0"` followed by the random 16 bytes. There are no caller-controlled cost parameters or global per-salt caches.

The candidate reader recognizes v2, preserves v1 fixed-salt and unmarked legacy derivations, and retains historical unmarked plaintext fallback. Recognized corrupt ciphertext, unsupported `pbkdf2v...` versions, wrong keys and tampering fail rather than becoming usable plaintext. v2 parsing checks canonical encoding, salt/token structure and a 24000-character envelope limit before KDF work. New plaintext is capped at 16384 UTF-8 bytes. These bounds are candidate policy, not proof every historical record fits; corpus preflight is required before rollout.

The writer leaves valid marked v1/v2 input unchanged, so it is not an implicit migration tool. Invalid marker-like plaintext is encrypted normally, matching the existing writer policy. The default application writer continues to emit v1. No read triggers a rewrite.

## Verification and limits

Initial 16 tests failed for the missing candidate API, then passed with the implementation. Final focused run: 23 candidate tests plus 27 existing encryption tests, 50 passed, two existing dependency deprecation warnings. Includes unchanged historical literal vectors, an independently constructed deterministic v2 vector, independent stdlib KDF verification, random salts, salt/token/version tampering, wrong keys, malformed/canonical/oversize rejection before KDF, UTF-8 size boundaries, idempotence and unchanged default v1 writes. Ruff check/format pass. Full repository tests and Sonar for this new uncommitted module remain pending unified integration; no final quality acceptance is claimed.

Stable raw evidence under local `notebook-quality-20261113/python/`: `envelope-v2-red.log`, `envelope-v2-final.log`, `envelope-v2-benchmark.json`, and the synthetic benchmark script. No database or real credential values were accessed.

## Measured cost, not a capacity guarantee

One desktop run, concurrency 1, ten operations each, actual 600000 iterations:

| Operation | Median ms | Total for ten ms |
| --- | ---: | ---: |
| v2 fresh write | 97.26 | 1102.79 |
| v2 distinct read | 87.53 | 886.07 |
| v1 uncached KDF | 84.14 | 865.69 |
| v1 cached Fernet read | 0.0055 | 0.0761 |

Per-record salt removes the current shared-key cache advantage; batch reads are materially more expensive. The synchronous candidate does not add uncontrolled parallelism. Before activation, call sites need bounded work/concurrency and cancellation/lifetime review (particularly event-loop paths); benchmarks under controlled deployment load are required. Do not lower the KDF cost or introduce an unbounded attacker-indexed cache to hide this cost.

To reproduce with synthetic values only, in the existing isolated Python environment: time ten explicit candidate writes, read those ten values, compare ten `encryption.derive_fernet_key("synthetic-benchmark-only")` calls and ten decrypts using one pre-derived Fernet object. Assert both iteration constants are 600000 and record median/max/total with `time.perf_counter`; keep concurrency 1 and clear credential environment variables. The stored benchmark script captures the exact run.

## Activation remains a separate decision

1. Independently review the candidate and run whole-repository compatibility/security checks, including all actual credential consumers.
2. Preflight the corpus read-only for versions, malformed data and proposed size bounds, without exposing secret values. Establish verified backup/restore and rollback procedures.
3. Deploy readers able to understand v2 before enabling any writer. Old applications cannot read v2; downgrade after new writes is not transparent.
4. Enable new writes only after performance/concurrency and operator approval. A separate migration, if approved, needs per-record compare-and-swap, dry-run, decrypt-then-verify, resumability and backup rollback. This evaluation implements no migration or automatic enablement.
5. Never edit the historical v1 salt, cost or key to resolve a finding. Key rotation remains distinct and unimplemented.

This is a candidate construction using existing primitives, not an independent cryptographic audit. Production S2053 remains unresolved until an approved rollout actually removes fixed-salt new writes and the retained historical decrypt path is reviewed in context.
