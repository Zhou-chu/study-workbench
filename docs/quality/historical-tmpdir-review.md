# Historical runner temporary-directory review

Read-only source review of baseline 006831f0c6ce0c4465eb1709f70507b984795fb9.
No test execution or Sonar issue transition was performed in this review.
Source SHA256: `b52f4323bbf2abab343822e3e704dba41f87e1515f31f20be4f932132d9024fa`.

## Four current findings

- 8ec0f3da-97a7-4a7f-bdaa-f5dbfc791e49, line 78: reading TMPDIR is an
  untrusted input, not an allocation or acceptance. The value must pass canonical
  shape and anchored filesystem custody checks before child pytest is imported.
- af64f976-6cca-4bef-858f-d736206b3cc8, line 83: Path('/tmp') is the required
  grandparent comparison; no filesystem mutation occurs here.
- 0b7fbbe2-63ca-44bf-b0ea-a33b2af77964, line 91: os.open('/tmp') uses
  O_DIRECTORY/O_NOFOLLOW, then fstat requires root ownership and sticky mode.
  The returned descriptor anchors root and child opens, each also NOFOLLOW.
- 9e4cdeba-5d2c-4e4d-84a2-f0aadab24cee, line 194: TemporaryDirectory uses a
  random exclusive private directory under explicit /tmp, independent of ambient
  TMPDIR. This is not equivalent to opening a predictable public temporary file.

## Custody and check/use analysis

The run root must be owned by the current UID with exactly 0700. The child must
be owned by that UID, not writable by group/other, and on the root filesystem.
A child mode such as 0755 is allowed, but the containing 0700 root prevents other
UIDs from traversing it. O_DIRECTORY rejects non-directories; NOFOLLOW rejects
symlinks at each opened component. Shape checks reject alternate ancestry and
noncanonical spelling rather than resolving attacker-selected symlinks.

Descriptors are closed before pytest later uses the returned pathname. This is a
real check/use interval, not an indefinitely anchored operation. Under the stated
root-owned sticky /tmp and private root, a different unprivileged UID cannot rename
another owner's root entry or replace its child. Same-UID/root modification is
explicitly outside this guarantee. Privileged mounts or hostile filesystem semantics
are likewise not defeated by this function. No general race-free claim is justified.

## Material limitations requiring explicit treatment

The main parent allocates scratch, writes cache/log and launches the owned database
before the child validates /tmp. Main does not independently check /tmp owner/sticky
mode first. The allocator is appropriate on a normally provisioned trusted /tmp;
it is not proven fail-closed on a pre-existing hostile or misprovisioned /tmp. If
such a host is within the intended boundary, parent custody must be checked before
allocation and descendants are used. Merely quoting the later child guard would
misrepresent this ordering. No host-setting change is proposed here.

The docstring says it rejects reused scratch, but it accepts an already existing
same-UID 0700 directory with a matching name and acceptable child. It validates
custody/shape, not a fresh-parent nonce or process provenance. Ordinary main creates
fresh scratch; direct child invocation does not prove freshness. Do not advertise
protection from another process running with the same UID.

TemporaryDirectory cleanup and pytest descendant handling are not independently
proven against hostile same-UID writers by this review. SIGKILL may leave scratch;
its presence does not by itself invalidate the initial allocation security.

## Existing test evidence read, not rerun

`tests/test_historical_database_runner.py` tests foreign TMPDIR rejection before
hooks, child0777/root0755 rejection, a child symlink rejection without changing a
foreign marker, nested/missing paths, real allocator under umask0, and matching
child environment. It also tests parent ignoring ambient TMPDIR and lifecycle
cleanup through doubles. It does not exercise concurrent cross-UID rename, a
foreign-owner /tmp, ACL/mount behavior or parent nonce provenance. Do not claim those
cases passed based on this review.

Recommendation: the first three findings identify validation code and are candidates
for narrowly justified false-positive review. The allocator is safe only within the
explicit trusted-host assumptions above; either accept that review scope accurately
or harden the parent first. No blanket disposition or risk acceptance was performed.
