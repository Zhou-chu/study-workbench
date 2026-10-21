# Offline private-repository snapshot preparation

`prepare_private_snapshot.py` prepares files only. It does not authenticate, access
GitHub, change remotes, push, commit, or claim tests have passed. In particular,
**the source repository's `origin` is upstream, not the private publication target**.
Never push a snapshot there. Review and publication are separate authorized steps.

## Prepare a tested, committed iteration

```sh
python scripts/v1/prepare_private_snapshot.py \
  --repo /absolute/path/to/study-workbench \
  --commit <tested-source-commit-sha> \
  --output /absolute/existing-parent/new-snapshot \
  --inventory /absolute/existing-parent/new-inventory.json \
  --previous-inventory /absolute/path/to/previous-inventory.json
```

Omit `--previous-inventory` for an initial publication. Both output paths must be
**new**, even an existing empty directory is rejected; parents must exist without
symlinks. Keep the inventory outside the snapshot (avoids self-referential hashes).
Do not reuse an incomplete output after an I/O failure: inspect it and choose a
new destination. Run in a trusted local workspace, not a directory concurrently
modified by another process. No new dependencies are required beyond Python/Git.

Only the specified commit is read, not dirty/untracked files. Archive paths are
validated without `extractall`; links, submodules, path traversal and unexpected
archive-vs-tree changes (including export-ignore/export-subst) fail closed before
output creation. Every retained source file keeps exact bytes and executable mode.
README becomes a Chinese progress-first page linking stable PROGRESS/ACCEPTANCE
files; original README is retained verbatim as README_UPSTREAM. Existing generated
snapshot filenames in a source commit are rejected rather than overwritten.

Automation, known runtime/secret paths, browser evidence screenshots and raw
coverage are omitted. Source code, licenses, lockfiles, required images, test
fixtures and synthetic example ZIPs remain. This is **not** a content secret
scanner: review retained files and the manifest before publication. The helper
cannot determine that a source commit is tested; the caller must verify it.

## Incremental publication contract

The deterministic root `PUBLISH_MANIFEST.json` records source commit and exclusions.
The external inventory contains **all** output files (including generated files),
SHA-256, Git blob SHA-1, bytes and Git mode, plus `expected_tree_sha` for the entire
snapshot. It reads the original inventory format (`files` with path, sha256, mode),
even if that inventory has no Git blob hashes. No timestamp is embedded.

- `changes.added` and `changes.modified`: upload those files' exact bytes as Git
  blobs; use the inventory's mode and verify returned blob SHA.
- `changes.deleted`: when constructing a GitHub Git tree against the **verified
  previous private-repository tree**, include each deletion as
  `{"path": "removed/path", "mode": "100644", "type": "blob", "sha": null}`
  (use its previous inventory mode). A missing upload is not a deletion.
- Before advancing the private branch, compare the resulting **complete** tree SHA
  with `expected_tree_sha`; abort on any mismatch or unexpected remote change.
- Verify the new commit's tree and source commit manifest after publishing. Only
  then retain this inventory as the baseline for the next iteration.

The previous inventory is a diff aid, not proof of current remote state. If remote
files drifted, reconcile explicitly instead of overwriting them. This helper does
not perform any of these remote operations.

Focused verification: `python -m pytest tests/test_prepare_private_snapshot.py`.
