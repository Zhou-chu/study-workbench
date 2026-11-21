# Coverage manifest temporary-file custody

Baseline 5a184d4. The previous saveManifest used a predictable PID temporary
path with writeFileSync's default overwrite mode. A pre-existing symlink at
that path caused the target to be truncated before rename. The RED fixture
uses only a private mkdtemp root and a synthetic sentinel outside its output
subdirectory; no real user data was read or modified.

Observed RED: 3 failures / 3 passes. The sentinel changed from KEEP to the
manifest JSON. A regular pre-existing temporary file was also overwritten;
a failed rename left the newly created temporary behind.

The fix serializes first, opens the temporary with exclusive `wx` and mode
0600, writes via the owned descriptor, closes it and atomically renames in the
same directory. Existing temporary files/symlinks cause EEXIST without writing,
renaming or cleaning them. Failure cleanup checks regular-file type and the
created inode/device before unlinking. Final-path symlinks are replaced by
rename rather than followed. JSON schema and generatedAt/partitions remain
unchanged, and repeated successful saves retain the existing behavior.

This is not protection against a malicious same-UID process racing pathname
checks or replacing ancestor directories. Callers remain responsible for output
root containment and directory custody. A stale/colliding PID temporary blocks
this save safely; it is not silently deleted. No fsync/durability guarantee is
added. The total gate must still reject the real child failure instead of trusting
an earlier report. Permissions of newly published manifests are now owner-only.

Verification:
- Six custody filesystem integration tests pass; Node 24.19.0 exit 0.
- Existing coverage-inventory `pending atomically` test passes (one selected).
- git diff --check passes. These tests use real temporary files/symlinks and
  therefore are tool-integration, not strict unit tests.
- Initial green had six passing tests but its shell status-forwarding wrapper
  was incorrectly escaped. A direct second invocation exited 0; both logs are
  retained, and the final log is authoritative.

Evidence prefix `<external-evidence>/manifest-custody-`:
`red.log`, `green.log`, `green-final.log`, `pending.log`.

Reproduce:
```
node --test scripts/coverage-manifest-custody.test.mjs
node --test --test-name-pattern='pending atomically' scripts/coverage-inventory.test.mjs
```

No total gate, full-project coverage, runtime deployment or real data migration
was performed; classification manifest is left for coordinator review.

Integrated at `501e864`: custody, explicit unit runner and Python unit runner regression completed 24/24, no skips/failures (19.89s). Real filesystem/subprocess tests remain tool integration; this is not aggregate coverage acceptance.
