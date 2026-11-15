# Current draft candidate status

This candidate incorporates private source `6a2550d837d7ca1653b497ec6cfd300391329bc1`
as a content-only increment, with the single public parent
`565b97d279daeec30b1ff555d51b2f34aaac481b`. Private ancestors are not merged.
The user has authorized publication to the existing independent draft branch;
this prepared candidate has not yet been pushed. It is **not ready to merge**.

- Verification on this public candidate: 555 passed, 1 skipped, 2 warnings in a
  directed 24-file regression batch. This is not complete strict-unit coverage.
- Latest historical private reviewed-unit measurement: 2,200 passed; full
  180-source denominator, lines 50.22%, branches 39.37%, below the required gate.
- Latest historical private mixed measurement: 5,275 passed, 128 skipped.
  Mixed results are not strict-unit results or public candidate measurements.
- 164 mixed classifications remain. No new Sonar analysis or CI result is claimed.
  Coverage and complete strict-unit acceptance remain unmet.

**Historical record below:** earlier plans, candidate hashes, quality numbers,
“No push is authorized” language and “uncommitted snapshot” descriptions record
past stages only. They do not describe current authorization or candidate state.
The current summary above supersedes those status statements without erasing
the original evidence or failure history.

---

# Public candidate plan and review boundary

> DRAFT, NOT READY TO MERGE: source baseline c74 Sonar Gate ERROR, maintainability/security/reliability A/D/D, coverage 75.8%. Python 4151 passed/128 skipped but combined coverage 71.66%; full Node web partition 1359 passed/3 timeouts. The 178 focused candidate tests only verify sanitized fixture consumers, not a full-repository rerun or >90% acceptance. This new publication commit has not been scanned by Sonar.

No push is authorized. This candidate starts at the existing public base 0dc8130 and carries the final c74bc17 tree as an uncommitted snapshot. Original private commits and raw evidence remain untouched in the original local branch and external evidence directory. Do not merge the private branch: that makes original ancestors reachable. Cherry-picking does not import those ancestor commits, but replaying unsanitized commits publishes their sensitive intermediate blobs. A future per-commit sanitization could preserve logical history; this candidate intentionally uses one final sanitized snapshot. A later single reviewed snapshot commit can preserve code changes, not the original public commit identities. All original history remains locally available.

Before publication: consistently replace runtime IDs/hashes/timestamps/usage in the recovery fixture; sanitize newly introduced personal paths in docs/logs, explicitly label transformed logs without changing test failures; replace developer-home literals in three browser review helpers with Unix account-database home equivalents (pwd.getpwuid(os.getuid()).pw_dir), never environment-controlled HOME. Audit the candidate's new reachable objects, run all three fixture consumers, typechecks and scoped helper tests, and review the final diff. No assertion that this limited scan finds every secret.

Existing base already contains personal paths in SPA_NATIVE_RUNTIME.md, SPA preflight review, historical continuation evidence and spa_acceptance.py; two pre-existing fixture ZIPs also match. These inherited blobs are not rewritten here. Therefore only newly published blobs can be claimed sanitized, NOT the whole inherited public history. A fully clean history would need separately approved base-history removal/new unrelated repository and cannot be achieved while preserving that base ancestry.

Known source: live-turn-recovery.ts introduced by 28e3e87; browser helpers f1447de/9ee810f; model-setup evidence 8b6c813/5951f74; setup-return logs 6ee0261; shared-control logs e48829c/e59ab1e; quality docs 92f7a3a/49fddcb/f13c561/88566bf/c74bc17. Synthetic date fixtures and test@example.invalid are not personal-data findings.

## Focused checks

Three consumer files passed sequentially with one worker: domain 151 (1.25s), transport 15 (0.83s), web 12 (2.45s), all exit 0. This is not a new full CI run. Candidate tests load the sanitized fixture by relative path; unchanged runtime workspace packages reuse the existing c74 built dependencies. Three Python helpers parse/compile and their isolated TOOLS/FONTS expressions resolve identically under hostile HOME values. Historical scripts have import-time browser/process side effects, so they were NOT imported or run. No live data/service accessed.

