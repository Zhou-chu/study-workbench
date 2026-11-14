# Trusted Git for coverage and artifact evidence

## Threat model

The three evidence consumers previously executed a bare `git`, allowing an earlier attacker-controlled PATH entry to substitute the evidence producer. They now share `scripts/coverage-trusted-git.mjs`. The runtime never discovers an executable from PATH, accepts an executable path from environment variables, or falls back to another Git. It verifies the registered executable SHA256 on each invocation. Fixed argv uses no shell. The helper permits only ls-files, rev-parse and status, not arbitrary Git operations.

The trust anchor is explicit operator provisioning under the operating-system account home: `.notebook-tools/trusted-git.json`. Node `os.userInfo().homedir` supplies that home independently of HOME, XDG_CONFIG_HOME and the coverage runner's scratch home. There is no serialized-descriptor environment handoff to forge. The existing account/host and provisioning invocation are trusted; arbitrary absolute paths are not automatically trusted. Provisioning requires an explicit installation root, binary path and independently expected SHA256. Never run provisioning using a path/hash obtained from an untrusted PATH lookup.

POSIX validation walks every ancestor, rejects symbolic links and group/other writable nodes, and requires current-uid or root ownership. The registration must additionally be a private current-user-owned regular file. The binary must be regular/executable, match its checksum and reside inside its canonical registered installation. The installation must be a directory. We do not chmod or repair untrusted directories. Missing, invalid or changed registrations fail closed.

This does not defend against root or same-UID attackers able to replace the tool, registration or executing scripts. Checks cannot eliminate same-UID replacement races. Git's installation libraries/helper programs are trusted as part of the approved installation, not independently hashed. This is not a sandbox for arbitrary hostile Git repositories or an OS network boundary.

Git children receive a new small environment, not inherited GIT_*, HOME, LD_PRELOAD or PATH. System/global Git config is disabled, fsmonitor and hooks are explicitly disabled, lazy object fetching and prompts are disabled, and optional index locks are disabled. Repository configuration still supplies ordinary repository semantics; only read-only evidence commands are exposed.

## Explicit provisioning

After independently approving an existing installation and expected executable checksum, use the selected Node executable:

```text
node scripts/coverage-git-provision.mjs ABSOLUTE_GIT_BINARY ABSOLUTE_INSTALL_ROOT EXPECTED_SHA256
```

Arguments are passed directly, so quote paths with spaces according to the shell. The command does not execute the proposed binary to decide trust, download/install software, mutate OS PATH/ACLs or overwrite an existing registration. It creates the directory with mode0700 and the new file with mode0600/exclusive creation. A preexisting file is an error, not automatic replacement. Upgrades require a separately reviewed registration change; do not suppress checksum errors by automatically recomputing the stored hash.

On this workstation the explicitly approved existing installation is `/home/USER/study-workbench-deploy-20261107/tools/git` (prepared Git2.56). Its binary checksum was read and supplied explicitly before first registration. No system Git replacement was performed.

For reproducible Linux CI, provision in a trusted image/bootstrap step under the same OS account that runs the checks. Supply the canonical installation path and expected hash from the approved toolchain/image manifest, not from pull-request code or ambient PATH. Then run the normal coverage/artifact commands. Missing provisioning is an actionable failure. This repository currently has no active `.github/workflows` directory; no CI job was silently switched or claimed passing.

## Platform limits

Native Windows is fail-closed: POSIX mode bits do not establish Windows ACL custody. Use the existing WSL/Linux execution path. A native Windows port requires real owner/DACL and ancestor/reparse-point validation plus native process tests; path-shape mocks are not sufficient evidence. This deliberately removes implicit support for native Windows invocation of these Git-backed tools; product UI/runtime is unchanged. macOS/POSIX logic is not independently runtime-verified in this change.

## Evidence and provenance

The executable registration is revalidated and included in coverage inputDigest; the helper and provisioning source files are included in SPA authored paths and the quality-tooling coverage inventory. Untracked new helper files cannot appear in Git ls-files until integration, and clean-source build already rejects such an uncommitted worktree. No production denominator was removed.

Tests use real temporary Git repositories and explicit descriptor verification, not a mock Git replacing the security boundary. They cover malicious PATH precedence, fake HOME/XDG/exec variables, polluted Git config variables, fsmonitor non-execution, checksum/path/symlink/mode failures, no overwrite, nonzero Git exit, and genuine file/commit behavior. The original malicious-PATH test failed before the production fix, returning the hash of an empty input set.
