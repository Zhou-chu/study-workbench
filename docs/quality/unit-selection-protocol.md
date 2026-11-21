# Unit selection binding, stage one

This change does not enable CI, execute tests, narrow production coverage, change
the eleven partition runners, or relabel existing mixed-layer reports as unit.
The repository still fails closed while any discovered test is mixed,
unclassified, missing, stale, or invalid.

## Trust and consumption

The executing adapter is scripts/coverage-unit-selection.mjs:
createUnitSelection(root) and validateCurrentUnitSelection(root, artifact).
It obtains HEAD, the complete tracked inventory, and clean worktree status itself
through the existing fixed-account trustedGit registration. No executable,
registration path, inventory file, Git environment, or Git command override is
accepted. No new allowed Git commands or registration changes are introduced.

The requested root must equal the canonical checkout owning the imported selector.
A selector from checkout A cannot create or validate selections for checkout B,
even when B has a valid classification/artifact or a different/missing policy.
The selector, trusted-Git adapter, and Python policy must all be tracked in the
same checkout. Their observed load-time hashes must still match both captures;
changing one after import requires a fresh process/module, not silent reuse of
cached code with a new source identity. These actual file identities are also
included in the complete artifact fileHashes. The ordinary trusted-code/same-UID
assumption remains; this is not attestation of arbitrary JavaScript module caches.

The classification file must be tracked at scripts/quality/test-layers.json.
All tracked files, not only reviewed targets, are hashed. Nonregular files and
symlinks (including symlinked parents) fail closed. Dirty tracked or visible
untracked files reject selection. Git-ignored dependency/build files are not
part of the tracked inventory. Every discovered test must have a valid reviewed
classification; only exact unit file paths are returned. Empty selections fail;
there is no directory fallback.

The adapter uses fixed /usr/bin/python3 -I for the stdlib-only existing policy.
Native Windows is unsupported by the existing trusted Git custody checks.
The internal --binding-stdin Python bridge and pure functions do NOT establish
trust: their inputs are caller data. They must not be used as a substitute for
the adapter's independent Git capture.

The artifact binds full revision, ordered inventory and digest, every file hash,
all test hashes, classification digest, non-test-input digest, and explicit unit
files. sourceSha256 includes all non-test tracked inputs (including docs,
configuration and fixtures); it is conservative input identity, not the
production coverage denominator. SHA-256 digests are integrity bindings, not
digital signatures or authentication credentials.

Before execution a runner must call validateCurrentUnitSelection to recompute
against current independent inputs. The adapter captures again after policy
evaluation and rejects changes. This does not lock the worktree against a
same-account concurrent writer, attest that Git index flags are honest, or
create an immutable execution sandbox. Future runner integration must bind its
actual executed test list and before/after inputs to its report, and preserve
all production roots. This stage does not implement those runners.

## Verification and classification

- Pure protocol tests: in-memory data only; unit.
- Existing manifest validator tests: unit.
- CLI and new adapter tests: real subprocesses, Git repositories and filesystem;
  tool-integration, not unit.
- New files deliberately require classification-manifest review; this change
  does not self-approve them or hide the missing-classification failure.
- Focused checks do not establish full-project coverage or Quality Gate success.

The initial 33 protocol tests failed because the new binding functions were
absent; the initial five adapter tests failed because the adapter did not exist.
No previously passing suite is presented as a bug-red test. Additional digest,
boolean-schema and committed-source characterization cases strengthen the
protocol regression checks. External red/green evidence is retained separately.


## Ownership follow-up

Cross-checkout regression tests first reproduced A creating selections for B
with missing/different policies and validating B artifacts with A code. A tracked
file named __proto__ also exposed ordinary-object hash-map key loss. Explicit
checkout ownership plus tracked producer identity checks close the first
boundary; a null-prototype dictionary preserves every tracked filename in the
second. These tests create real fixture repositories carrying the actual
selector, Git adapter and policy, and remain tool-integration, not unit.
