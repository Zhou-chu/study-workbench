# Multi-client canonical Git baseline

Verified 2026-10-21 UTC. This is a source-control audit, not a deployment claim.

- Private canonical repository: `Zhou-chu/study-workbench`.
- Baseline commit: `07654a46f70e5a02dc97e9bf4359a734e6bbdcdd`.
- Baseline tree: `cdf21de0cc2cebc14a45124f9c6a803a1dfa1cd3`.
- Original source mapping: `e3dba32314e2d9606136d4125d40e8c343502ef3` on the historical source branch. These SHAs are intentionally different.
- All 987 baseline files match the published inventory byte hashes and Git modes. Full 10-commit private history reconstructed from verified Git objects; not a shallow or synthetic replacement. Signed root was preserved exactly. `git fsck --full --strict` passed.
- LICENSE and README_UPSTREAM are retained. Historical PUBLISH_MANIFEST remains a provenance record of the filtered source snapshot, not a promise that later native branch commits originate from that source SHA.

## Isolation and ownership

The canonical integration checkout and the Docker/contracts worktrees each have separate working directories. The only configured remote in this canonical repository is the user's private repository. The original upstream-linked checkout is preserved and must never receive a blind push.

Initial local branches: `integration/multiclient-v1`, `feat/docker-deployment`, `feat/api-contracts-v1`. They all start at the exact canonical baseline. Platform-specific branches wait for their dependency gates. Local existence does not imply a remote branch has been published.

## Publication guard

The historical snapshot preparer rejects generated snapshot filenames and must not be run directly on this canonical checkout. Preserve its behavior for historical source publishing. Canonical branch publication requires an independently verified full-tree comparison, private destination/expected-parent check, and secret/runtime exclusion review. Never filter a working tree and silently claim its commit hash is the published commit. Connector-created commits may have distinct metadata and SHAs; record the exact mapping and reconcile their verified objects before subsequent integration. No force push or unrelated-history merge is permitted.

## Baseline verification

Canonical Python suite: 1359 passed, 1 opt-in skipped, 2 existing dependency deprecation warnings; 68.77 seconds. Executed with canonical cwd/PYTHONPATH and the existing locked virtual environment, with dotenv disabled. No real provider calls or credentials were used. Frontend verification is tracked separately in MULTICLIENT_ACCEPTANCE.md.
