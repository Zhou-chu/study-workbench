# Portable-project verification

- `portable-unit-tests.txt`: the dedicated ZIP, fresh-root, reference, security,
  job-idempotency, provenance and rollback suite: **38 passed, 1 skipped**.
  The native integration is skipped unless its explicit isolated-server flag
  is enabled
- `portable-native-restore-initial.txt`: first real SurrealDB 2.3.10/SQLite proof,
  two unique migrated databases and disjoint original/destination directories,
  with original hash and visible-history preservation
- `portable-native-restore.txt`: expanded native proof additionally covers a
  real extraction/evidence record, native note, saved V1 answer, remapped
  historical citation, re-export without original SQLite, and a real schema
  error causing whole-transaction rollback plus staged-file cleanup:
  **39 passed**, including all dedicated portable tests

Native logs contain only public synthetic fixture data and ephemeral test paths.
The DB listener was loopback-only and used nonsecret test fixture credentials.
No Google session or real model endpoint was used. The source directory and
SQLite file were physically removed before fresh restore. The final richer
native fixture ends in exactly one newline, proving the evidence parser
regression is fixed. These final runs include the default-constructor regression
and two provenance cases (missing or forged local-parser claims, each followed
by repeated export/restore). Both runs have one upstream Pydantic deprecation
warning.

A20 remains partial under the conservative archive trust policy: data, hashes,
identity relationships, normalized history, and historical references restore,
but restored verified citations are deliberately downgraded to unverified.
Every imported extraction and evidence record gets a server-overwritten
`verification_origin=restored_archive` marker. It survives export and repeated
restore; changing a saved note or generating a new answer cannot convert those
historical records into freshly verified evidence. Original quote/locator links
remain readable. Only a genuinely new extraction with new evidence identities
can establish fresh local verification. Archive hashes do not prove extraction
authenticity.
A21 malicious-archive and managed-secret exclusion cases are covered by the
unit suite. External user-account functionality is outside this test.
