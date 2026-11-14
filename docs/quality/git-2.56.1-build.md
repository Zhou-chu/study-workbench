# Isolated Git 2.56.1 evidence-tool build

The existing Git 2.56.0 installation remains unchanged. A separate 2.56.1
installation was built and verified; its registration was **not activated**.
No system PATH, safe.directory, filesystem permissions, OS packages or service
TLS settings were changed.

## Provenance and reproducibility

- Official archive: https://www.kernel.org/pub/software/scm/git/git-2.56.1.tar.xz
- Published SHA-256: `f0b0bf89264b9bd2e1c640363e7529643989da76281600473c50745cd34a607f`
- Checksum source: https://www.kernel.org/pub/software/scm/git/sha256sums.asc
- Release notes: https://raw.githubusercontent.com/git/git/v2.56.1/Documentation/RelNotes/2.56.1.adoc
- HTTPS origin and SHA-256 were verified; an independent PGP key/signature
  verification was not performed. Do not label this a PGP-verified build.
- Local compiler: Ubuntu GCC 13.3.0; GNU Make 4.3. An independently rebuilt
  executable may have different bytes; its digest is a build receipt, not proof
  of vendor origin on its own.

Use a new owned installation prefix, retain the previous installation, and build
with `make -j2` followed by `make -j2 install`, both with the same prefix and:

```
NO_CURL=YesPlease NO_EXPAT=YesPlease NO_GETTEXT=YesPlease
NO_PERL=YesPlease NO_TCLTK=YesPlease NO_OPENSSL=YesPlease NO_RUST=YesPlease
```

The first build failed because OpenSSL development headers were absent. The
second reached linking but required Cargo. Both failure logs were retained.
The official Makefile explicitly supports NO_OPENSSL and optional NO_RUST; the
final local-only build succeeded without installing packages or fetching Rust
crates. This limited tool is for local read-only coverage provenance, not an
HTTPS-capable replacement for the user's general Git client.

## Actual validation

The resulting executable reports `git version 2.56.1`. The project descriptor
validator passed canonical path, ownership, non-writable ancestor and executable
hash checks. Explicit absolute-path commands successfully read HEAD with
`--no-lazy-fetch`, enumerate tracked files and inspect porcelain status while
hooks/fsmonitor/global configuration were disabled. Existing registration bytes
were compared before and after and remained unchanged.

This is not an upstream Git test-suite pass, CI acceptance, or confirmation that
all Git CVEs are irrelevant. Keep untrusted recursive/submodule operations,
external fast-import streams and unreviewed patch workflows outside this
read-only evidence tool's scope. Registration/CI integration is a separate step.
