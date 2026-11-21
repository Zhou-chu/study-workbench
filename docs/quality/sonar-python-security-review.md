# Python security findings: evidence review

Review date: 2026-11-13. Original finding locations refer to the `d119643`
Sonar snapshot, not necessarily current line numbers. Evidence inputs are
`/home/USER/notebook-quality-20261113/sonar/d119643/issues-2.json` and
`rule-metadata.json`. No issue was closed, suppressed or excluded from analysis.
This is a contextual review, not a claim that the security gate passed.

## Eight reviewed findings

1. **S5332, `open_notebook/utils/proxy.py:64`: parsing, not transport.**
   `_configured_db_host` adds a dummy scheme only to obtain `urlsplit(...).hostname`.
   `_internal_hosts` and `ensure_internal_no_proxy` consume the hostname, not the
   URL. No connection is opened and no database transport is selected here.
   `test_proxy.py` checks bare addresses, precedence, malformed input, preserved
   user values and urllib proxy bypass. The rule addresses clear-text network
   traffic; this specific literal does not create it. Existing database transport
   configuration is a separate review, deliberately untouched.
2. **S5332, `scripts/check_md_links.py:19`: skip predicate.** HTTP and HTTPS are
   prefixes excluded from local path checks at lines 50–51. The only subprocesses
   are local Git root/file queries; all remaining operations inspect local files.
   No remote URL is requested. No dedicated test was found for this script, so
   this conclusion rests on complete control-flow review, not a claimed test.
3. **S1313, `open_notebook/utils/url_validation.py:26`: security denylist.** The
   AWS IMDS IPv6 address is a rejection sentinel, not configurable infrastructure.
   `_reject_dangerous_ip` compares integer IPv6 addresses to prevent scope-ID
   bypass; both literal and DNS-resolved paths call it. `test_url_validation.py`
   covers metadata, scoped metadata and link-local rejection plus allowed local
   providers. The rule's infrastructure-coupling rationale does not justify
   making this mandatory protection configurable. Preserve the constant.
4. **S4790, `scripts/v1/prepare_private_snapshot.py:21`: Git object compatibility.**
   `object_sha` computes Git-format blob/tree IDs for source archive parity and
   expected tree identity. Replacing SHA1 changes the protocol. The inventory
   independently records SHA256 bytes and uses SHA256/mode for change comparison.
   `test_prepare_private_snapshot.py` verifies exact bytes, SHA256 and actual
   `git write-tree` parity. SHA1 is not a modern adversarial integrity guarantee;
   this offline tool is not a signature or untrusted-download verifier. Keep that
   limitation explicit. `usedforsecurity=False` could express non-security intent
   (supported by the project's Python versions), but does not strengthen hashing;
   the captured rule metadata promises no such exemption. No hash change made.
5. **S2068, `scripts/historical_database_pytest.py:41`: hardened rather than hidden.**
   The old fixed synthetic credential never represented a user's credential, and
   the server is memory-only on an owned loopback port. Nevertheless, another local
   process could guess it during a run. Now each isolated environment generates a
   fresh `secrets.token_urlsafe(32)` value. The test client receives it as
   `SURREAL_PASSWORD`; the owned server receives the same value as `SURREAL_PASS`.
   Ambient passwords are filtered out. The password is no longer an argv argument.
   This mitigates guessability and command-line disclosure, not privileged or
   same-UID inspection of process environments. No true server launch was tested.
6. **S5443, same script:83: private cache parent in normal entry path.**
   `build_environment` creates TMPDIR below the owned temporary root; child pytest
   cache therefore does not use a predictable public parent or ambient TMPDIR.
7. **S5443, same script:85: same private ancestry for pytest basetemp.**
   The standard parent entry overwrites inherited paths. Direct manual invocation
   of internal `--_child` still trusts its environment: that is not a supported
   isolation entry point and was not hardened in this batch.
8. **S5443, same script:142: secure temporary-directory allocation.**
   `TemporaryDirectory(prefix=..., dir="/tmp")` uses random names and atomic
   `mkdtemp` allocation with mode 0700 (verified in installed Python stdlib).
   Its fixed parent deliberately ignores ambient TMPDIR; it is not an ordinary
   predictable file opened in /tmp. Existing tests verify the chosen allocator,
   path isolation and identity-checked cleanup. No path workaround was applied.

## Minimal credential change and verification

The prepared SurrealDB 2.3.10 executable was checked against pinned SHA256
`bc916c7c775ed32aa40c33fd57bc9b477128c8ad9118bb1620696a05247bb0a7`.
Its `start --help` explicitly identifies `SURREAL_PASS` as the root-password
variable and `SURREAL_USER` for the username. Only help was invoked, not a server.
The server environment stays an explicit allowlist of PATH, isolated HOME and
SURREAL_PASS. No production/user database, provider or user credential is used.

Red/green evidence:
- Before implementation: updated environment and new two-run launch-contract
  tests failed on the actual old `synthetic` password: 2 failed, 10 passed.
- After implementation: historical runner tests: 12 passed, 0 warnings.
- Launches/sockets are mocked at their external boundary; the real environment
  builder and runner main flow execute. Assertions cover fresh non-inherited
  credentials, identical server/client values, absent password CLI arguments,
  no password in runner output, memory-only loopback arguments, isolated HOME and
  TMPDIR, and cleanup. Existing interruption and network-guard tests remain.
- The preceding read-only review ran four focused suites: 99 passed. A final
  combined rerun: **100 passed in 1.38s, exit 0, no warnings**. Ruff check and
  format --check passed for both changed Python files. This is not full-project
  or live DB validation.

Full-suite verification and a new Sonar scan remain pending coordinated execution.
The Python socket audit hook is not an OS sandbox; mocked launches do not prove
third-party server log behavior. The runner itself does not emit the credential.
