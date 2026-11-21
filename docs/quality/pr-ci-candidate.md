# PR quality workflow candidate (not remotely executed)

Base 4b3a61f. Authorized implementation adds three independent ubuntu-24.04 jobs on pull_request targeting main and manual workflow_dispatch. No path filters, pull_request_target, secrets, deployment, database services, workflow write permissions, release helper or continue-on-error. Only contents:read; checkout persist-credentials=false. Actions below are pinned to full commits verified against their official GitHub Git-ref API on 2026-11-15:

| Action | Tag | Commit |
| --- | --- | --- |
| actions/checkout | v4.2.2 | 11bd71901bbe5b1630ceea73d27597364c9af683 |
| actions/setup-node | v4.4.0 | 49933ea5288caeca8642d1e84afbd3f7d6820020 |
| actions/setup-python | v5.6.0 | a26af69be951a213d495a4c3e4e4022e16d87065 |
| astral-sh/setup-uv | v6.8.0 | d0cc045d04ccac9d8b7881df0226f9e82c39688e |
| actions/upload-artifact | v4.6.2 | ea165f8d65b6e75b540449e92b4886f43607fa02 |

Source pattern: https://api.github.com/repos/OWNER/REPO/git/ref/tags/TAG. Tool versions: Node24, Python3.12, uv0.9.10. These are pinned known versions, not a claim to be latest.

## Gates

Static: locked uv dev dependencies plus both npm locks; root Ruff check/format/mypy and workspace+legacy ESLint/types. No existing lint/type exclusions are broadened. The root workspace does not contain legacy frontend; its install/check is explicit.

Mixed: offline_pytest tests/ with JUnit, then npm run coverage (existing 11-partition wrapper). JS still runs after a Python failure unless cancelled, but only after dependency installation and preparation succeeded, while the prior failed step keeps the job failed. Mixed coverage is not pure-unit acceptance. Opt-in DB/runtime skips remain visible and are not passing evidence. No services/real DB start.

Strict: coverage-unit-all.mjs with explicit interpreter/cache uses the existing selection and aggregate gates. Current mixed, shell and insufficient-coverage blockers must stay RED. No threshold relaxation or result reuse. Jobs are independent; a strict failure does not suppress static/mixed diagnostics. Artifact upload always runs but never neutralizes failure. Coverage outputs are not cached; only current job directories are uploaded.

## Bootstrap trust chain

scripts/ci/prepare_tools.py explicitly prepares dependencies before offline tests. Git2.56.1 source URL and SHA256 are fixed from kernel.org published sha256sums.asc, rechecked 2026-11-15. HTTPS+fixed SHA authentication is used; no independent PGP signature verification claimed. Only checked bytes are extracted/compiled. The actual official archive was inspected: its relative internal RelNotes/subprojects symlinks are allowed, while absolute/outside-root links, hardlinks/devices, path escapes, duplicates and excessive expanded size are refused. Python3.12 data extraction filtering adds a second containment check.

The OS-account home is resolved through pwd, not ambient HOME. Its canonical ownership/nonwritable ancestor custody must pass; otherwise fail, never chmod/repair it. An exclusive random private directory holds source, tokenizer and installation. Existing installation/registration is never reused/overwritten. Existing host /usr/bin/make/compiler/zlib are prerequisites; no sudo or APT install. make -j2 uses the previously reviewed NO_CURL/EXPAT/GETTEXT/PERL/TCLTK/OPENSSL/RUST flags. Authenticated source + trusted hosted compiler produces a binary digest receipt; this digest is not independently published vendor binary authentication. The registered installation is then verified by coverage-git-provision.mjs. No which-git/hash-of-arbitrary-PATH trust shortcut. Installation helpers are trusted with their source build, as in the existing Git threat model.

Tokenizer is downloaded separately from the fixed OpenAI public blob and checked against offline_pytest's existing SHA256/name. Preparation never reads production credentials. Downloads/install scripts can use network during preparation; offline_pytest's audit hook is NOT an OS firewall for native/Node children. No claim of universal egress isolation.

## Local verification and open obligations

Contract tests use actual small tar/filesystem fixtures and parsed workflow YAML, not network/compilation. Classify tests/test_pr_ci_contract.py as tool-integration (real filesystem/tar fixtures plus static workflow contracts), NOT strict unit. New scripts/ci/prepare_tools.py is first-party production and must be included by the existing scripts scope (denominator grows; do not exclude it). Workflow configuration is also authored CI scope; update inventory/classification honestly at integration.

Observed RED: seven missing-bootstrap/workflow failures. First GREEN seven. Parent review subsequently added an anchor/prepare-outcome RED; workflow now emits no aliases and gates JS on successful dependency/preparation steps. Actual official-source link inspection then added one legitimate-relative-symlink RED and HTTPS test; correction permits only links staying inside the authenticated source root. No full build, dependency installation, local whole-suite or remote GitHub run is claimed. Final 10 fixture/structure cases pass; selected bootstrap mypy/Ruff and every run shell syntax pass. uv.lock/pyproject compatibility still requires the actual locked install; lock existence is not proof of sync success.

Required remote follow-up: clean hosted dependency resolution with both npm locks/uv.lock; source build and private account ancestry; actual trusted Git provenance tests; native module fixtures and cache; existing lint/mypy results; complete mixed partitions; expected strict fail-closed artifact; branch protection/check names configured separately. Fresh CI may legitimately expose failures absent in the prepared desktop. Do not claim enabled/passing until a specific pushed workflow revision has observed GitHub results. No publication occurred in this change.

Final local review: independent read-only review found no blocking safety defect. Deferred non-blocking limits: custody branches lack dedicated fixture coverage; only HTTPS is enforced through redirects (fixed digest remains authority); extraction failure can retain partial private scratch; build receipts remain in private job scratch/Actions log, not uploaded; setup-node authenticity depends on the pinned action and trusted hosted toolchain, not an independent Node binary signature. Test mypy initially exposed absent PyYAML stubs and Optional import spec; added explicit non-null checks and one import-only import-untyped annotation, without disabling project type checks or adding dependencies. Corrected two-file mypy passes.
