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
