# Historical DB runner: validate public parent before allocation

The previous child-only custody check happened after the parent allocated
scratch and started the synthetic database. It did not fail closed before those
operations if the pre-existing `/tmp` parent was unsuitable.

The parent now opens `/tmp` with `O_DIRECTORY | O_NOFOLLOW`, verifies a directory
owned by root with the sticky bit, and closes the descriptor before allocating
its unique scratch. A rejected parent causes no scratch allocation or process
start. The child reuses the same checked open when traversing owned directories
via dir_fd. Failed inspection closes descriptors; cancellation is not swallowed.
No chmod, symlink replacement, global temp settings or existing data mutation
is introduced. Root/same-UID mutation remains outside this custody boundary.
The documentation now explicitly avoids claiming that ownership/mode checks
prove freshness or prevent reuse by the same UID.

Six red tests failed on the original code, including the ordering test which
observed an attempted scratch allocation before validation. Final targeted
regression: 25 passed, comprising eight pure OS-boundary unit cases and the
existing mixed runner suite plus rejection and successful fd-close ordering
cases. Ruff/format/diff checks passed. No real database or service was launched.
These targeted results do not establish whole-project coverage or close Sonar
issues; the changed code still needs fresh analysis and review.

Independent read-only review found no blocker under the documented trust boundary.
Follow-up tests cover SystemExit descriptor cleanup and confirm that the parent
fd closes before successful custody proceeds to scratch allocation.
