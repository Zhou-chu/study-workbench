# Clean-checkout PDF asset fixture repair

Base: `820b5f4`. Public mixed CI at `8cb99cd` failed all five PDF asset tests because `mkdtemp` was given a prefix under the absent `.superpowers/sdd/notebook-spa-redesign` history directory. This was reproduced in a new clean worktree; the historical parent was absent before and after verification. No CI step creates that directory to mask the dependency.

The fixture now uses `mkdtemp(path.join(tmpdir(), 'notebook-pdf-assets-test-'))`. Every root is newly and exclusively allocated by the OS (private mkdtemp mode), never a caller-supplied or reused path. Immediately after successful allocation, a per-test `t.after` hook registers recursive removal of only that owned root. Registration precedes fixture population, so ordinary setup/assertion failures also invoke cleanup; abrupt process/OS termination cannot guarantee cleanup. Symlinks are removed, not followed into their targets. No existing user/output directory is removed or permission-modified.

The five original test names and full bodies are text-identical after normalizing only the new test-context parameter and fixture argument. All license, exact-byte, drift, source/destination symlink, private-file, 16 MiB size and unowned-file preservation assertions remain. Production prepare-pdf-assets and coverage scopes are untouched. These remain tool-integration tests with actual synthetic filesystem I/O, not strict unit coverage.

## Actual verification (Node 24.19.0)

- Clean-tree RED: `cd apps/web && node --test scripts/pdf-assets.test.mjs`, exit 1, all five ENOENT failures.
- GREEN: same command, 5 passed, no failures/skips. Compared temporary prefix inventory before/after: no new roots remained. Historical parent still absent.
- Related full node-tools test entry: `node scripts/coverage-node-tests.mjs`, exit 0, BFF 23/23 plus Web 24/24, total 47; no skips. This is the normal test runner without a whole-project coverage rerun.
- Test-body conservation comparison: 5 originals equal 5 maintained bodies except context plumbing. No safety assertion was removed.

Evidence: `notebook-quality-20261113/ci/pdf-fixture/{red.log,green.log,node-tools.log,node-tools.exit,contract.json}`. No live browser, service, deployment, publication or new hosted CI result is claimed. Full mixed/strict gates remain separately pending.

Test SHA256: `5183e1eb6d350a1a5ecdd4110d7996ac438e625b9e633f9a629bdc7876d57d23`.