## Whitespace-only normalization

The public copies additionally remove reported trailing whitespace and extra EOF blank lines in 27 historical evidence logs, one review document and one test file (the exact classified ledger is retained with private publication evidence). Original raw files are preserved outside this candidate. Assertions, failure messages, counts and pass/fail facts are unchanged; non-whitespace character sequences were compared before/after. This does not convert historical failed tests into passing evidence.

Compressed evidence copies (nine JSON gzip reports and two tar.gz bundles) also replace personal home paths. Tar owner names/IDs are normalized; raw archives are preserved privately. Test outcomes are not changed. Compressed bundles can contain additional binary artifacts; this text/path audit is not a new visual-content review of every embedded binary.

## Integrated follow-up snapshot

The candidate also includes the code diff c74bc17..fdacc75295319d6e2cf09315c4f0b8379cd63a9f without importing private commit ancestry. Reported upstream focused results: historical custody 57 cases, credentials 240 cases (module lines 98.25%, branches 93.89%), QA 41 cases and UI 20 cases. These are focused results, not an updated whole-repository coverage or Sonar result; the last full baseline remains c74 with the failures disclosed above. Candidate-specific post-integration checks are recorded separately.

Post-integration candidate checks: four focused Python files 154 passed (3.75s elapsed); four legacy UI files 27 passed (9.27s); frontend TypeScript noEmit exit 0 (23.96s); changed Python Ruff exit 0. Browser helper import ordering was normalized after adding pwd. These results do not replace a full run or Sonar scan.


## Incremental quality candidate (2026-11-14, not acceptance)

This candidate adds safe model-route error/log projection, credential/model router boundary tests, stale citation failure ownership, linear cold-return normalization, and studio operation boundary tests. It preserves the prior sanitized fixture and publication ancestry. Original unsanitized development ancestry is not merged.

Coverage terminology correction: existing Python and eleven Node partition reports select mixed test layers. They are not pure-unit coverage reports. API/React multi-component/CLI integration coverage must remain separate from the requested unit coverage above 90%. A reviewed test-layer inventory and independent unit measurements are still required, with the full production source denominator unchanged. Shell execution coverage remains unmeasured.

Focused checks do not establish the full quality gate: the latest formal SPA run had three setup-journey timeouts, and the previous Sonar analysis still failed its gate. No main merge, deployment, credential migration, or live-data change is authorized by this checkpoint.

Focused verification of this incremental candidate: 30 source-error pure unit tests passed separately; 132 credential/model route tests passed as a mixed boundary suite; 39 SPA tests (mixed layers) and 10 reader-navigation integration tests passed. Ruff, changed-file ESLint and both frontend TypeScript checks passed. Type checks used preserveSymlinks for the shared prepared dependency installation; no type exclusions were changed. The first SPA attempt could not find candidate dependencies and ran no tests; only the corrected run is counted. A new formal full SPA run remains pending.


## Accumulated strict-unit tooling and coverage draft update

Public parent: `d3a3dce8670ca561ccbaf37688e82aed3ec7a21d`. Content increment
from private source baseline `9e49c4347a8d063cc74aae1e2f8ebff05059fb84` through
`a0f39adbc91f4680f1921e69659b46929fa501be`, applied as a diff rather than merging
private ancestors. The increment contains 93 files before this review update.
Eight new evidence documents replace local personal paths with prepared-interpreter,
cache and external-evidence placeholders. Original bytes and logs remain private.
No failure text, test assertion, test AST or coverage result was changed to sanitize
this increment. Existing public SourceRow test hash remains public-specific in the
classification manifest; all current manifest hashes were checked against bytes.
Historical split-map/source commit hashes describe the original measured stage,
not this new public commit. Since all changed test/helper bytes equal the source
increment, path-only document cleanup does not invalidate those AST mappings.

### Verified on this public candidate

