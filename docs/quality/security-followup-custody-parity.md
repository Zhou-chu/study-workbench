# Isolated security follow-up

Based on c74bc179; no services, real DBs or credentials are touched.

Historical child entry validates TMPDIR before audit-hook/pytest initialization:
an exact /tmp/historical-db-*/tmp shape, no-follow directory opens, root-owned
sticky /tmp, current-UID 0700 run root, and same-device/current-UID scratch without
group/world writes. Parent construction creates scratch 0700 before generic
environment setup, including under umask 000. Rejected paths are not removed.
This is filesystem custody, NOT parent-process authentication. Same-UID/root
adversaries can create matching directories and remain outside the guarantee.
Private basetemp contents are still pytest-owned disposable data.

Snapshot preparation reads each blob independently via cat-file from the resolved
commit:path and compares bytes before output creation. Git SHA1 remains for
object-format compatibility and tree IDs; SHA1 equality is no longer the only
archive-byte parity check. Synthetic tests simulate colliding SHA1 results and
changed archive bytes, assert rejection before output, and verify reads use the
resolved commit rather than uncommitted working tree/index. This does not
authenticate source authors, defend a compromised Git binary/object store, or
upgrade SHA1 Git repositories to a collision-resistant identity scheme.
The existing local Git helper remains the process boundary; this patch reuses it
without new shell invocation or environment/PATH changes. Its inherited PATH
trust is not independently hardened by this follow-up.

Only focused offline unit tests are run; integration and fixed-source whole-suite
validation remain parent-owned. No Sonar disposition is changed.
