# Offline canonical publication export

This helper prepares **committed content**, not a deployment, GitHub upload, secret
scan, test run, or proof of remote state. It makes no network calls. Unlike
`prepare_private_snapshot.py`, it never rewrites the README, regenerates the old
manifest, sanitizes content, or silently drops tracked files.

## Run

From the canonical checkout, using an existing Python environment:

```sh
python scripts/v1/prepare_canonical_publication.py \
  --repo /path/to/canonical-repo \
  --commit FULL_40_CHARACTER_SOURCE_COMMIT_SHA \
  --baseline FULL_40_CHARACTER_BASELINE_COMMIT_SHA \
  --output /existing/private-parent/new-export \
  --inventory /existing/private-parent/new-receipt.json
```

Both arguments must be full lowercase SHA-1 **commit object IDs**, not tags,
branch names, or abbreviated hashes. SHA-256 Git repositories are unsupported.
The comparison baseline is explicit; selecting it does not establish remote
ancestry or authorization. Working-tree edits and untracked files are ignored.
Local replacement refs and lazy object fetching are disabled on every Git call.
All transports (including file/custom helpers) are denied even if inherited
configuration allows them; credential helpers and interactive prompts are
disabled defensively. Missing objects fail locally rather than repairing a partial
clone. Git must support `--no-lazy-fetch`; older versions fail closed rather than
falling back. Export data comes from `git ls-tree` and
`git cat-file blob`, never from source working-tree files or `git archive`;
export-ignore/export-subst attributes cannot silently transform it.

Output directories and receipt files must be new, have existing parents, and
have no symlink ancestors. The receipt must be outside the export. All policy,
blob and tree validation completes before export creation. Existing outputs are
never overwritten. Filesystem failures can leave a partial new export: inspect
and remove it manually, then choose a new output path; do not treat it as success.
Use a private directory not concurrently writable by untrusted processes.

## Safety and historical content

Only regular `100644`/`100755` blobs and safe UTF-8 relative paths are supported.
Links, submodules, traversal, `.git` components, control characters, ambiguous
paths, duplicates and file/directory collisions fail closed. Both source and
baseline path inventories pass the existing private-snapshot exclusion predicate
**before any blob content reads**. Forbidden credentials, real environment files,
workflows, runtime data, caches and dependencies cause rejection, not filtering.
This is a path gate, not a detector for secrets embedded in otherwise valid code.
Do not pass dedicated secret files to a scanner or print suspect content.

Every `test-results` path component is additionally forbidden, with exactly one
historical exception:

- `frontend/test-results/.last-run.json`
- regular nonexecutable mode `100644`
- blob `5fca3f84bc7b9240b2963858fe2f32f7c515a8d4`
- must already be present with the identical mode/blob in the explicit baseline.

This is the recorded blob from canonical baseline
`07654a46f70e5a02dc97e9bf4359a734e6bbdcdd`. It is **not current test evidence**.
Changes, a newly introduced file, alternate paths, or choosing a different
baseline to launder different runtime bytes are rejected. Deleting the historical
file in an intentional source commit is permitted. Other historical summaries
accepted by the existing predicate remain part of the exact tree.

`README.md`, `README_UPSTREAM.md`, and `PUBLISH_MANIFEST.json` are ordinary tracked
files preserved byte-for-byte from the source commit. In particular, the manifest
continues to describe its historical snapshot; it does not become the current
publication inventory. Reviewed source commits may intentionally change ordinary
files; this exporter applies no presentation transformation.

## Receipt contract

The deterministic external JSON receipt includes:

- `source_commit`, `source_parents`, `baseline_commit`, `baseline_tree_sha`;
  source parents are parsed from hash-verified raw commit headers, preserving all
  merge parents even at a shallow boundary and ignoring signature continuation
  lines and commit-message text;
- `expected_tree_sha`, `files` (every path, mode, blob SHA, SHA-256 and byte count),
  `total_files`, `total_bytes`, and `inventory_sha256` (SHA-256 of UTF-8 JSON for
  `files`, using the helper's two-space indent plus final newline serialization);
- `baseline_files`: complete path/mode/blob inventory for remote comparison;
- `changes`: sorted added/modified/deleted paths, including mode-only changes;
- `changed_text_blobs`: source blobs absent from the baseline blob set, with exact
  UTF-8 `content`, `encoding`, path, mode, and expected blob SHA;
- `unchanged_blobs`: source entries whose blob SHA already exists anywhere in the
  baseline tree. This is **blob reuse**, not a claim that the path/mode is unchanged;
- `policy_exceptions`: explicit historical runtime exception, if retained.

All source bytes are checked against their Git blob hashes. The complete source
and baseline inventories independently reconstruct their Git tree hashes and
must match the committed root trees. Output bytes and executable modes are exact.
The receipt has no timestamps or self-referential entry inside the exported tree.

Unchanged binary blobs are exported and referenced by SHA. A new/changed blob
that is not valid UTF-8 or contains NUL is unsupported and fails before output
creation. No lossy decoding, newline normalization or invented text payload is
allowed. Identical new blobs can appear at multiple paths in the payload; a
publisher may deduplicate by expected SHA. This narrow text interface is not a
promise that arbitrary binary changes can be published.

## Publication remains a separately authorized step

Before using this receipt, a publisher must independently review the exact source
commit, changes, embedded-secret risk, evidence provenance, and current tests.
Verify the authorized repository is private, pin the remote parent, compare its
complete non-truncated tree against `baseline_files`, and establish explicit local
parent-to-remote-parent lineage. Equality of unrelated trees is not ancestry.
Do not infer a destination or permission from Git remotes.

Upload changed blobs without altering bytes and verify returned blob hashes.
Build a **full** remote tree using every source inventory entry (not a patch-only
payload); omissions implement intentional deletions. Verify its root hash equals
`expected_tree_sha` and its full inventory matches. Only then create a commit
with the authorized remote parent, verify it, and create an authorized new branch
or update an authorized existing branch using an expected-head lease, never force.
Recheck privacy, ref, commit parents and full tree after publication. No automatic
main advancement, merge, Actions enablement, release or deployment is implied.

Connector-created commits may have different identity/authorship/timestamps from
the local commit. Record local-to-remote commit mapping plus identical tree and
verified parent mapping externally; never claim the original local commit was
pushed when only a connector-created mirror commit exists. A successful offline
export alone does not establish any of these remote facts.