- Coverage runner/protocol/custody tools: 98 passed (8 files), 21.77 seconds.
- Directed new/split Python test batch: 648 passed, one dependency warning,
  11.65 seconds.
- Retained hybrid retrieval and installed SDK/file-loader consumers: 150 passed,
  4.45 seconds. These are deliberately not relabelled strict unit.
- Reader 56 plus session-proxy 159: 215 passed, 3.97 seconds, single worker.
- No tests failed in these candidate batches. They are not a full-project run.

The latest full 180-source reviewed Python subset result belongs to private
`a56ade8`: 1,834 passed, lines 47.43%, branches 35.41%, combined 44.71%, native
threshold exit 1. It has NOT been rerun as complete coverage on this candidate.
The classification still has 166 mixed files, so complete strict unit selection
must fail closed. All-language >90 and current Sonar acceptance remain unmet.
This is a backup/draft review branch, not ready to merge into main.

### Increment privacy audit boundaries

The new content has no binary/data/runtime artifacts. Pattern review found no
private-key blocks, recognized long API-token patterns, opaque live notebook IDs,
or remaining personal home paths. Timestamp matches are fixed synthetic test
clock values, including existing cutover fixtures and explicitly patched indexing
clocks. Addresses in Git fixtures are example.invalid; authorization literals are
explicit synthetic secrets. These checks reduce known disclosure risks, not a
claim that arbitrary secrets are mathematically absent. Already-public ancestor
history is preserved, not rewritten. No push, PR edit or deployment is performed
by candidate preparation.

## Increment from private 6a2550d (public parent 565b97d)

This draft-only update applies the content difference from private a0f39ad to
6a2550d837d7ca1653b497ec6cfd300391329bc1 onto the existing public branch. It does
not merge private ancestors. The increment is 48 files, plus this review update.
Four evidence documents replace personal interpreter/cache/evidence paths with
placeholders; original bytes and raw logs remain private. No raw reports are
published. Production code and tests are unchanged by sanitization; the existing
public-specific SourceRow hash is retained. All 532 manifest entries match actual
file bytes. The four provider/note/enqueue/projection source modules retain all
38 original named function/class ASTs across their split destinations.

### Candidate verification and limits

The public candidate's 24 changed/new collected Python files completed together:
555 passed, 1 skipped, 2 dependency warnings, 7.15 seconds (process 8.33 seconds).
This includes portable ACK units and actual temporary-file roundtrips, canonical
cache, both split groups and retained/downstream consumers, domain/logging,
metadata/extraction, citations, repository receipts, semantic retrieval, snapshot
and web-finish tests. It is a directed mixed regression batch, not all-project
strict unit coverage. The skipped test is not passing evidence. No full coverage
measurement or Sonar analysis was performed on this public candidate.

Historical private measurements remain stage-specific: a04a6a5's 95 reviewed-unit
files passed 2058 tests with the full 180-source denominator, lines 49.4142%,
branches 37.9788%, combined 46.8248%; coverage exit 1. Its initial mixed collection
error and the repaired 416a8c7 rerun (5216 passed, 128 skipped, combined 74.91261%,
coverage exit 1) remain disclosed in their original stage document. These are not
public candidate measurements. The current manifest still contains 164 mixed
files; strict selection remains blocked. No >90 coverage, current Sonar success,
or readiness to merge into main is claimed.

### Privacy and provenance

New reachable text is reviewed for personal paths, known credential formats and
opaque live Notebook IDs. Four document path substitutions are the only new
sanitization differences from private source, besides the already-public fixture
hash in the manifest. Fixed timestamps are synthetic fixture provenance values
or the Anthropic protocol version, not live notebook exports. No data, runtime,
binary or raw report files are added. Historical split maps and their hashes
still describe their original measurement stage; identical test bytes and the
independent AST check preserve their meaning. Existing public history is not
rewritten. Pattern checks are bounded evidence, not proof that every possible
secret is absent. Candidate preparation does not push or deploy.
